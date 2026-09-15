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