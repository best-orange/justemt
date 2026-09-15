import type { Metadata } from 'next';
import MusicRoomScript from '@/components/music-room';
import { env } from '@/lib/env';

export const metadata: Metadata = {
  title: '音乐室 · justEMT',
  description: 'Emilia 的雪夜音乐室，收录冰晶与微光。',
};

export default function MusicPage() {
  const musicAvailable = Boolean(env('MUSIC_API_KEY') && env('MUSIC_PLAYLIST_ID'));

  return (
    <>
      <section className="music-room reveal" id="music-room">
        <header className="music-room__intro">
          <div className="music-room__intro-copy">
            <p className="eyebrow text-lilac-500 dark:text-lilac-300">EMILIA'S WINTER MUSIC ROOM</p>
            <h1 className="mt-4 font-display text-4xl font-black tracking-wide text-slate-900 dark:text-white sm:text-6xl">
              <span className="text-frost">音乐室</span>
            </h1>
            <p className="mt-4 max-w-xl text-base leading-8 text-slate-600 dark:text-slate-300">
              在雪落下来的时候，留一盏灯，听一首歌。这里是属于 Emilia 的安静角落。
            </p>
          </div>
          <span className="music-room__status-chip">
            <span className="music-room__status-dot" aria-hidden="true"></span>
            {musicAvailable ? 'SERVICE READY' : 'AWAITING SERVICE'}
          </span>
        </header>

        <div className="music-room__visual mt-10 overflow-hidden rounded-3xl border border-white/20 shadow-2xl shadow-night-950/15 dark:border-lilac-300/10">
          <div className="music-room__visual-wash"></div>
          <div className="relative grid min-h-[34rem] items-end gap-10 p-6 sm:p-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(22rem,1.1fr)] lg:items-center lg:p-14">
            <div className="music-room__visual-copy max-w-lg">
              <p className="music-room__visual-kicker text-xs tracking-[0.32em] text-white/80">A LITTLE LIGHT IN THE SNOW</p>
              <p className="mt-5 font-display text-3xl font-bold leading-relaxed text-white sm:text-5xl">愿这段旋律，陪你走过安静的夜晚。</p>
              <p className="mt-5 text-sm leading-7 text-white/80">播放由你的第一次点击开始。离开页面时，歌曲与进度会留在这里。</p>
            </div>

            <div className="music-room__now glass-dark mx-auto w-full max-w-md p-5 sm:p-7">
              <div className="flex gap-5">
                <div className="music-room__cover-shell shrink-0 overflow-hidden rounded-2xl bg-white/10">
                  <img id="room-cover" alt="当前歌曲封面" className="h-28 w-28 object-cover opacity-0 transition-opacity sm:h-36 sm:w-36" />
                  <div id="room-cover-placeholder" className="grid h-28 w-28 place-items-center text-white/70 sm:h-36 sm:w-36" aria-hidden="true">
                    <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" strokeWidth="1.4" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 0 1-1.632 2.163l-1.32.377a1.803 1.803 0 1 1-.99-3.467l2.31-.66A2.25 2.25 0 0 0 17.5 10.19V4.882a1.5 1.5 0 0 0-1.867-1.455l-9 2.572A1.5 1.5 0 0 0 5.5 7.454v10.099a2.25 2.25 0 0 1-1.632 2.163l-1.32.377a1.803 1.803 0 1 1-.99-3.467l2.31-.66A2.25 2.25 0 0 0 5.5 13.803Z" /></svg>
                  </div>
                </div>
                <div className="min-w-0 self-center">
                  <p className="text-[0.65rem] tracking-[0.26em] text-lilac-200/75">NOW PLAYING</p>
                  <h2 id="room-title" className="mt-2 truncate font-display text-xl font-bold text-white">正在打开音乐室…</h2>
                  <p id="room-artist" className="mt-1 truncate text-sm text-white/80"></p>
                </div>
              </div>

              <input id="room-progress" className="music-progress music-progress--light mt-8 w-full" type="range" min="0" max="0" step="1" defaultValue="0" aria-label="播放进度" />
              <div className="mt-1 flex justify-between text-[0.68rem] tabular-nums text-white/70" aria-hidden="true"><span id="room-current">0:00</span><span id="room-duration">0:00</span></div>
              <div className="mt-5 flex items-center justify-center gap-2 sm:gap-4">
                <button id="room-repeat" type="button" aria-label="循环关闭" aria-pressed="false" className="room-control rounded-full p-2.5 text-white/80 transition-colors hover:bg-white/10 hover:text-white">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.6" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M17 2.75 20.25 6 17 9.25M4 12V9.5A3.5 3.5 0 0 1 7.5 6h12.75M7 21.25 3.75 18 7 14.75M20 12v2.5a3.5 3.5 0 0 1-3.5 3.5H3.75" /></svg>
                </button>
                <button id="room-prev" type="button" aria-label="上一首" className="room-control rounded-full p-2.5 text-white/80 transition-colors hover:bg-white/10 hover:text-white">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth="1.6" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 6.75v10.5L10.5 12l9-5.25ZM4.5 6.75v10.5" /></svg>
                </button>
                <button id="room-play" type="button" aria-label="播放" className="room-control room-control--main rounded-full bg-white p-4 text-night-950 shadow-lg shadow-black/20 transition-transform hover:scale-105">
                  <svg id="room-icon-play" className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth="1.7" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 0 1 0 1.971l-11.54 6.347a1.125 1.125 0 0 1-1.667-.985V5.653Z" /></svg>
                  <svg id="room-icon-pause" className="hidden h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth="1.7" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25v13.5m-7.5-13.5v13.5" /></svg>
                </button>
                <button id="room-next" type="button" aria-label="下一首" className="room-control rounded-full p-2.5 text-white/80 transition-colors hover:bg-white/10 hover:text-white">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth="1.6" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 6.75 9 5.25-9 5.25V6.75ZM19.5 6.75v10.5" /></svg>
                </button>
              </div>
            </div>
          </div>
        </div>

        <section className="mt-16">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="eyebrow text-lilac-500 dark:text-lilac-300">THE FIXED PLAYLIST</p>
              <h2 className="mt-3 font-display text-2xl font-bold text-slate-900 dark:text-white sm:text-3xl">RE:0 曲目收藏</h2>
            </div>
            <span id="room-count" className="music-room__count text-sm tabular-nums text-slate-400"></span>
          </div>
          <div id="room-playlist" className="room-track-list music-room__playlist mt-8 max-w-3xl" aria-live="polite"></div>
          <p id="room-status" className="music-room__status mt-6 text-sm text-slate-400">正在整理曲目…</p>
        </section>

        {!musicAvailable && (
          <p className="music-room__notice mt-8 text-sm text-slate-500 dark:text-slate-300">音乐服务尚未连接，配置完成后这里会出现固定歌单。</p>
        )}
      </section>
      <MusicRoomScript />
    </>
  );
}