'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

type GalleryPhoto = {
  id: string;
  title: string;
  description?: string;
  date: string;
  tags: string[];
  width: number;
  height: number;
  image: string;
  preview: string;
  thumbnail: string;
  source: 'r2' | 'local';
};

/**
 * 画廊页脚本：标签筛选 + 无限滚动 + 灯箱。
 * 灯箱通过 Portal 挂到 document.body——对应 Astro 版 BaseLayout 的 overlay 插槽，
 * 避开内容玻璃面板的层叠上下文与 overflow 裁剪。
 */
export default function GalleryClient() {
  // 灯箱要挂到 body，只能在客户端渲染：SSR 预渲染阶段没有 document
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const page = document.querySelector<HTMLElement>('[data-gallery-page]');
    if (!page) return;
    // 具名函数会被提升到断言之前，TS 无法收窄 page 的类型：用别名固定为 HTMLElement
    const galleryPage: HTMLElement = page;

    const grid = page.querySelector<HTMLElement>('#gallery-grid')!;
    const filter = page.querySelector<HTMLElement>('#tag-filter')!;
    const sentinel = page.querySelector<HTMLElement>('#gallery-sentinel')!;
    const status = page.querySelector<HTMLElement>('#gallery-status')!;
    const lightbox = document.getElementById('lightbox')!;
    const lbPreview = document.getElementById('lb-preview') as HTMLImageElement;
    const lbImage = document.getElementById('lb-img') as HTMLImageElement;
    const lbTitle = document.getElementById('lb-title')!;
    const lbDesc = document.getElementById('lb-desc')!;
    const lbCount = document.getElementById('lb-count')!;
    const lbOriginal = document.getElementById('lb-original') as HTMLAnchorElement;

    const controller = new AbortController();
    const { signal } = controller;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let photos: GalleryPhoto[] = [];
    let cursor: string | null = '0';
    let activeTag = '*';
    let loading = false;
    let currentIndex = -1;
    let touchX = 0;
    let touchY = 0;

    function makeTag(label: string, active: boolean) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.tag = label;
      button.textContent = label === '*' ? '全部' : label;
      button.className = 'tag-chip rounded-full border border-lilac-400/30 px-4 py-1.5 text-sm text-slate-600 dark:text-slate-300';
      if (active) button.classList.add('is-active');
      button.addEventListener('click', () => {
        if (activeTag === label) return;
        activeTag = label;
        filter.querySelectorAll('button').forEach((item) => item.classList.toggle('is-active', item === button));
        photos = [];
        cursor = '0';
        grid.replaceChildren();
        void loadPage(true);
      }, { signal });
      return button;
    }

    function renderTags(tags: string[]) {
      const previous = activeTag;
      filter.replaceChildren(makeTag('*', previous === '*'));
      tags.forEach((tag) => filter.append(makeTag(tag, tag === previous)));
    }

    function renderCard(photo: GalleryPhoto, index: number) {
      const figure = document.createElement('figure');
      figure.className = 'gallery-item group relative mb-4 cursor-zoom-in overflow-hidden rounded-2xl bg-slate-200/60 dark:bg-night-900/70';
      figure.dataset.index = String(index);
      figure.style.breakInside = 'avoid';

      const img = document.createElement('img');
      img.src = photo.thumbnail || photo.preview || photo.image;
      img.alt = photo.title;
      img.loading = index < 6 ? 'eager' : 'lazy';
      img.decoding = 'async';
      if (photo.width > 0 && photo.height > 0) {
        img.width = photo.width;
        img.height = photo.height;
      }
      img.className = 'block h-auto w-full';
      img.addEventListener('error', () => {
        const fallback = photo.preview || photo.image;
        if (img.src !== fallback) img.src = fallback;
      }, { once: true });

      const caption = document.createElement('figcaption');
      caption.className = 'pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-4 pt-12 opacity-0 transition-opacity duration-300 group-hover:opacity-100';
      const title = document.createElement('p');
      title.className = 'font-display text-sm font-bold text-white';
      title.textContent = photo.title;
      const description = document.createElement('p');
      description.className = 'mt-0.5 text-xs text-white/75';
      description.textContent = photo.description ?? photo.date;
      caption.append(title, description);
      figure.append(img, caption);
      figure.addEventListener('click', () => openAt(index), { signal });
      return figure;
    }

    function appendPhotos(items: GalleryPhoto[]) {
      const start = photos.length;
      photos.push(...items);
      items.forEach((photo, offset) => grid.append(renderCard(photo, start + offset)));
    }

    async function loadPage(reset = false) {
      if (loading || (!reset && !cursor)) return;
      loading = true;
      status.textContent = photos.length ? '正在展开更多馆藏…' : '正在打开画册…';
      try {
        const query = new URLSearchParams({ limit: '24', tag: activeTag, cursor: reset ? '0' : cursor ?? '0' });
        const response = await fetch(`/api/gallery?${query}`, { signal });
        const body = await response.json() as { ok?: boolean; items?: GalleryPhoto[]; nextCursor?: string | null; tags?: string[]; total?: number; message?: string };
        if (signal.aborted) return;
        if (!response.ok || !body.ok) throw new Error(body.message ?? '加载失败');
        if (reset) grid.replaceChildren();
        appendPhotos(body.items ?? []);
        cursor = body.nextCursor ?? null;
        renderTags(body.tags ?? []);
        status.textContent = cursor ? '继续下滑，发现更多微光' : (photos.length ? `共 ${body.total ?? photos.length} 件馆藏` : '画册还没有作品');
        galleryPage.classList.add('is-visible');
      } catch {
        if (!signal.aborted) {
          status.textContent = photos.length ? '网络有些冷，稍后可继续下滑重试' : '画廊暂时无法打开';
        }
      } finally {
        loading = false;
      }
    }

    function openAt(index: number) {
      const photo = photos[index];
      if (!photo) return;
      currentIndex = index;
      lbTitle.textContent = photo.title;
      lbDesc.textContent = photo.description ?? photo.date;
      lbCount.textContent = `${index + 1} / ${photos.length}`;
      lbPreview.src = photo.thumbnail || photo.preview || photo.image;
      // 灯箱展示 ≤2000px 预览而非原图：原图最大可达 ~52MP/30MB，
      // 直接加载会在主线程解码时把页面卡死；原图改由「查看原图」在新标签页打开。
      lbImage.src = photo.preview || photo.image;
      lbOriginal.href = photo.image;
      lbImage.alt = photo.title;
      lbImage.classList.add('opacity-0');
      lbImage.onload = () => lbImage.classList.remove('opacity-0');
      lightbox.classList.remove('hidden');
      lightbox.classList.add('flex', 'is-open');
      lightbox.style.pointerEvents = 'auto';
      document.body.style.overflow = 'hidden';
    }

    function close() {
      lightbox.classList.add('hidden');
      lightbox.classList.remove('flex', 'is-open');
      lightbox.style.pointerEvents = 'none';
      document.body.style.overflow = '';
      lbImage.src = '';
      lbPreview.src = '';
    }

    async function step(dir: 1 | -1) {
      const next = currentIndex + dir;
      if (next < 0) return openAt(photos.length - 1);
      if (next >= photos.length) {
        if (!cursor) return openAt(0);
        await loadPage();
      }
      if (photos.length) openAt((currentIndex + dir + photos.length) % photos.length);
    }

    const onLbClose = () => close();
    const onLbPrev = () => void step(-1);
    const onLbNext = () => void step(1);
    const onLbClick = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target === lightbox) return close();

      // figure 会覆盖灯箱的大部分区域：点击其中的图片或说明文字不关闭，
      // 点击其余空白区域则视为点击遮罩。
      if (target.closest('figure') && !target.closest('img, figcaption')) close();
    };
    const onKeydown = (event: KeyboardEvent) => {
      if (lightbox.classList.contains('hidden')) return;
      if (event.key === 'Escape') close();
      if (event.key === 'ArrowLeft') void step(-1);
      if (event.key === 'ArrowRight') void step(1);
    };
    const onTouchStart = (event: TouchEvent) => {
      const touch = event.changedTouches[0];
      touchX = touch.clientX;
      touchY = touch.clientY;
    };
    const onTouchEnd = (event: TouchEvent) => {
      const touch = event.changedTouches[0];
      const dx = touch.clientX - touchX;
      const dy = touch.clientY - touchY;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) void step(dx < 0 ? 1 : -1);
    };

    document.getElementById('lb-close')?.addEventListener('click', onLbClose, { signal });
    document.getElementById('lb-prev')?.addEventListener('click', onLbPrev, { signal });
    document.getElementById('lb-next')?.addEventListener('click', onLbNext, { signal });
    lightbox.addEventListener('click', onLbClick, { signal });
    document.addEventListener('keydown', onKeydown, { signal });
    lightbox.addEventListener('touchstart', onTouchStart, { passive: true, signal });
    lightbox.addEventListener('touchend', onTouchEnd, { passive: true, signal });

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadPage();
    }, { rootMargin: '900px 0px' });
    observer.observe(sentinel);
    void loadPage(true);

    if (reduceMotion) document.documentElement.dataset.reducedMotion = 'true';

    return () => {
      controller.abort();
      observer.disconnect();
      document.body.style.overflow = '';
    };
  }, [mounted]);

  const lightboxMarkup = (
    /* 动态灯箱：缩略图先到，原图随后替换，弱网下不会出现空白大图。 */
    <div
      id="lightbox"
      className="pointer-events-none fixed inset-0 z-[80] hidden items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="作品预览"
    >
      <button id="lb-close" type="button" aria-label="关闭" className="absolute right-5 top-5 z-20 rounded-full p-2 text-white/70 transition-colors hover:text-white">
        <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
      </button>
      <button id="lb-prev" aria-label="上一张" className="absolute left-1 top-1/2 z-10 -translate-y-1/2 rounded-full p-4 text-white/70 transition-colors hover:text-white sm:left-6">
        <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
      </button>
      <button id="lb-next" aria-label="下一张" className="absolute right-1 top-1/2 z-10 -translate-y-1/2 rounded-full p-4 text-white/70 transition-colors hover:text-white sm:right-6">
        <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" /></svg>
      </button>
      <figure className="w-full max-h-[88vh] max-w-[92vw] text-center">
        <div className="relative min-h-24 min-w-24">
          <img id="lb-preview" alt="" decoding="async" className="mx-auto max-h-[78vh] max-w-full rounded-xl object-contain opacity-70 blur-sm transition-opacity" />
          <img id="lb-img" alt="" decoding="async" className="absolute inset-0 mx-auto max-h-[78vh] max-w-full rounded-xl object-contain opacity-0 transition-opacity" />
        </div>
        <figcaption className="mt-4">
          <p id="lb-title" className="font-display text-lg font-bold text-white"></p>
          <p id="lb-desc" className="mt-1 text-sm text-white/70"></p>
          <p id="lb-count" className="mt-2 text-xs tracking-widest text-white/60"></p>
          <a id="lb-original" href="#" target="_blank" rel="noopener" className="mt-1 inline-block text-xs text-white/70 underline-offset-4 transition-colors hover:text-white hover:underline">查看原图</a>
        </figcaption>
      </figure>
    </div>
  );

  if (!mounted) return null;

  return createPortal(lightboxMarkup, document.body);
}