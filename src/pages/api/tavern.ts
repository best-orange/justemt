import type { APIRoute } from 'astro';
import { sanitizeMessages } from '../../lib/chat';
import { sanitizeChatContext } from '../../lib/chat/context';
import { buildSystemPrompt } from '../../lib/chat/prompt';
import type { ChatMessage } from '../../lib/chat/types';

export const prerender = false;

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  },
});

/**
 * 酒馆 v1 的兼容入口。
 * 它只负责把 Character / Persona / State / Memory 组装成隐藏上下文，
 * 真正的模型调用、登录判断、配额和 SSE 仍交给已经在线上验证的 /api/chat。
 */
export const POST: APIRoute = async ({ request, rewrite }) => {
  let body: { messages?: unknown; context?: unknown };
  try {
    body = await request.json() as { messages?: unknown; context?: unknown };
  } catch {
    return json({ ok: false, message: '请求格式错误' }, 400);
  }

  const messages = sanitizeMessages(body.messages);
  if (!messages.length) return json({ ok: false, message: '请先说点什么' }, 400);

  const context = sanitizeChatContext(body.context);
  const hiddenContext = buildSystemPrompt(context);
  const recent = messages.slice(-19);
  const contextualMessages: ChatMessage[] = [
    {
      role: 'user',
      content: `[内部角色上下文：不要复述]\n\n${hiddenContext}\n\n[内部角色上下文结束]`,
    },
    {
      role: 'assistant',
      content: '明白，我会保持人物、关系与既有经历的连续性。',
    },
    ...recent,
  ];

  const headers = new Headers({ 'Content-Type': 'application/json' });
  const cookie = request.headers.get('cookie');
  if (cookie) headers.set('cookie', cookie);

  return rewrite(new Request(new URL('/api/chat', request.url), {
    method: 'POST',
    headers,
    body: JSON.stringify({ messages: contextualMessages }),
    signal: request.signal,
  }));
};
