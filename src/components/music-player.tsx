'use client';

import { useEffect, useState } from 'react';

type Track = { id: string; name: string; artist: string; cover: string };
type PlayerState = {
  tracks: Track[];
  index: number;
  playing: boolean;
  currentTime: number;
  duration: number;
  repeat: boolean;
};

/**
 * 全站音乐控制器。曲目和播放地址始终经由 /api/music 获取，
 * MUSIC_API_KEY 只在服务端使用。挂在根布局，客户端导航时音频不中断。
 */
export default function MusicPlayer() {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const root = document.getElementById('music-player');
    if (!root) return;

    const controller = new AbortController();
    // 所有监听都挂在 abort signal 上：卸载（含开发模式双重挂载）时一次性清理，避免残留重复处理器
    const on = (target: EventTarget, type: string, fn: (event: Event) => void) =>
      target.addEventListener(type, fn as EventListener, { signal: controller.signal });

    const dom = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;
    const audio = dom<HTMLAudioElement>('mp-audio');
    const panel = dom<HTMLDivElement>('mp-panel');
    const toggle = dom<HTMLButtonElement>('mp-toggle');
    const compact = dom<HTMLButtonElement>('mp-compact');
    const cover = dom<HTMLImageElement>('mp-cover');
    const note = dom<HTMLElement>('mp-note');
    const progress = dom<HTMLInputElement>('mp-progress');
    const title = dom<HTMLElement>('mp-title');
    const artist = dom<HTMLElement>('mp-artist');
    const compactTitle = dom<HTMLElement>('mp-title-compact');
    const compactArtist = dom<HTMLElement>('mp-artist-compact');
    const iconPlay = dom<HTMLElement>('mp-icon-play');
    const iconPause = dom<HTMLElement>('mp-icon-pause');
    const iconPlayCompact = dom<HTMLElement>('mp-icon-play-compact');
    const iconPauseCompact = dom<HTMLElement>('mp-icon-pause-compact');
    const current = dom<HTMLElement>('mp-current');
    const duration = dom<HTMLElement>('mp-duration');

    if (
      !audio || !panel || !toggle || !compact || !cover || !note || !progress ||
      !title || !artist || !compactTitle || !compactArtist || !iconPlay || !iconPause ||
      !iconPlayCompact || !iconPauseCompact || !current || !duration
    ) return;

    const storageKey = 'justemt-music-state';
    const fail = () => {
      controller.abort();
      setFailed(true);
    };

    let tracks: Track[] = [];
    let index = 0;
    let repeat = false;
    let userStarted = false;
    let pendingTime = 0;
    let loadingPromise: Promise<void> | null = null;
    const urlCache = new Map<string, string>();

    const readSaved = () => {
      try { return JSON.parse(localStorage.getItem(storageKey) ?? '{}') as { id?: string; time?: number; repeat?: boolean }; } catch { return {}; }
    };
    const save = () => {
      try { localStorage.setItem(storageKey, JSON.stringify({ id: tracks[index]?.id, time: audio.currentTime || 0, repeat })); } catch { /* storage may be unavailable */ }
    };
    const clock = (value: number) => {
      if (!Number.isFinite(value)) return '0:00';
      const minutes = Math.floor(value / 60);
      return `${minutes}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
    };
    const state = (): PlayerState => ({ tracks, index, playing: !audio.paused, currentTime: audio.currentTime || 0, duration: audio.duration || 0, repeat });
    const announce = () => window.dispatchEvent(new CustomEvent('justemt:music:state', { detail: state() }));
    const setExpanded = (open: boolean) => {
      panel.classList.toggle('hidden', !open);
      root.dataset.collapsed = String(!open);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? '收起音乐播放器' : '展开音乐播放器');
    };
    const setPlayingIcon = (playing: boolean) => {
      iconPlay.classList.toggle('hidden', playing);
      iconPause.classList.toggle('hidden', !playing);
      iconPlayCompact.classList.toggle('hidden', playing);
      iconPauseCompact.classList.toggle('hidden', !playing);
      dom<HTMLElement>('mp-play')?.setAttribute('aria-label', playing ? '暂停' : '播放');
      dom<HTMLElement>('mp-play-compact')?.setAttribute('aria-label', playing ? '暂停' : '播放');
    };
    const render = () => {
      const track = tracks[index];
      if (!track) return;
      title.textContent = track.name;
      artist.textContent = track.artist || 'Emilia selection';
      compactTitle.textContent = track.name;
      compactArtist.textContent = track.artist || 'Emilia selection';
      if (track.cover) {
        cover.src = `${track.cover}?param=120y120`;
        cover.alt = `${track.name} 封面`;
        cover.classList.remove('opacity-0');
        note.classList.add('hidden');
      }
      announce();
    };
    const resolveUrl = async (track: Track) => {
      const cached = urlCache.get(track.id);
      if (cached) return cached;
      try {
        const response = await fetch(`/api/music?action=url&id=${encodeURIComponent(track.id)}`);
        const body = await response.json() as { ok?: boolean; url?: string };
        if (!body.ok || !body.url) return null;
        urlCache.set(track.id, body.url);
        return body.url;
      } catch { return null; }
    };
    const playCurrent = async () => {
      if (!tracks[index]) return;
      userStarted = true;
      if (!audio.src) {
        const source = await resolveUrl(tracks[index]);
        if (!source) return;
        audio.src = source;
        if (pendingTime > 0) audio.addEventListener('loadedmetadata', () => { audio.currentTime = pendingTime; pendingTime = 0; }, { once: true });
      }
      try { await audio.play(); } catch { setPlayingIcon(false); }
    };
    const selectTrack = async (nextIndex: number, autoplay: boolean) => {
      if (!tracks.length) return;
      index = (nextIndex + tracks.length) % tracks.length;
      pendingTime = 0;
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      render();
      save();
      if (autoplay) await playCurrent();
    };
    const step = (direction: 1 | -1, autoplay = true) => selectTrack(index + direction, autoplay);
    const load = async () => {
      if (loadingPromise) return loadingPromise;
      loadingPromise = (async () => {
        try {
          const response = await fetch('/api/music?action=playlist');
          const body = await response.json() as { ok?: boolean; tracks?: Track[] };
          if (!body.ok || !body.tracks?.length) { fail(); return; }
          tracks = body.tracks;
          const saved = readSaved();
          repeat = Boolean(saved.repeat);
          const savedIndex = tracks.findIndex((track) => track.id === saved.id);
          index = savedIndex >= 0 ? savedIndex : 0;
          pendingTime = savedIndex >= 0 && Number.isFinite(saved.time) ? Math.max(0, saved.time ?? 0) : 0;
          render();
          dom<HTMLElement>('mp-repeat')?.setAttribute('aria-pressed', String(repeat));
          dom<HTMLElement>('mp-repeat')?.setAttribute('aria-label', repeat ? '循环当前歌曲' : '循环关闭');
          announce();
        } catch { fail(); }
      })();
      return loadingPromise;
    };

    const onToggleClick = () => setExpanded(root.dataset.collapsed === 'true');
    const onCompactClick = () => setExpanded(true);
    const onPrevClick = () => void step(-1);
    const onNextClick = () => void step(1);
    const onPlayClick = () => (audio.paused ? void playCurrent() : audio.pause());

    on(toggle, 'click', onToggleClick);
    on(compact, 'click', onCompactClick);
    const prevButton = dom<HTMLButtonElement>('mp-prev');
    const nextButton = dom<HTMLButtonElement>('mp-next');
    const playButton = dom<HTMLButtonElement>('mp-play');
    const playCompactButton = dom<HTMLButtonElement>('mp-play-compact');
    const repeatButton = dom<HTMLButtonElement>('mp-repeat');
    const onRepeatClick = (event: Event) => {
      repeat = !repeat;
      const button = event.currentTarget as HTMLButtonElement;
      button.setAttribute('aria-pressed', String(repeat));
      button.setAttribute('aria-label', repeat ? '循环当前歌曲' : '循环关闭');
      button.classList.toggle('text-violet-700', repeat);
      button.classList.toggle('dark:text-lilac-300', repeat);
      save();
      announce();
    };
    if (prevButton) on(prevButton, 'click', onPrevClick);
    if (nextButton) on(nextButton, 'click', onNextClick);
    if (playButton) on(playButton, 'click', onPlayClick);
    if (playCompactButton) on(playCompactButton, 'click', onPlayClick);
    if (repeatButton) on(repeatButton, 'click', onRepeatClick);
    on(window, 'justemt:music:toggle', () => (audio.paused ? void playCurrent() : audio.pause()));
    on(window, 'justemt:music:toggle-repeat', () => dom<HTMLButtonElement>('mp-repeat')?.click());
    on(window, 'justemt:music:step', (event) => {
      const direction = (event as CustomEvent<{ direction?: 1 | -1 }>).detail?.direction;
      if (direction === 1 || direction === -1) void step(direction);
    });
    on(window, 'justemt:music:seek', (event) => {
      const value = Number((event as CustomEvent<{ value?: number }>).detail?.value);
      if (Number.isFinite(value)) audio.currentTime = value;
    });
    const onProgressInput = () => {
      audio.currentTime = Number(progress.value);
      current.textContent = clock(audio.currentTime);
      save();
      announce();
    };
    const onAudioPlay = () => { setPlayingIcon(true); announce(); };
    const onAudioPause = () => { setPlayingIcon(false); save(); announce(); };
    const onAudioTimeupdate = () => {
      progress.max = String(Number.isFinite(audio.duration) ? audio.duration : 0);
      progress.value = String(audio.currentTime || 0);
      current.textContent = clock(audio.currentTime);
      duration.textContent = clock(audio.duration);
      if (Math.floor(audio.currentTime) % 5 === 0) save();
      announce();
    };
    const onAudioLoadedmetadata = () => { duration.textContent = clock(audio.duration); progress.max = String(audio.duration || 0); announce(); };
    const onAudioEnded = () => void (repeat ? selectTrack(index, true) : step(1, userStarted));
    const onAudioError = () => {
      const track = tracks[index];
      if (track) urlCache.delete(track.id);
      setPlayingIcon(false);
      announce();
    };
    on(progress, 'input', onProgressInput);
    on(audio, 'play', onAudioPlay);
    on(audio, 'pause', onAudioPause);
    on(audio, 'timeupdate', onAudioTimeupdate);
    on(audio, 'loadedmetadata', onAudioLoadedmetadata);
    on(audio, 'ended', onAudioEnded);
    on(audio, 'error', onAudioError);
    on(window, 'justemt:music:select', (event) => {
      const detail = (event as CustomEvent<{ id?: string; index?: number; autoplay?: boolean }>).detail;
      const target = detail.id ? tracks.findIndex((track) => track.id === detail.id) : (detail.index ?? 0);
      if (target >= 0) void selectTrack(target, detail.autoplay !== false);
    });
    on(window, 'justemt:music:request-state', () => announce());
    on(window, 'beforeunload', () => save());
    setPlayingIcon(false);
    setExpanded(false);
    void load();

    return () => controller.abort();
  }, []);

  if (failed) return null;

  return (
    <div
      id="music-player"
      className="music-player glass fixed bottom-4 right-4 z-[60]"
      data-collapsed="true"
    >
      <div className="music-player__bar flex items-center gap-2 p-1.5">
        <button
          id="mp-toggle"
          type="button"
          aria-label="展开音乐播放器"
          aria-expanded="false"
          aria-controls="mp-panel"
          className="music-player__cover relative h-10 w-10 shrink-0 overflow-hidden rounded-xl bg-lilac-400/20"
        >
          <img id="mp-cover" alt="" className="h-full w-full object-cover opacity-0 transition-opacity" />
          <svg id="mp-note" className="absolute inset-0 m-auto h-4 w-4 text-lilac-500" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 0 1-1.632 2.163l-1.32.377a1.803 1.803 0 1 1-.99-3.467l2.31-.66A2.25 2.25 0 0 0 17.5 10.19V4.882a1.5 1.5 0 0 0-1.867-1.455l-9 2.572A1.5 1.5 0 0 0 5.5 7.454v10.099a2.25 2.25 0 0 1-1.632 2.163l-1.32.377a1.803 1.803 0 1 1-.99-3.467l2.31-.66A2.25 2.25 0 0 0 5.5 13.803Z" />
          </svg>
        </button>

        <button id="mp-compact" type="button" className="music-player__compact min-w-0 flex-1 text-left" aria-label="展开当前歌曲信息">
          <span id="mp-title-compact" className="block truncate text-xs font-semibold text-slate-700 dark:text-slate-100">正在打开音乐室…</span>
          <span id="mp-artist-compact" className="mt-0.5 block truncate text-[0.68rem] text-slate-500 dark:text-slate-300"></span>
        </button>

        <button id="mp-play-compact" type="button" aria-label="播放" className="music-control rounded-full p-2 text-violet-700 transition-colors hover:bg-lilac-400/15 dark:text-lilac-300">
          <svg id="mp-icon-play-compact" className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.7" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 0 1 0 1.971l-11.54 6.347a1.125 1.125 0 0 1-1.667-.985V5.653Z" /></svg>
          <svg id="mp-icon-pause-compact" className="hidden h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.7" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25v13.5m-7.5-13.5v13.5" /></svg>
        </button>
      </div>

      <div id="mp-panel" className="music-player__panel hidden border-t border-lilac-400/15 px-4 pb-4 pt-3">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p id="mp-title" className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">正在打开音乐室…</p>
            <p id="mp-artist" className="mt-1 truncate text-xs text-slate-500 dark:text-slate-300"></p>
          </div>
        </div>
        <input id="mp-progress" className="music-progress mt-4 w-full" type="range" min="0" max="0" step="1" defaultValue="0" aria-label="播放进度" />
        <div className="mt-1 flex justify-between text-[0.65rem] tabular-nums text-slate-400 dark:text-slate-300" aria-hidden="true"><span id="mp-current">0:00</span><span id="mp-duration">0:00</span></div>
        <div className="mt-3 flex items-center justify-center gap-2">
          <button id="mp-repeat" type="button" aria-label="循环关闭" aria-pressed="false" className="music-control rounded-full p-2 text-slate-500 transition-colors hover:bg-lilac-400/15 dark:text-slate-300">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.6" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M17 2.75 20.25 6 17 9.25M4 12V9.5A3.5 3.5 0 0 1 7.5 6h12.75M7 21.25 3.75 18 7 14.75M20 12v2.5a3.5 3.5 0 0 1-3.5 3.5H3.75" /></svg>
          </button>
          <button id="mp-prev" type="button" aria-label="上一首" className="music-control rounded-full p-2 text-slate-500 transition-colors hover:bg-lilac-400/15 dark:text-slate-300">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth="1.6" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 6.75v10.5L10.5 12l9-5.25ZM4.5 6.75v10.5" /></svg>
          </button>
          <button id="mp-play" type="button" aria-label="播放" className="music-control rounded-full bg-violet-700 p-3 text-white shadow-sm transition-colors hover:bg-violet-800 dark:bg-lilac-400 dark:text-night-950 dark:hover:bg-lilac-300">
            <svg id="mp-icon-play" className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth="1.7" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 0 1 0 1.971l-11.54 6.347a1.125 1.125 0 0 1-1.667-.985V5.653Z" /></svg>
            <svg id="mp-icon-pause" className="hidden h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth="1.7" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25v13.5m-7.5-13.5v13.5" /></svg>
          </button>
          <button id="mp-next" type="button" aria-label="下一首" className="music-control rounded-full p-2 text-slate-500 transition-colors hover:bg-lilac-400/15 dark:text-slate-300">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth="1.6" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 6.75 9 5.25-9 5.25V6.75ZM19.5 6.75v10.5" /></svg>
          </button>
        </div>
      </div>

      <audio id="mp-audio" preload="none"></audio>
    </div>
  );
}