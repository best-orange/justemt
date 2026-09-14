import type { APIRoute } from 'astro';
import { sanitizeMessages } from '../../lib/chat';
import { sanitizeChatContext } from '../../lib/chat/context';
import { buildContextualMessages } from '../../lib/chat/engine';

export const prerender = false;

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  },
});

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
  const contextualMessages = buildContextualMessages(messages, context);
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
