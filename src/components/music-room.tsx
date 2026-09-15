'use client';

import { useEffect } from 'react';

type Track = { id: string; name: string; artist: string; cover: string };
type State = { tracks: Track[]; index: number; playing: boolean; currentTime: number; duration: number; repeat: boolean };

/**
 * 音乐室页面脚本：与全局 MusicPlayer 通过 justemt:music:* 事件协作。
 * 组件挂载即初始化，卸载时清理，对应 Astro 版的 page-load / before-swap。
 */
export default function MusicRoomScript() {
  useEffect(() => {
    const room = document.getElementById('music-room');
    if (!room) return;

    const cover = document.getElementById('room-cover') as HTMLImageElement;
    const placeholder = document.getElementById('room-cover-placeholder');
    const title = document.getElementById('room-title');
    const artist = document.getElementById('room-artist');
    const progress = document.getElementById('room-progress') as HTMLInputElement;
    const current = document.getElementById('room-current');
    const duration = document.getElementById('room-duration');
    const roomPlay = document.getElementById('room-play');
    const playIcon = document.getElementById('room-icon-play');
    const pauseIcon = document.getElementById('room-icon-pause');
    const repeatButton = document.getElementById('room-repeat');
    const playlist = document.getElementById('room-playlist');
    const status = document.getElementById('room-status');
    const count = document.getElementById('room-count');
    if (!cover || !placeholder || !title || !artist || !progress || !current || !duration || !roomPlay || !playIcon || !pauseIcon || !repeatButton || !playlist || !status || !count) return;

    const clock = (value: number) => Number.isFinite(value) ? `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}` : '0:00';

    const dispatch = (name: string, detail?: unknown) => window.dispatchEvent(new CustomEvent(name, { detail }));
    const renderPlaylist = (tracks: Track[], activeIndex: number) => {
      playlist.replaceChildren();
      tracks.forEach((track, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'room-track group flex w-full items-center gap-3 py-3 text-left transition-colors hover:text-violet-700 dark:hover:text-lilac-200';
        button.setAttribute('aria-label', `播放 ${track.name}`);
        button.dataset.trackId = track.id;
        const number = document.createElement('span');
        number.className = 'room-track__number w-6 text-center text-xs tabular-nums text-slate-400';
        number.textContent = String(index + 1).padStart(2, '0');
        const text = document.createElement('span');
        text.className = 'min-w-0 flex-1';
        const name = document.createElement('span');
        name.className = 'block truncate text-sm font-medium';
        name.textContent = track.name;
        const byline = document.createElement('span');
        byline.className = 'mt-0.5 block truncate text-xs text-slate-400';
        byline.textContent = track.artist || 'Emilia selection';
        text.append(name, byline);
        const icon = document.createElement('span');
        icon.className = 'room-track__icon text-lilac-500';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = '▶';
        button.append(number, text, icon);
        button.addEventListener('click', () => dispatch('justemt:music:select', { id: track.id, autoplay: true }));
        playlist.append(button);
      });
      playlist.querySelectorAll<HTMLButtonElement>('.room-track').forEach((button) => {
        const active = button.dataset.trackId === tracks[activeIndex]?.id;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-current', active ? 'true' : 'false');
      });
      count.textContent = tracks.length ? `${tracks.length} 首` : '';
      status.textContent = tracks.length ? '固定歌单 · 随时回来继续' : '歌单暂时没有曲目';
    };
    const onState = (event: Event) => {
      const state = (event as CustomEvent<State>).detail;
      if (!state) return;
      const track = state.tracks[state.index];
      if (track) {
        title.textContent = track.name;
        artist.textContent = track.artist || 'Emilia selection';
        if (track.cover) {
          cover.src = `${track.cover}?param=300y300`;
          cover.alt = `${track.name} 封面`;
          cover.classList.remove('opacity-0');
          placeholder.classList.add('hidden');
        }
      }
      if (state.tracks.length) renderPlaylist(state.tracks, state.index);
      progress.max = String(state.duration || 0);
      progress.value = String(state.currentTime || 0);
      current.textContent = clock(state.currentTime);
      duration.textContent = clock(state.duration);
      playIcon.classList.toggle('hidden', state.playing);
      pauseIcon.classList.toggle('hidden', !state.playing);
      roomPlay.setAttribute('aria-label', state.playing ? '暂停' : '播放');
      repeatButton.setAttribute('aria-pressed', String(state.repeat));
      repeatButton.setAttribute('aria-label', state.repeat ? '循环当前歌曲' : '循环关闭');
      repeatButton.classList.toggle('text-ice-200', state.repeat);
    };

    const onRoomPlay = () => dispatch('justemt:music:toggle');
    const onPrev = () => dispatch('justemt:music:step', { direction: -1 });
    const onNext = () => dispatch('justemt:music:step', { direction: 1 });
    const onRepeat = () => dispatch('justemt:music:toggle-repeat');
    const onSeek = () => dispatch('justemt:music:seek', { value: Number(progress.value) });

    window.addEventListener('justemt:music:state', onState);
    roomPlay.addEventListener('click', onRoomPlay);
    document.getElementById('room-prev')?.addEventListener('click', onPrev);
    document.getElementById('room-next')?.addEventListener('click', onNext);
    repeatButton.addEventListener('click', onRepeat);
    progress.addEventListener('input', onSeek);
    dispatch('justemt:music:request-state');
    room.classList.add('is-visible');

    return () => {
      window.removeEventListener('justemt:music:state', onState);
      roomPlay.removeEventListener('click', onRoomPlay);
      document.getElementById('room-prev')?.removeEventListener('click', onPrev);
      document.getElementById('room-next')?.removeEventListener('click', onNext);
      repeatButton.removeEventListener('click', onRepeat);
      progress.removeEventListener('input', onSeek);
    };
  }, []);

  return null;
}