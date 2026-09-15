import type { Metadata } from 'next';
import GalleryClient from '@/components/gallery-client';

export const metadata: Metadata = {
  title: '画廊 · justEMT',
  description: '冰晶与微光 —— 爱蜜莉雅主题画廊。',
};

export default function GalleryPage() {
  return (
    <>
      <section data-gallery-page className="reveal">
        <header>
          <div className="flex items-end justify-between gap-4">
            <div>
              <h1 className="font-display text-4xl font-black tracking-wide">
                <span className="text-frost">画廊</span>
              </h1>
              <p className="mt-3 text-slate-600 dark:text-slate-300">
                冰晶、微光与雪夜。点击任意作品查看大图。
              </p>
            </div>
            <a href="/gallery/manage" className="hidden rounded-full border border-lilac-400/30 px-3 py-1.5 text-xs text-slate-500 transition-colors hover:border-lilac-400 hover:text-violet-700 dark:text-slate-300 dark:hover:text-lilac-200 sm:inline-flex">
              管理馆藏
            </a>
          </div>
        </header>

        <div className="mt-8 flex min-h-8 flex-wrap items-center gap-2" id="tag-filter" aria-label="画廊标签筛选">
          <span className="text-sm text-slate-400 dark:text-slate-300">载入标签…</span>
        </div>

        <div className="masonry mt-8 columns-2 md:columns-3" id="gallery-grid" aria-live="polite"></div>
        <div id="gallery-sentinel" className="flex min-h-20 items-center justify-center text-sm text-slate-300 dark:text-slate-200">
          <span id="gallery-status">正在打开画册…</span>
        </div>
      </section>

      <GalleryClient />
    </>
  );
}