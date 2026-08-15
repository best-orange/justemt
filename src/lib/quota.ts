/**
 * 上游音乐 API 的每日调用配额。
 *
 * 计数落在共享存储上（见 store.ts）：
 * - 配了 Upstash → Redis 的 INCR 是原子的，多实例并发也精确
 * - 没配 → 回落到进程内存，每实例各计各的，只是软上限
 */

import { store, storeStatus } from './store';

/** 每日上限，可用 MUSIC_DAILY_LIMIT 覆盖 */
export const DAILY_LIMIT = Number(import.meta.env.MUSIC_DAILY_LIMIT ?? 390);

/** 计数键留够两天再过期，日切靠键名本身完成 */
const KEY_TTL = 48 * 60 * 60;

/**
 * 以 UTC+8 计日 —— 上游是国内服务，配额大概率按北京时间重置。
 * 若实测发现重置时间不同，改这里的偏移即可。
 */
export function today(): string {
  const shifted = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

const dayKey = () => `music:quota:${today()}`;

/**
 * 占用一次配额。返回 false 表示已达上限，调用方应放弃请求上游。
 * 必须在真正发出上游请求之前调用。
 *
 * 先增后判，而不是先查后增 —— 后者在并发下会双双通过，超发配额。
 */
export async function tryConsume(): Promise<boolean> {
  const key = dayKey();
  const n = await store().incr(key, KEY_TTL);
  if (n > DAILY_LIMIT) {
    // 退回去，保证 usage() 报出来的数不会一直往上飘
    await store().decr(key);
    return false;
  }
  return true;
}

/** 上游请求没真正消耗额度时退还，避免网络抖动白白吃掉配额 */
export async function refund(): Promise<void> {
  await store().decr(dayKey());
}

export async function usage(): Promise<{
  used: number;
  limit: number;
  remaining: number;
  day: string;
  store: { configured: 'redis' | 'memory'; effective: 'redis' | 'memory' };
}> {
  const raw = await store().get(dayKey());
  const used = Math.max(0, Number(raw ?? 0));
  return {
    used,
    limit: DAILY_LIMIT,
    remaining: Math.max(0, DAILY_LIMIT - used),
    day: today(),
    store: storeStatus(),
  };
}
