/**
 * 从请求头提取客户端 IP，供限流和访客记录使用。
 * Next.js 的路由处理器没有 Astro 的 clientAddress，只能读转发头；
 * 取 x-forwarded-for 的第一段（离用户最近的一跳）。
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? '';
  const first = forwarded.split(',')[0].trim();
  return first || 'unknown';
}