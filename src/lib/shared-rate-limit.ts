import { createHash } from 'node:crypto';
import { store, storeStatus } from './store';

export interface SharedRateLimitOptions {
  scope: string;
  identifier: string;
  windowSeconds: number;
  max: number;
  /**
   * 当生产环境已配置 Redis、但本次调用已经降级到内存时是否直接拒绝。
   * 鉴权防爆破应开启；普通资源保护可继续使用内存软降级。
   */
  strictWhenRedisConfigured?: boolean;
}

export interface SharedRateLimitResult {
  limited: boolean;
  remaining: number;
  retryAfterSeconds: number;
  degraded: boolean;
}

function hashIdentifier(value: string): string {
  return createHash('sha256').update(value || 'unknown').digest('hex').slice(0, 24);
}

/**
 * 基于共享 Store 的固定窗口限流。
 *
 * - 配置 Upstash 时，INCR + TTL 在所有 Vercel 实例之间共享。
 * - 未配置 Upstash 时自动使用进程内存，适合本地开发，但只是软限流。
 * - strictWhenRedisConfigured 用于登录等安全边界：Redis 已配置却故障时宁可拒绝，
 *   也不要悄悄把分布式防爆破降级成单实例限制。
 */
export async function checkSharedRateLimit(options: SharedRateLimitOptions): Promise<SharedRateLimitResult> {
  const windowSeconds = Math.max(1, Math.floor(options.windowSeconds));
  const max = Math.max(1, Math.floor(options.max));
  const nowSeconds = Math.floor(Date.now() / 1000);
  const bucket = Math.floor(nowSeconds / windowSeconds);
  const resetAt = (bucket + 1) * windowSeconds;
  const key = `rate:${options.scope}:${bucket}:${hashIdentifier(options.identifier)}`;

  const count = await store().incr(key, windowSeconds + 5);
  const status = storeStatus();
  const degraded = status.configured === 'redis' && status.effective !== 'redis';
  const strictFailure = Boolean(options.strictWhenRedisConfigured && degraded);

  return {
    limited: strictFailure || count > max,
    remaining: strictFailure ? 0 : Math.max(0, max - count),
    retryAfterSeconds: Math.max(1, resetAt - nowSeconds),
    degraded,
  };
}
