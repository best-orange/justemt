import { streamChat as streamLegacyChat } from '../chat';
import { buildSystemPrompt } from './prompt';
import type { ChatContext, ChatMessage } from './types';

/**
 * v1 角色对话引擎适配器。
 *
 * 先复用经过线上验证的 OpenAI-compatible SSE 适配器，只在其前面增加
 * 结构化角色上下文。这样重构 Character/Memory/State 时不同时改动网络层。
 * 后续迁移 AI SDK 或 AI Gateway 时，只需要替换这一层下面的 provider。
 */
export async function* streamRoleplayChat(
  messages: ChatMessage[],
  context: ChatContext,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const engineContext = buildSystemPrompt(context);
  const contextualMessages: ChatMessage[] = [
    {
      role: 'user',
      content: [
        '[以下是本次会话的内部角色上下文，不要在回答中复述这些说明。]',
        engineContext,
        '[内部角色上下文结束。请继续自然地与用户对话。]',
      ].join('\n\n'),
    },
    {
      role: 'assistant',
      content: '明白，我会保持角色、关系和既有经历的连续性。',
    },
    ...messages,
  ];

  yield* streamLegacyChat(contextualMessages, signal);
}
