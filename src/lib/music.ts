/**
 * ChKSz 音乐 API 的服务端客户端。
 * 文档：https://api.chksz.com/
 *
 * apikey 只在服务端使用，绝不下发到浏览器 —— 它绑定账号的每日免费额度，
 * 一旦出现在前端源码里，任何人都能扒走刷爆配额。
 */

import { DAILY_LIMIT, refund, tryConsume } from './quota';

const API_BASE = 'https://api.chksz.com/api';
/** 请求超时，避免上游卡死拖垮 Vercel 函数 */
const TIMEOUT_MS = 10_000;

const apiKey = () => import.meta.env.MUSIC_API_KEY as string | undefined;

/** 网易云歌单 ID；播放器的曲目来源 */
export const playlistId = () => import.meta.env.MUSIC_PLAYLIST_ID as string | undefined;

/**
 * 音质等级。默认 exhigh（320k）而不是文档里的 jymaster：
 * 母带文件动辄上百 MB，移动端流量和加载都吃不消。
 */
const level = () => (import.meta.env.MUSIC_LEVEL as string | undefined) ?? 'exhigh';

export const MUSIC_MOODS = ['雪夜', '圣域', '王选', '安静陪伴'] as const;
export type MusicMood = (typeof MUSIC_MOODS)[number];

export type Track = {
  id: string;
  name: string;
  artist: string;
  cover: string;
  mood: MusicMood;
};

export class MusicApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call(path: string, params: Record<string, string>): Promise<any> {
  const key = apiKey();
  if (!key) {
    throw new MusicApiError('未配置 MUSIC_API_KEY', 503);
  }

  // 配额检查放在发请求之前 —— 这里是所有上游调用的唯一入口
  if (!(await tryConsume())) {
    throw new MusicApiError(`今日音乐接口调用已达上限（${DAILY_LIMIT} 次），明天再来`, 429);
  }

  const url = new URL(`${API_BASE}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('apikey', key);

  let res: Response;
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: 'application/json' },
    });
  } catch {
    // 没连上，上游不会计费，退还配额
    await refund();
    throw new MusicApiError('音乐服务连接失败', 502);
  }

  if (!res.ok) {
    // 5xx 是上游自己出错，多半没真正计费，退还配额，
    // 免得对方抖动一阵就把一天的额度耗光；4xx 是我们的请求有问题，照常计数。
    if (res.status >= 500) await refund();
    throw new MusicApiError(`音乐服务返回 ${res.status}`, 502);
  }

  const body = await res.json().catch(() => null);
  if (!body) {
    throw new MusicApiError('音乐服务返回了无法解析的内容', 502);
  }
  // 上游用 body.code 表达业务错误（401 缺 key、404 找不到歌等），HTTP 状态可能仍是 200
  if (typeof body.code === 'number' && body.code !== 200) {
    throw new MusicApiError(body.msg ?? '音乐服务返回错误', body.code === 401 ? 503 : 502);
  }
  return body.data ?? body;
}

/** 拉取歌单并归一化成播放器需要的最小字段集 */
export async function fetchPlaylist(id: string): Promise<Track[]> {
  const data = await call('163_playlist', { id });
  const tracks: unknown = data?.tracks;
  if (!Array.isArray(tracks)) return [];

  const size = Math.max(1, Math.ceil(tracks.length / MUSIC_MOODS.length));
  return tracks
    .map((t: any, index: number): Track | null => {
      if (t?.id == null) return null;
      return {
        id: String(t.id),
        name: t.name ?? '未知曲目',
        artist: Array.isArray(t.ar) ? t.ar.map((a: any) => a?.name).filter(Boolean).join(' / ') : '',
        cover: t.al?.picUrl ?? '',
        // 上游歌单没有氛围标签，按原歌单顺序分成四组，保证展示稳定且不改变上游来源。
        mood: MUSIC_MOODS[Math.min(MUSIC_MOODS.length - 1, Math.floor(index / size))],
      };
    })
    .filter((t): t is Track => t !== null);
}

/** 取单曲的可播放地址。地址带时效，不要长期缓存 */
export async function fetchSongUrl(id: string): Promise<string | null> {
  const data = await call('163_music', { id, level: level(), type: 'json' });
  return typeof data?.url === 'string' && data.url ? data.url : null;
}
