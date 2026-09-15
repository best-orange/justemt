import { cookies } from 'next/headers';
import {
  AUTH_COOKIE,
  CHAT_COOKIE,
  chatUsage,
  hasUnlimitedAccess,
  isConfigured,
  sanitizeMessages,
  systemPrompt,
} from '@/lib/chat';
import { streamChatResponse } from '@/lib/chat/ai';

// 流式对话最长 55 秒（见 src/lib/chat.ts 的 TIMEOUT_MS），
// 函数平台上限必须大于它，否则先于我们掐断请求。
export const maxDuration = 60;

/**
 * POST /api/chat  —— 流式对话（Vercel AI SDK 的 UI Message Stream）
 * GET  /api/chat  —— 今日剩余次数（不消耗额度）
 *
 * 存在的意义是调用 AI 密钥挡在服务端。
 *
 * 次数限制是「全站每天合计 N 次」，不是每人 N 次 —— 页面公开，
 * 匿名访客无法可靠区分，只能靠总量止损。登录会话不计次也不受限。
 */

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });

/** GET —— 供页面展示「今日还能聊几次」 */
export async function GET() {
  const jar = await cookies();
  const unlimited = hasUnlimitedAccess(jar.get(CHAT_COOKIE)?.value, jar.get(AUTH_COOKIE)?.value);
  try {
    return json({ ok: true, configured: isConfigured(), unlimited, ...(await chatUsage()) });
  } catch (error) {
    console.error('[chat] 读取用量失败：', error);
    return json({ ok: false, message: '暂时读不到今日用量' }, 500);
  }
}

export async function POST(request: Request) {
  const jar = await cookies();
  const unlimited = hasUnlimitedAccess(jar.get(CHAT_COOKIE)?.value, jar.get(AUTH_COOKIE)?.value);

  let body: { messages?: unknown };
  try {
    body = await request.json() as { messages?: unknown };
  } catch {
    return json({ ok: false, message: '请求格式错误' }, 400);
  }

  const messages = sanitizeMessages(body.messages);
  if (!messages.length) {
    return json({ ok: false, message: '请先说点什么' }, 400);
  }

  return streamChatResponse({ messages, system: systemPrompt(), request, unlimited });
}