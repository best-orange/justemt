import { cookies } from 'next/headers';
import { AUTH_COOKIE, CHAT_COOKIE, hasUnlimitedAccess, sanitizeMessages, systemPrompt } from '@/lib/chat';
import { streamChatResponse } from '@/lib/chat/ai';
import { sanitizeChatContext } from '@/lib/chat/context';
import { buildContextualMessages } from '@/lib/chat/engine';

// 与 /api/chat 一致：流式对话最长 55 秒，留足平台限额
export const maxDuration = 60;

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  },
});

/**
 * POST /api/tavern —— 带角色状态的流式对话。
 * 与 /api/chat 共用每日配额；上下文只进本轮 Prompt，不落服务器存储。
 */
export async function POST(request: Request) {
  let body: { messages?: unknown; context?: unknown };
  try {
    body = await request.json() as { messages?: unknown; context?: unknown };
  } catch {
    return json({ ok: false, message: '请求格式错误' }, 400);
  }

  const messages = sanitizeMessages(body.messages);
  if (!messages.length) return json({ ok: false, message: '请先说点什么' }, 400);

  const context = sanitizeChatContext(body.context);
  const contextualMessages = buildContextualMessages(messages, context);

  const jar = await cookies();
  const unlimited = hasUnlimitedAccess(jar.get(CHAT_COOKIE)?.value, jar.get(AUTH_COOKIE)?.value);

  return streamChatResponse({ messages: contextualMessages, system: systemPrompt(), request, unlimited });
}