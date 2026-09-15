import type { Metadata } from 'next';
import VisitorsScript from '@/components/visitors-script';

export const metadata: Metadata = {
  title: '来访雪笺 · justEMT',
  description: '记录每一份匿名来访的微光。',
};

export default function VisitorsPage() {
  return (
    <>
      <section data-visitors-page className="reveal">
        <header>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs tracking-[0.35em] text-lilac-500 dark:text-lilac-300">VISITOR LOG</p>
              <h1 className="mt-3 font-display text-4xl font-black tracking-wide"><span className="text-frost">来访雪笺</span></h1>
              <p className="mt-3 text-slate-600 dark:text-slate-300">每一份来访都会留下微光，IP 后半部分已用星号隐藏。</p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button id="visitor-refresh" type="button" className="rounded-full border border-lilac-400/30 px-3 py-1.5 text-xs text-slate-500 transition-colors hover:border-lilac-400 hover:text-violet-700 dark:text-slate-300 dark:hover:text-lilac-200">刷新</button>
              <button
                id="visitor-reset-toggle"
                type="button"
                aria-expanded="false"
                aria-controls="visitor-reset-form"
                className="rounded-full border border-rose-400/30 px-3 py-1.5 text-xs text-rose-500 transition-colors hover:border-rose-400 hover:text-rose-600 dark:text-rose-300 dark:hover:text-rose-200"
              >重置记录</button>
              <a href="/" className="rounded-full border border-lilac-400/30 px-3 py-1.5 text-xs text-slate-500 transition-colors hover:border-lilac-400 hover:text-violet-700 dark:text-slate-300 dark:hover:text-lilac-200">返回大厅</a>
            </div>
          </div>
        </header>

        <form id="visitor-reset-form" className="glass mt-6 hidden rounded-2xl p-5" aria-labelledby="visitor-reset-title">
          <h2 id="visitor-reset-title" className="font-display text-lg font-bold text-frost">清空最近足迹</h2>
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-400">
            只清空下方的足迹列表，累计访客、累计来访次数与今日统计都会保留。清空后无法恢复。
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="visitor-reset-password">暗号</label>
            <input
              id="visitor-reset-password"
              type="password"
              name="password"
              required
              autoComplete="current-password"
              placeholder="暗号"
              className="min-w-[10rem] flex-1 rounded-xl border border-lilac-400/30 bg-white/60 px-4 py-2 text-sm text-slate-700 outline-none transition-colors placeholder:text-slate-400 focus:border-lilac-400 dark:bg-white/10 dark:text-slate-100"
            />
            <button
              type="submit"
              className="rounded-xl bg-gradient-to-r from-rose-500 to-lilac-500 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-rose-500/20 transition-transform hover:scale-[1.02] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:scale-100"
            >确认清空</button>
            <button
              id="visitor-reset-cancel"
              type="button"
              className="rounded-xl border border-lilac-400/30 px-4 py-2 text-sm text-slate-500 transition-colors hover:border-lilac-400 hover:text-violet-700 dark:text-slate-300 dark:hover:text-lilac-200"
            >取消</button>
          </div>
          <p id="visitor-reset-message" className="mt-3 hidden text-sm" role="status"></p>
        </form>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <article className="glass rounded-2xl p-5">
            <p className="text-sm text-slate-500 dark:text-slate-300">累计访客</p>
            <p id="visitor-total-unique" className="mt-2 font-display text-3xl font-bold text-frost">—</p>
            <p className="mt-1 text-xs text-slate-400 dark:text-slate-400">按匿名浏览器去重</p>
          </article>
          <article className="glass rounded-2xl p-5">
            <p className="text-sm text-slate-500 dark:text-slate-300">今日访客</p>
            <p id="visitor-today-unique" className="mt-2 font-display text-3xl font-bold text-frost">—</p>
            <p className="mt-1 text-xs text-slate-400 dark:text-slate-400">按匿名浏览器去重</p>
          </article>
          <article className="glass rounded-2xl p-5">
            <p className="text-sm text-slate-500 dark:text-slate-300">今日来访次数</p>
            <p id="visitor-today-visits" className="mt-2 font-display text-3xl font-bold text-frost">—</p>
            <p className="mt-1 text-xs text-slate-400 dark:text-slate-400">同一访客 30 分钟内算一次</p>
          </article>
          <article className="glass rounded-2xl p-5">
            <p className="text-sm text-slate-500 dark:text-slate-300">网站运行时间</p>
            <p id="visitor-uptime" className="mt-2 font-display text-2xl font-bold text-frost">—</p>
            <p id="visitor-started" className="mt-1 text-xs text-slate-400 dark:text-slate-400">正在计算…</p>
          </article>
        </div>

        <section className="glass mt-6 rounded-3xl p-5 sm:p-6" aria-labelledby="visitor-recent-title">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 id="visitor-recent-title" className="font-display text-2xl font-bold text-frost">最近足迹</h2>
              <p className="mt-1 text-xs text-slate-400 dark:text-slate-400">仅保留最近 100 条，IP 后半部分已隐藏。</p>
            </div>
            <div className="text-right">
              <span id="visitor-status" className="block text-xs text-slate-400 dark:text-slate-400" role="status">载入中…</span>
              <span id="visitor-storage" className="mt-1 block text-[10px] text-slate-400 dark:text-slate-500">正在检查存储状态…</span>
            </div>
          </div>
          <div id="visitor-list" className="mt-5 divide-y divide-lilac-400/10">
            <p className="py-5 text-sm text-slate-400 dark:text-slate-400">正在翻开雪笺…</p>
          </div>
        </section>
      </section>
      <VisitorsScript />
    </>
  );
}