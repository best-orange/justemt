import type { APIRoute } from 'astro';
import {
  createVisitorId,
  isTrackablePath,
  isValidVisitorId,
  recordVisit,
  visitorStats,
  VISITOR_COOKIE,
  VISITOR_COOKIE_MAX_AGE,
} from '../../lib/visitors';

export const prerender = false;

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
