import type { APIRoute } from 'astro';
import { AUTH_COOKIE, SESSION_MAX_AGE, createToken, verifyPassword } from '../../lib/auth';

export const prerender = false;

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

/** POST /api/auth —— 校验密码，通过后种下签名会话 Cookie */
export const POST: APIRoute = async ({ request, cookies, clientAddress }) => {
  if (isRateLimited(clientAddress)) {
    return json({ ok: false, message: '尝试过于频繁，请稍后再试' }, 429);
  }

  let body: { password?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, message: '请求格式错误' }, 400);
  }

  if (!verifyPassword(body.password)) {
    return json({ ok: false, message: '暗号不对哦，再想想？' }, 401);
  }

  cookies.set(AUTH_COOKIE, createToken(), {
    path: '/',
    maxAge: SESSION_MAX_AGE,
    httpOnly: true,
    sameSite: 'lax',
    secure: import.meta.env.PROD,
  });

  return json({ ok: true });
};

/** DELETE /api/auth —— 退出登录 */
export const DELETE: APIRoute = async ({ cookies }) => {
  cookies.delete(AUTH_COOKIE, { path: '/' });
  return json({ ok: true });
};
