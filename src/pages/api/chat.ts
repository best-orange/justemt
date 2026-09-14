import type { APIRoute } from 'astro';
import {
  AUTH_COOKIE,
  CHAT_COOKIE,
  ChatApiError,
  chatUsage,
  consumeQuota,
  hasUnlimitedAccess,
  isConfigured,
  refundQuota,
  sanitizeMessages,
  streamChat,
} from '../../lib/chat';

export const prerender = false;

/**
 * POST /api/chat  —— 流式对话，逐段下发文本增量
 * GET  /api/chat  —— 今日剩余次数（不消耗额度）
 *
 * 存在的意义和 /api/music 一样：把 AI_API_KEY 挡在服务端。
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
export const GET: APIRoute = async ({ cookies }) => {
  const unlimited = hasUnlimitedAccess(cookies.get(CHAT_COOKIE)?.value, cookies.get(AUTH_COOKIE)?.value);
  try {
    return json({ ok: true, configured: isConfigured(), unlimited, ...(await chatUsage()) });
  } catch (error) {
    console.error('[chat] 读取用量失败：', error);
    return json({ ok: false, message: '暂时读不到今日用量' }, 500);
  }
};

export const POST: APIRoute = async ({ request, cookies }) => {
  if (!isConfigured()) {
    return json({ ok: false, message: '对话功能尚未开启' }, 503);
  }

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

  const unlimited = hasUnlimitedAccess(cookies.get(CHAT_COOKIE)?.value, cookies.get(AUTH_COOKIE)?.value);
  // 配额必须在请求上游之前占掉，否则并发下会超发
  if (!unlimited && !(await consumeQuota())) {
    const { limit } = await chatUsage();
    return json({
      ok: false,
      message: `今天的对话次数用完了（每日 ${limit} 次），明天再来，或者登录后继续聊。`,
    }, 429);
  }

  /** 上游一个字都没产出时把额度还回去；cancel() 和下面的 finally 都会触发，只退一次 */
  let produced = false;
  let settled = false;
  const settle = async () => {
    if (settled) return;
    settled = true;
    if (!unlimited && !produced) await refundQuota();
  };

  const encoder = new TextEncoder();
  /** 用 SSE 的行分隔协议包一层，避免文本增量里的换行和边界被混在一起 */
  const event = (type: string, data: unknown) =>
    encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);

  /** 客户端断开后运行时会关掉流，再 enqueue/close 会抛 TypeError，之后一律静默放弃 */
  let clientGone = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (type: string, data: unknown) => {
        if (!clientGone) controller.enqueue(event(type, data));
      };

      try {
        // 浏览器关掉页面时连带取消上游请求，否则 token 照扣、函数照计时
        for await (const delta of streamChat(messages, request.signal)) {
          produced = true;
          send('delta', delta);
        }
        send('done', { ok: true });
      } catch (error) {
        const message = error instanceof ChatApiError
          ? error.message
          : 'AI 服务暂时不可用';
        // 客户端主动断开引发的 AbortError 是预期内的，不算故障
        if (!(error instanceof ChatApiError) && !request.signal.aborted) {
          console.error('[chat] 流式调用失败：', error);
        }
        // 响应头已经发出去了，错误只能作为流内事件传达
        send('error', { message });
      } finally {
        await settle();
        if (!clientGone) controller.close();
      }
    },
    async cancel() {
      clientGone = true;
      await settle();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      // 关掉 Nginx 一类反代的缓冲，否则增量会被攒到最后一次性吐出
      'X-Accel-Buffering': 'no',
    },
  });
};
