/**
 * 读取仓库内的本地画廊内容（src/content/gallery/*.yaml），
 * 归一化成与 R2 manifest 相同的公开结构。
 *
 * Astro 的内容集合由 getCollection 提供；Next.js 没有内容层，
 * 这里直接从文件系统读，缓存按页面请求的有效期自然消退。
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { GalleryPhoto } from './gallery';

const GALLERY_DIR = path.join(process.cwd(), 'src', 'content', 'gallery');

const text = (value: unknown, max: number): string | undefined => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed ? trimmed.slice(0, max) : undefined;
};

function tagsFrom(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => text(item, 24))
    .filter((item): item is string => Boolean(item))
    .slice(0, 12);
}

function positiveInt(value: unknown): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

function dateFrom(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString().slice(0, 10);
  }
  return '';
}

interface LocalYaml {
  title?: unknown;
  image?: unknown;
  preview?: unknown;
  thumbnail?: unknown;
  width?: unknown;
  height?: unknown;
  description?: unknown;
  date?: unknown;
  tags?: unknown;
  draft?: unknown;
}

export async function localGalleryPhotos(): Promise<GalleryPhoto[]> {
  let files: string[];
  try {
    files = (await readdir(GALLERY_DIR)).filter((name) => name.endsWith('.yaml'));
  } catch {
    return [];
  }

  const photos = await Promise.all(files.map(async (file): Promise<GalleryPhoto | null> => {
    try {
      const raw = await readFile(path.join(GALLERY_DIR, file), 'utf8');
      const data = (parseYaml(raw) ?? {}) as LocalYaml;
      if (data.draft === true) return null;
      const title = text(data.title, 120);
      const image = text(data.image, 300);
      if (!title || !image) return null;
      return {
        id: `local-${file.replace(/\.yaml$/, '')}`,
        title,
        description: text(data.description, 500),
        date: dateFrom(data.date),
        tags: tagsFrom(data.tags),
        width: positiveInt(data.width),
        height: positiveInt(data.height),
        image,
        preview: text(data.preview, 300) ?? image,
        thumbnail: text(data.thumbnail, 300) ?? image,
        source: 'local',
      };
    } catch (error) {
      console.error(`[gallery] 本地条目 ${file} 解析失败：`, error);
      return null;
    }
  }));

  return photos.filter((photo): photo is GalleryPhoto => photo !== null);
}