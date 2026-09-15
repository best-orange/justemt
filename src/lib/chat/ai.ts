/**
 * 对话流式入口：Vercel AI SDK 的 OpenAI 兼容 Provider + 每日配额保护。
 *
 * /api/chat 与 /api/tavern 共用同一套语义：
 * - 配额在请求上游之前占掉，并发下不会超发
 * - 上游一个字都没产出时退还，网络抖动不会白白吃掉额度
 *
 * 响应采用 AI SDK 的 UI Message Stream 协议，前端用 useChat 消费。
 */

import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createUIMessageStreamResponse, streamText, toUIMessageStream } from 'ai';
import {
  apiKeyOrThrow,
  baseUrl,
  chatUsage,
  consumeQuota,
  friendlyAiError,
  isConfigured,
  model,
  refundQuota,
  TIMEOUT_MS,
  type ChatMessage,
} from '../chat';

const chatbotModel = () =>
  createOpenAICompatible({
    name: 'justemt-upstream',
    baseURL: baseUrl(),
    apiKey: apiKeyOrThrow(),
  })(model());

/**
 * 按共享配额语义流式回答。
 * 失败路径返回纯文本响应体（useChat 会把它原样放进 error.message），
 * 内容都是可以直接展示给访客的中文短句。
 */
export async function streamChatResponse(input: {
  messages: ChatMessage[];
  system: string;
  request: Request;
  unlimited: boolean;
}): Promise<Response> {
  const { messages, system, request, unlimited } = input;

  if (!isConfigured()) {
    return plainText('对话功能尚未开启', 503);
  }

  if (!unlimited && !(await consumeQuota())) {
    const { limit } = await chatUsage();
    return plainText(`今天的对话次数用完了（每日 ${limit} 次），明天再来，或者登录后继续聊。`, 429);
  }

  /** 上游一个字都没产出时把额度还回去；所有出口共用，只退一次 */
  let produced = false;
  let settled = false;
  const settle = async () => {
    if (settled) return;
    settled = true;
    if (!unlimited && !produced) await refundQuota();
  };

  try {
    const result = streamText({
      model: chatbotModel(),
      system,
      messages,
      abortSignal: request.signal,
      timeout: TIMEOUT_MS,
      onChunk: (event) => {
        if (event.chunk.type === 'text-delta') produced = true;
      },
    });

    const uiStream = toUIMessageStream({
      stream: result.stream,
      onError: (error) => {
        // 流内错误会成为一条 error part；onEnd 在中断时也触发，双保险只退一次
        void settle();
        return friendlyAiError(error);
      },
      onEnd: () => void settle(),
    });

    return createUIMessageStreamResponse({ stream: uiStream });
  } catch (error) {
    await settle();
    console.error('[chat] 流式调用失败：', error);
    return plainText(friendlyAiError(error), 500);
  }
}

function plainText(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}