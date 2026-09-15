import { env } from './env';

/**
 * 从请求头提取客户端 IP，供限流和访客记录使用。
 * Next.js 的路由处理器没有 Astro 的 clientAddress，只能读转发头。
 *
 * 默认顺序（x-real-ip → x-forwarded-for 首段）假定平台会覆写这些头：
 * Vercel 上客户端自带的值会被平台替换，是可信的。
 * 自建部署若前置了“追加式”反向代理，转发头首段是客户端可伪造的，
 * 此时必须用 TRUSTED_IP_HEADER 指定由代理覆写的那个头（例如 cf-connecting-ip），
 * 否则限流会被轮换 IP 绕过。
 */
export function clientIp(request: Request): string {
  const trusted = env('TRUSTED_IP_HEADER')?.trim().toLowerCase();
  if (trusted) {
    const first = request.headers.get(trusted)?.split(',')[0]?.trim();
    if (first) return first;
  }
  const forwarded = request.headers.get('x-real-ip') ?? request.headers.get('x-forwarded-for') ?? '';
  const first = forwarded.split(',')[0].trim();
  return first || 'unknown';
}