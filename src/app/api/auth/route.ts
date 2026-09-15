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
import { createRateLimiter } from '@/lib/rate-limit';
import { clientIp } from '@/lib/request-ip';

export const maxDuration = 60;

/** 登录有效期内的简易限流：每 IP 每分钟最多 10 次尝试 */
const isRateLimited = createRateLimiter({ windowMs: 60_000, max: 10 });

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/** 校验暗号并按命中的会话种下 Cookie；返回是否通过 */
async function grantSession(password: unknown): Promise<boolean> {
  // 博客暗号和对话暗号可能被有意配置成同一个值，两个都命中时各发各的会话
  const grantedBlog = verifyPassword(password);
  const grantedChat = chatPasswordConfigured() && verifyChatPassword(password);
  if (!grantedBlog && !grantedChat) return false;

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
  return true;
}

/**
 * 无 JS 回退：登录表单以 method=post 原生提交（表单编码），
 * 这里校验后 303 跳转，保证密码只出现在请求体里。
 */
async function handleFormSubmit(request: Request): Promise<Response> {
  const form = await request.formData().catch(() => null);
  const requested = form?.get('next');
  const safeNext = typeof requested === 'string'
    && (requested.startsWith('/blog') || ['/gallery/manage', '/visitors', '/chat'].includes(requested))
    ? requested
    : '/blog';

  if (!(await grantSession(form?.get('password')))) {
    return Response.redirect(new URL(`/login?next=${encodeURIComponent(safeNext)}`, request.url), 303);
  }
  return Response.redirect(new URL(safeNext, request.url), 303);
}

/** POST /api/auth —— 校验密码，通过后按命中的暗号种下对应的签名会话 Cookie */
export async function POST(request: Request) {
  if (isRateLimited(clientIp(request))) {
    return json({ ok: false, message: '尝试过于频繁，请稍后再试' }, 429);
  }

  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
    return handleFormSubmit(request);
  }

  let body: { password?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, message: '请求格式错误' }, 400);
  }

  if (!(await grantSession(body.password))) {
    return json({ ok: false, message: '暗号不对哦，再想想？' }, 401);
  }
  return json({ ok: true });
}

/** DELETE /api/auth —— 退出登录 */
export async function DELETE() {
  const jar = await cookies();
  jar.delete({ name: AUTH_COOKIE, path: '/' });
  jar.delete({ name: CHAT_COOKIE, path: '/' });
  return json({ ok: true });
}