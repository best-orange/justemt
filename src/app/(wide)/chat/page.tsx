import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import ChatPage from '@/components/chat-page';
import { AUTH_COOKIE, CHAT_COOKIE, dailyLimit, hasUnlimitedAccess, isConfigured } from '@/lib/chat';

export const metadata: Metadata = {
  title: '与 Emilia 对话 · justEMT',
  description: '和栖息在冰上美术馆里的银发半精灵聊聊天。',
};

export default async function ChatRoute() {
  const jar = await cookies();
  const configured = isConfigured();
  const unlimited = hasUnlimitedAccess(jar.get(CHAT_COOKIE)?.value, jar.get(AUTH_COOKIE)?.value);
  const limit = dailyLimit();

  return <ChatPage configured={configured} unlimited={unlimited} limit={limit} />;
}