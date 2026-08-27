import type { APIRoute } from 'astro';
import { verifyPassword } from '../../lib/auth';
import {
  createVisitorId,
  isTrackablePath,
  isValidVisitorId,
  recordVisit,
  resetVisitorRecords,
  visitorStats,
  VISITOR_COOKIE,
  VISITOR_COOKIE_MAX_AGE,
} from '../../lib/visitors';

export const prerender = false;

/** 重置接口的简易限流：每 IP 每分钟最多 5 次尝试，防止在线爆破 */
const resetAttempts = new Map<string, { count: number; resetAt: number }>();
const RESET_WINDOW_MS = 60_000;
const RESET_MAX_ATTEMPTS = 5;

function isResetRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = resetAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    resetAttempts.set(ip, { count: 1, resetAt: now + RESET_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > RESET_MAX_ATTEMPTS;
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  },
});

/** GET /api/visitors —— 读取公开的“来访雪笺”统计和脱敏记录。 */
export const GET: APIRoute = async () => {
  try {
    return json({ ok: true, ...(await visitorStats()) });
  } catch (error) {
    console.error('[visitors] 读取记录失败：', error);
    return json({ ok: false, message: '来访雪笺暂时无法打开' }, 500);
  }
};

/** POST /api/visitors —— 浏览器记录一次公开页面来访。 */
export const POST: APIRoute = async ({ request, cookies, clientAddress }) => {
  let body: { path?: unknown };
  try {
    body = await request.json() as { path?: unknown };
  } catch {
    return json({ ok: false, message: '请求格式错误' }, 400);
  }

  const path = typeof body.path === 'string' ? body.path.slice(0, 200) : '';
  if (!isTrackablePath(path)) return json({ ok: false, message: '不支持记录此路径' }, 400);

  let visitorId = cookies.get(VISITOR_COOKIE)?.value;
  if (!isValidVisitorId(visitorId)) {
    visitorId = createVisitorId();
    cookies.set(VISITOR_COOKIE, visitorId, {
      path: '/',
      maxAge: VISITOR_COOKIE_MAX_AGE,
      httpOnly: true,
      sameSite: 'lax',
      secure: import.meta.env.PROD,
    });
  }

  try {
    const recorded = await recordVisit({ visitorId, path, ip: clientAddress });
    return json({ ok: true, recorded });
  } catch (error) {
    console.error('[visitors] 写入记录失败：', error);
    return json({ ok: false, message: '来访雪笺暂时无法写入' }, 500);
  }
};

/**
 * DELETE /api/visitors —— 校验密码后清空最近足迹。
 * 只删记录列表，累计访客与累计来访次数保留。
 */
export const DELETE: APIRoute = async ({ request, clientAddress }) => {
  if (isResetRateLimited(clientAddress)) {
    return json({ ok: false, message: '尝试过于频繁，请稍后再试' }, 429);
  }

  let body: { password?: unknown };
  try {
    body = await request.json() as { password?: unknown };
  } catch {
    return json({ ok: false, message: '请求格式错误' }, 400);
  }

  if (!verifyPassword(body.password)) {
    return json({ ok: false, message: '暗号不对哦，再想想？' }, 401);
  }

  try {
    await resetVisitorRecords();
    return json({ ok: true });
  } catch (error) {
    console.error('[visitors] 清空记录失败：', error);
    return json({ ok: false, message: '来访雪笺暂时无法清空' }, 500);
  }
};
