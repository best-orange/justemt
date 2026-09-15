import { cookies } from 'next/headers';
import {
  AUTH_COOKIE,
  CHAT_COOKIE,
  SESSION_MAX_AGE,
  chatPasswordConfigured,
  createToken,
  verifyChatPassword,
  verifyPassword,
} from '@/lib/auth';
import { clientIp } from '@/lib/request-ip';

export const maxDuration = 60;

/** 登录有效期内的简易限流：每 IP 每分钟最多 10 次尝试 */
const attempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 10;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || now > entry.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_ATTEMPTS;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/** POST /api/auth —— 校验密码，通过后按命中的暗号种下对应的签名会话 Cookie */
export async function POST(request: Request) {
  if (isRateLimited(clientIp(request))) {
    return json({ ok: false, message: '尝试过于频繁，请稍后再试' }, 429);
  }

  let body: { password?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, message: '请求格式错误' }, 400);
  }

  // 博客暗号和对话暗号可能被有意配置成同一个值，两个都命中时各发各的会话
  const grantedBlog = verifyPassword(body.password);
  const grantedChat = chatPasswordConfigured() && verifyChatPassword(body.password);
  if (!grantedBlog && !grantedChat) {
    return json({ ok: false, message: '暗号不对哦，再想想？' }, 401);
  }

  const sessionCookie = {
    path: '/',
    maxAge: SESSION_MAX_AGE,
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
  };

  const jar = await cookies();
  if (grantedBlog) jar.set(AUTH_COOKIE, createToken('blog'), sessionCookie);
  if (grantedChat) jar.set(CHAT_COOKIE, createToken('chat'), sessionCookie);

  return json({ ok: true });
}

/** DELETE /api/auth —— 退出登录 */
export async function DELETE() {
  const jar = await cookies();
  jar.delete({ name: AUTH_COOKIE, path: '/' });
  jar.delete({ name: CHAT_COOKIE, path: '/' });
  return json({ ok: true });
}