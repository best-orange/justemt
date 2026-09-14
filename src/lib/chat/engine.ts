import { buildSystemPrompt } from './prompt';
import type { ChatContext, ChatMessage } from './types';

export function buildContextualMessages(
  messages: ChatMessage[],
  context: ChatContext,
): ChatMessage[] {
  const engineContext = buildSystemPrompt(context);
  return [
    {
      role: 'user',
      content: `[conversation context]\n\n${engineContext}\n\n[end context]`,
    },
    {
      role: 'assistant',
      content: 'Context loaded. I will keep the conversation consistent.',
    },
    ...messages.slice(-19),
  ];
}
