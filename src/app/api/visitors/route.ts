import { cookies } from 'next/headers';
import { verifyPassword } from '@/lib/auth';
import { clientIp } from '@/lib/request-ip';
import { checkSharedRateLimit } from '@/lib/shared-rate-limit';
import {
  createVisitorId,
  isTrackablePath,
  isValidVisitorId,
  recordVisit,
  resetVisitorRecords,
  visitorStats,
  VISITOR_COOKIE,
  VISITOR_COOKIE_MAX_AGE,
} from '@/lib/visitors';

export const maxDuration = 30;

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  },
});

/** GET /api/visitors —— 读取公开的“来访雪笺”统计和脱敏记录。 */
export async function GET() {
  try {
    return json({ ok: true, ...(await visitorStats()) });
  } catch (error) {
    console.error('[visitors] 读取记录失败：', error);
    return json({ ok: false, message: '来访雪笺暂时无法打开' }, 500);
  }
}

/** POST /api/visitors —— 浏览器记录一次公开页面来访。 */
export async function POST(request: Request) {
  const ip = clientIp(request);
  const burst = await checkSharedRateLimit({
    scope: 'visitors-write',
    identifier: ip,
    windowSeconds: 60,
    max: 20,
  });
  if (burst.limited) {
    return json({ ok: false, message: '操作过于频繁，请稍后再试' }, 429);
  }

  let body: { path?: unknown };
  try {
    body = await request.json() as { path?: unknown };
  } catch {
    return json({ ok: false, message: '请求格式错误' }, 400);
  }

  const path = typeof body.path === 'string' ? body.path.slice(0, 200) : '';
  if (!isTrackablePath(path)) return json({ ok: false, message: '不支持记录此路径' }, 400);

  const jar = await cookies();
  let visitorId = jar.get(VISITOR_COOKIE)?.value;
  if (!isValidVisitorId(visitorId)) {
    visitorId = createVisitorId();
    jar.set(VISITOR_COOKIE, visitorId, {
      path: '/',
      maxAge: VISITOR_COOKIE_MAX_AGE,
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });
  }

  try {
    const recorded = await recordVisit({ visitorId, path, ip });
    return json({ ok: true, recorded });
  } catch (error) {
    console.error('[visitors] 写入记录失败：', error);
    return json({ ok: false, message: '来访雪笺暂时无法写入' }, 500);
  }
}

/**
 * DELETE /api/visitors —— 校验密码后清空最近足迹。
 * 只删记录列表，累计访客与累计来访次数保留。
 */
export async function DELETE(request: Request) {
  const rate = await checkSharedRateLimit({
    scope: 'visitors-reset',
    identifier: clientIp(request),
    windowSeconds: 60,
    max: 5,
    strictWhenRedisConfigured: true,
  });
  if (rate.limited) {
    return rate.degraded
      ? json({ ok: false, message: '验证服务暂时不可用，请稍后再试' }, 503)
      : json({ ok: false, message: '尝试过于频繁，请稍后再试' }, 429);
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
}
