/**
 * 进程内固定窗口限流。
 *
 * Serverless 上每个实例各算各的，只是防爆破的软上限；
 * 键来自 clientIp()，自建部署要按 request-ip.ts 的说明配置可信头。
 * 过期条目在窗口切换时原地覆盖，并定期整体清理，避免 Map 随 IP 数无限增长。
 */
export function createRateLimiter(options: { windowMs: number; max: number }): (key: string) => boolean {
  const { windowMs, max } = options;
  const entries = new Map<string, { count: number; resetAt: number }>();

  return function isRateLimited(key: string): boolean {
    const now = Date.now();
    if (entries.size > 1000) {
      for (const [entryKey, entry] of entries) {
        if (now > entry.resetAt) entries.delete(entryKey);
      }
    }
    const entry = entries.get(key);
    if (!entry || now > entry.resetAt) {
      entries.set(key, { count: 1, resetAt: now + windowMs });
      return false;
    }
    entry.count += 1;
    return entry.count > max;
  };
}