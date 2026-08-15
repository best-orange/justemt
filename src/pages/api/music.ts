import type { APIRoute } from 'astro';
import { MusicApiError, type Track, fetchPlaylist, fetchSongUrl, playlistId } from '../../lib/music';
import { usage } from '../../lib/quota';
import { store } from '../../lib/store';

export const prerender = false;

/**
 * GET /api/music?action=playlist  —— 曲目列表
 * GET /api/music?action=url&id=x  —— 单曲播放地址
 * GET /api/music?action=quota     —— 当日配额用量（不消耗上游）
 *
 * 存在的意义是把 apikey 挡在服务端。上游 CORS 是全开的，浏览器本可直连，
 * 但那样 key 就明文躺在前端源码里了。
 *
 * 缓存全部走共享存储：配了 Upstash 时，同一首歌在 TTL 窗口内无论多少访客、
 * 落在哪个实例，都只消耗一次上游调用 —— 这才是把用量压在每日额度内的关键。
 */

const json = (data: unknown, status = 200, cache?: string) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...(cache ? { 'Cache-Control': cache } : {}),
    },
  });

/** 歌单变动少，缓存 1 小时 */
const PLAYLIST_TTL = Number(import.meta.env.MUSIC_PLAYLIST_TTL ?? 3600);

/**
 * 单曲地址缓存时长，默认 4 小时。
 * 上游返回的地址带时效但没说明具体多久；设长了偶尔会缓存到失效地址，
 * 前端 audio 报错时会清掉重取，代价只是一次重试，所以偏向设长以省配额。
 */
const SONG_TTL = Number(import.meta.env.MUSIC_SONG_TTL ?? 4 * 3600);

const PLAYLIST_KEY = 'music:playlist';
const songKey = (id: string) => `music:song:${id}`;

async function getPlaylist(): Promise<Track[]> {
  const id = playlistId();
  if (!id) throw new MusicApiError('未配置 MUSIC_PLAYLIST_ID', 503);

  const cached = await store().get(PLAYLIST_KEY);
  if (cached) {
    try {
      return JSON.parse(cached) as Track[];
    } catch {
      // 缓存内容坏了就当没有，往下重新拉
    }
  }

  const tracks = await fetchPlaylist(id);
  if (tracks.length) await store().set(PLAYLIST_KEY, JSON.stringify(tracks), PLAYLIST_TTL);
  return tracks;
}

async function getSongUrl(id: string): Promise<string | null> {
  const cached = await store().get(songKey(id));
  if (cached) return cached;

  const src = await fetchSongUrl(id);
  if (src) await store().set(songKey(id), src, SONG_TTL);
  return src;
}

export const GET: APIRoute = async ({ url }) => {
  const action = url.searchParams.get('action');

  try {
    if (action === 'playlist') {
      const tracks = await getPlaylist();
      return json({ ok: true, tracks }, 200, 'public, max-age=300, s-maxage=3600');
    }

    if (action === 'url') {
      const id = url.searchParams.get('id');
      if (!id) return json({ ok: false, message: '缺少 id' }, 400);

      // 只放行歌单里的曲目，否则这个接口就成了别人白嫖的免费解析代理
      const tracks = await getPlaylist();
      if (!tracks.some((t) => t.id === id)) {
        return json({ ok: false, message: '曲目不在歌单内' }, 403);
      }

      const src = await getSongUrl(id);
      if (!src) return json({ ok: false, message: '该曲目暂无可播放地址' }, 404);

      // 上游地址带时效，只让浏览器短暂复用，CDN 不缓存
      return json({ ok: true, url: src }, 200, 'private, max-age=60');
    }

    if (action === 'quota') {
      return json({ ok: true, ...(await usage()) }, 200, 'no-store');
    }

    return json({ ok: false, message: '未知 action' }, 400);
  } catch (err) {
    if (err instanceof MusicApiError) {
      return json({ ok: false, message: err.message }, err.status);
    }
    return json({ ok: false, message: '音乐服务异常' }, 500);
  }
};
