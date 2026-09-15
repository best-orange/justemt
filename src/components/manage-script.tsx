'use client';

import { useEffect } from 'react';

type UploadPlan = {
  id: string;
  originalKey: string;
  previewKey: string;
  thumbnailKey: string;
  originalUrl: string;
  previewUrl: string;
  thumbnailUrl: string;
};

type GalleryPhoto = { id: string; title: string; image: string; thumbnail: string; source: 'r2' | 'local'; sha256?: string };

/** “管理馆藏”页面脚本：预签名直传 R2 + 重复检测 + 远程列表管理 */
export default function ManageScript() {
  useEffect(() => {
    const form = document.getElementById('upload-form') as HTMLFormElement | null;
    if (!form) return;

    const filesInput = document.getElementById('file-input') as HTMLInputElement;
    const titleInput = document.getElementById('title-input') as HTMLInputElement;
    const dateInput = document.getElementById('date-input') as HTMLInputElement;
    const tagsInput = document.getElementById('tags-input') as HTMLInputElement;
    const descriptionInput = document.getElementById('description-input') as HTMLTextAreaElement;
    const button = document.getElementById('upload-button') as HTMLButtonElement;
    const status = document.getElementById('upload-status')!;
    const list = document.getElementById('remote-list')!;
    const count = document.getElementById('remote-count')!;
    if (!filesInput || !titleInput || !dateInput || !tagsInput || !descriptionInput || !button) return;

    const maxUploadBytes = 25 * 1024 * 1024;
    const fileHashes = new WeakMap<File, Promise<string>>();
    const remoteHashes = new Map<string, string>();
    let remoteReady: Promise<void> = Promise.resolve();

    // 用本地时间取日期：UTC 的 toISOString 在 UTC+8 的凌晨会把日期记成前一天
    const localDateValue = () => {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    };

    dateInput.value = localDateValue();

    function baseName(name: string) {
      return name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || '未命名作品';
    }

    function hashFile(file: File): Promise<string> {
      const cached = fileHashes.get(file);
      if (cached) return cached;
      const pending = file.arrayBuffer().then(async (data) => {
        const digest = await crypto.subtle.digest('SHA-256', data);
        return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
      });
      fileHashes.set(file, pending);
      return pending;
    }

    async function findDuplicate(files: File[], hashes: string[]): Promise<string | null> {
      const seen = new Map<string, string>();
      for (let i = 0; i < files.length; i += 1) {
        const previous = seen.get(hashes[i]);
        if (previous) return `检测到重复图片：「${previous}」和「${files[i].name}」，请移除重复项后再上传。`;
        seen.set(hashes[i], files[i].name);
      }
      for (let i = 0; i < files.length; i += 1) {
        const remoteTitle = remoteHashes.get(hashes[i]);
        if (remoteTitle) return `图片「${files[i].name}」已存在于远程馆藏：「${remoteTitle}」。`;
      }
      return null;
    }

    async function decode(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; close?: () => void }> {
      if ('createImageBitmap' in window) {
        const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
        return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
      }
      const url = URL.createObjectURL(file);
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const element = new Image();
        element.onload = () => resolve(element);
        element.onerror = () => reject(new Error('图片无法解析'));
        element.src = url;
      });
      return { source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => URL.revokeObjectURL(url) };
    }

    async function resize(source: CanvasImageSource, width: number, height: number, maxWidth: number, quality: number): Promise<Blob> {
      const scale = Math.min(1, maxWidth / width);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('浏览器不支持图片处理');
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
      const result = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
      if (!result) throw new Error('缩略图生成失败');
      return result;
    }

    async function put(url: string, blob: Blob, type: string) {
      const headers: Record<string, string> = {
        'Content-Type': type,
        'Cache-Control': 'public, max-age=31536000, immutable',
      };
      const response = await fetch(url, {
        method: 'PUT',
        headers,
        body: blob,
      });
      if (!response.ok) throw new Error(`图片直传失败（${response.status}）`);
    }

    async function uploadOne(file: File, sha256: string, index: number, total: number, commonTitle: string, description: string, tags: string[], date: string) {
      status.textContent = `正在处理 ${index + 1}/${total}：${file.name}`;
      const decoded = await decode(file);
      try {
        const preview = await resize(decoded.source, decoded.width, decoded.height, 2000, 0.88);
        const thumbnail = await resize(decoded.source, decoded.width, decoded.height, 720, 0.82);
        const planResponse = await fetch('/api/gallery', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'presign', fileName: file.name, contentType: file.type, sha256 }),
        });
        const planBody = await planResponse.json() as { ok?: boolean; plan?: UploadPlan; message?: string };
        if (!planResponse.ok || !planBody.ok || !planBody.plan) throw new Error(planBody.message ?? '无法获取上传地址');
        const plan = planBody.plan;
        await Promise.all([
          put(plan.originalUrl, file, file.type),
          put(plan.previewUrl, preview, 'image/webp'),
          put(plan.thumbnailUrl, thumbnail, 'image/webp'),
        ]);
        const title = commonTitle.trim()
          ? (total > 1 ? `${commonTitle.trim()} · ${index + 1}` : commonTitle.trim())
          : baseName(file.name);
        const commitResponse = await fetch('/api/gallery', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'commit', ...plan, title, description, tags, date,
            width: decoded.width, height: decoded.height, size: file.size, sha256,
          }),
        });
        const commitBody = await commitResponse.json() as { ok?: boolean; message?: string };
        if (!commitResponse.ok || !commitBody.ok) throw new Error(commitBody.message ?? '登记相册失败');
      } finally {
        decoded.close?.();
      }
    }

    const onFilesChange = async () => {
      const files = [...(filesInput.files ?? [])];
      if (!files.length) return;
      status.textContent = '正在检查是否有重复图片…';
      try {
        await remoteReady;
        const hashes = await Promise.all(files.map(hashFile));
        const duplicateMessage = await findDuplicate(files, hashes);
        status.textContent = duplicateMessage ?? `已选择 ${files.length} 张图片，可以上传。`;
      } catch {
        status.textContent = '图片检查失败，请重试。';
      }
    };

    const onSubmit = async (event: SubmitEvent) => {
      event.preventDefault();
      const files = [...(filesInput.files ?? [])];
      if (!files.length) return;
      const oversized = files.find((file) => file.size > maxUploadBytes);
      if (oversized) {
        status.textContent = `${oversized.name} 超过 25 MB，请先压缩原图。`;
        return;
      }
      button.disabled = true;
      status.textContent = '正在检查是否有重复图片…';
      const tags = tagsInput.value.split(',').map((tag) => tag.trim()).filter(Boolean);
      try {
        await remoteReady;
        const hashes = await Promise.all(files.map(hashFile));
        const duplicateMessage = await findDuplicate(files, hashes);
        if (duplicateMessage) {
          status.textContent = duplicateMessage;
          return;
        }
        for (let i = 0; i < files.length; i += 1) {
          await uploadOne(files[i], hashes[i], i, files.length, titleInput.value, descriptionInput.value, tags, dateInput.value);
        }
        status.textContent = `已上传 ${files.length} 张图片，画廊将在几秒内更新。`;
        form.reset();
        dateInput.value = localDateValue();
        await loadRemote();
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : '上传失败';
      } finally {
        button.disabled = false;
      }
    };

    function renderRemote(photo: GalleryPhoto) {
      const row = document.createElement('article');
      row.className = 'glass flex items-center gap-3 rounded-2xl p-3';
      const image = document.createElement('img');
      image.src = photo.thumbnail || photo.image;
      image.alt = photo.title;
      image.className = 'h-16 w-16 rounded-xl object-cover';
      const title = document.createElement('p');
      title.className = 'min-w-0 flex-1 truncate text-sm font-medium text-slate-700 dark:text-slate-200';
      title.textContent = photo.title;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'rounded-lg px-2 py-1 text-xs text-rose-500 transition-colors hover:bg-rose-500/10';
      remove.textContent = '删除';
      remove.addEventListener('click', async () => {
        if (!confirm(`确定删除「${photo.title}」吗？`)) return;
        remove.disabled = true;
        try {
          const response = await fetch(`/api/gallery?id=${encodeURIComponent(photo.id)}`, { method: 'DELETE' });
          if (response.ok) {
            row.remove();
            status.textContent = `已删除「${photo.title}」`;
            return;
          }
          const body = await response.json().catch(() => null) as { message?: string } | null;
          status.textContent = body?.message ?? '删除失败，请稍后再试';
        } catch {
          status.textContent = '网络中断了，删除没有完成';
        }
        remove.disabled = false;
      });
      row.append(image, title, remove);
      return row;
    }

    async function loadRemote() {
      try {
        const remote: GalleryPhoto[] = [];
        let cursor: string | null = '0';
        while (cursor) {
          const response = await fetch(`/api/gallery?limit=48&cursor=${encodeURIComponent(cursor)}&tag=*`, { cache: 'no-store' });
          const body = await response.json() as { items?: GalleryPhoto[]; nextCursor?: string | null };
          remote.push(...(body.items ?? []).filter((photo) => photo.source === 'r2'));
          cursor = body.nextCursor ?? null;
        }
        list.replaceChildren(...remote.map(renderRemote));
        count.textContent = `${remote.length} 件`;
        remoteHashes.clear();
        for (const photo of remote) {
          if (photo.sha256) remoteHashes.set(photo.sha256.toLowerCase(), photo.title);
        }
      } catch {
        count.textContent = '载入失败';
      }
    }

    filesInput.addEventListener('change', onFilesChange);
    form.addEventListener('submit', onSubmit);
    document.querySelector('section.reveal')?.classList.add('is-visible');
    remoteReady = loadRemote();

    return () => {
      filesInput.removeEventListener('change', onFilesChange);
      form.removeEventListener('submit', onSubmit);
    };
  }, []);

  return null;
}