import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from './env';

export const AUTH_COOKIE = 'emt_auth';
/** 对话登录的独立会话 Cookie；CHAT_PASSWORD 未配置时对话沿用 AUTH_COOKIE */
export const CHAT_COOKIE = 'emt_chat';

/** 会话有效期：7 天 */
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

/** 会话用途：令牌按用途签名，彼此不通用 */
type Purpose = 'blog' | 'chat';

const secret = (): string => {
  const value = env('AUTH_SECRET');
  if (value) return value;
  // 生产环境缺失时必须显式失败：兜底值会随源码公开，等于没有密钥
  if (process.env.NODE_ENV === 'production') {
    throw new Error('AUTH_SECRET 未配置：生产环境禁止使用内置兜底密钥，请在部署平台设置该环境变量');
  }
  return 'just-emt-dev-secret';
};

/** 生成签名会话令牌（含签发时间戳，单位：秒） */
export function createToken(purpose: Purpose = 'blog', now = Math.floor(Date.now() / 1000)): string {
  const sig = createHmac('sha256', secret()).update(`emt-auth:${purpose}:${now}`).digest('hex');
  return `${now}.${sig}`;
}

/** 校验令牌：签名正确且未过期 */
export function verifyToken(token: string | undefined, purpose: Purpose = 'blog'): boolean {
  if (!token) return false;
  const dot = token.indexOf('.');
  if (dot <= 0) return false;
  const ts = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const issued = Number(ts);
  if (!Number.isInteger(issued)) return false;
  if (Math.floor(Date.now() / 1000) - issued > SESSION_MAX_AGE) return false;
  const expected = createHmac('sha256', secret()).update(`emt-auth:${purpose}:${ts}`).digest('hex');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** 校验访问密码（常量时间比较） */
export function verifyPassword(input: unknown): boolean {
  const password = env('BLOG_PASSWORD');
  if (typeof input !== 'string' || !password) return false;
  const a = Buffer.from(input);
  const b = Buffer.from(password);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** 是否单独配置了 CHAT_PASSWORD —— 决定对话认独立会话还是沿用博客会话 */
const chatPassword = (): string | undefined => env('CHAT_PASSWORD')?.trim() || undefined;

export const chatPasswordConfigured = (): boolean => Boolean(chatPassword());

/** 校验对话暗号（常量时间比较）；只认 CHAT_PASSWORD，不回落博客暗号 */
export function verifyChatPassword(input: unknown): boolean {
  const password = chatPassword();
  if (typeof input !== 'string' || !password) return false;
  const a = Buffer.from(input);
  const b = Buffer.from(password);
  return a.length === b.length && timingSafeEqual(a, b);
}