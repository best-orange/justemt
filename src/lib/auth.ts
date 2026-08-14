import { createHmac, timingSafeEqual } from 'node:crypto';

export const AUTH_COOKIE = 'emt_auth';
/** 会话有效期：7 天 */
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

const secret = (): string => {
  const value = import.meta.env.AUTH_SECRET as string | undefined;
  if (value) return value;
  // 生产环境缺失时必须显式失败：兜底值会随源码公开，等于没有密钥
  if (import.meta.env.PROD) {
    throw new Error('AUTH_SECRET 未配置：生产环境禁止使用内置兜底密钥，请在部署平台设置该环境变量');
  }
  return 'just-emt-dev-secret';
};

/** 生成签名会话令牌（含签发时间戳，单位：秒） */
export function createToken(now = Math.floor(Date.now() / 1000)): string {
  const sig = createHmac('sha256', secret()).update(`emt-auth:${now}`).digest('hex');
  return `${now}.${sig}`;
}

/** 校验令牌：签名正确且未过期 */
export function verifyToken(token: string | undefined): boolean {
  if (!token) return false;
  const dot = token.indexOf('.');
  if (dot <= 0) return false;
  const ts = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const issued = Number(ts);
  if (!Number.isInteger(issued)) return false;
  if (Math.floor(Date.now() / 1000) - issued > SESSION_MAX_AGE) return false;
  const expected = createHmac('sha256', secret()).update(`emt-auth:${ts}`).digest('hex');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** 校验访问密码（常量时间比较） */
export function verifyPassword(input: unknown): boolean {
  const password = import.meta.env.BLOG_PASSWORD;
  if (typeof input !== 'string' || !password) return false;
  const a = Buffer.from(input);
  const b = Buffer.from(password);
  return a.length === b.length && timingSafeEqual(a, b);
}
