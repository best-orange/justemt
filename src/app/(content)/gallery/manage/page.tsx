import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import ManageScript from '@/components/manage-script';
import { AUTH_COOKIE, verifyToken } from '@/lib/auth';

export const metadata: Metadata = {
  title: '管理馆藏 · justEMT',
  description: '上传和整理 justEMT 画廊作品。',
};

export default async function GalleryManagePage() {
  // 管理页访问控制：与旧版中间件行为一致，未登录跳转登录页并带回跳来源
  const jar = await cookies();
  if (!verifyToken(jar.get(AUTH_COOKIE)?.value)) {
    redirect(`/login?next=${encodeURIComponent('/gallery/manage')}`);
  }

  return (
    <>
      <section className="reveal">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs tracking-[0.35em] text-lilac-500 dark:text-lilac-300">PRIVATE CURATION</p>
            <h1 className="mt-3 font-display text-4xl font-black tracking-wide"><span className="text-frost">管理馆藏</span></h1>
            <p className="mt-3 text-slate-600 dark:text-slate-300">图片由浏览器生成预览图后直传 R2，登记时服务器会校验原图完整性。</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <a href="/visitors" className="rounded-full border border-lilac-400/30 px-3 py-1.5 text-xs text-slate-500 transition-colors hover:border-lilac-400 hover:text-violet-700 dark:text-slate-300 dark:hover:text-lilac-200">来访雪笺</a>
            <a href="/gallery" className="rounded-full border border-lilac-400/30 px-3 py-1.5 text-xs text-slate-500 transition-colors hover:border-lilac-400 hover:text-violet-700 dark:text-slate-300 dark:hover:text-lilac-200">返回画廊</a>
          </div>
        </div>

        <form id="upload-form" className="glass mt-10 rounded-3xl p-6 sm:p-8">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">
            选择图片（可多选）
            <input id="file-input" type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple required className="mt-2 block w-full cursor-pointer rounded-xl border border-dashed border-lilac-400/40 bg-white/40 p-4 text-sm text-slate-500 file:mr-3 file:rounded-lg file:border-0 file:bg-lilac-400/20 file:px-3 file:py-2 file:text-sm file:text-violet-700 dark:bg-night-950/30 dark:text-slate-300 dark:file:text-lilac-200" />
          </label>
          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">
              标题前缀（留空使用文件名）
              <input id="title-input" type="text" maxLength={120} placeholder="例如：雪夜里的 Emilia" className="mt-2 w-full rounded-xl border border-lilac-400/25 bg-white/50 px-3 py-2.5 text-sm outline-none transition-colors focus:border-lilac-400 dark:bg-night-950/30" />
            </label>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">
              日期
              <input id="date-input" type="date" className="mt-2 w-full rounded-xl border border-lilac-400/25 bg-white/50 px-3 py-2.5 text-sm outline-none transition-colors focus:border-lilac-400 dark:bg-night-950/30" />
            </label>
          </div>
          <label className="mt-5 block text-sm font-medium text-slate-700 dark:text-slate-200">
            标签（逗号分隔）
            <input id="tags-input" type="text" placeholder="自定义标签，用逗号分隔" className="mt-2 w-full rounded-xl border border-lilac-400/25 bg-white/50 px-3 py-2.5 text-sm outline-none transition-colors focus:border-lilac-400 dark:bg-night-950/30" />
          </label>
          <label className="mt-5 block text-sm font-medium text-slate-700 dark:text-slate-200">
            作品说明（多张图片共用）
            <textarea id="description-input" rows={3} maxLength={500} placeholder="可选" className="mt-2 w-full resize-y rounded-xl border border-lilac-400/25 bg-white/50 px-3 py-2.5 text-sm outline-none transition-colors focus:border-lilac-400 dark:bg-night-950/30"></textarea>
          </label>
          <div className="mt-6 flex flex-wrap items-center gap-4">
            <button id="upload-button" type="submit" className="rounded-xl bg-gradient-to-r from-lilac-500 to-ice-400 px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-lilac-500/20 transition-transform hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-50">上传到 R2</button>
            <p id="upload-status" className="text-sm text-slate-500 dark:text-slate-300" role="status"></p>
          </div>
        </form>

        <section className="mt-12">
          <div className="flex items-end justify-between">
            <h2 className="font-display text-2xl font-bold text-frost">远程馆藏</h2>
            <span id="remote-count" className="text-xs text-slate-400 dark:text-slate-300"></span>
          </div>
          <div id="remote-list" className="mt-5 grid gap-3 sm:grid-cols-2"></div>
        </section>
      </section>
      <ManageScript />
    </>
  );
}