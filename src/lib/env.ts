/**
 * 运行时环境变量读取。
 *
 * Next.js 会在构建时把源码里 `process.env.X` 的直接引用静态内联成构建期的值，
 * 部署平台后来增改的变量只有经由别名访问（绕开直接引用）才能拿到。
 */
export function env(name: string): string | undefined {
  const runtime = process.env as Record<string, string | undefined>;
  return runtime[name];
}

/**
 * 读取正数数值型环境变量；缺失或非法（空串 / NaN / 0 / 负数）时返回兜底值。
 * 用于配错一个值就会静默失效或全量拦截的场景（限额、TTL 等）。
 */
export function envPositiveNumber(name: string, fallback: number): number {
  const raw = env(name)?.trim();
  const value = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(value) && value > 0 ? value : fallback;
}