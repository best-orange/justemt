import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import TavernPage from '@/components/tavern-page';
import { AUTH_COOKIE, CHAT_COOKIE, dailyLimit, hasUnlimitedAccess, isConfigured } from '@/lib/chat';

export const metadata: Metadata = {
  title: 'Emilia · Tavern v1 · justEMT',
  description: '带角色状态与长期记忆接口的 Emilia 对话实验页。',
};

export default async function TavernRoute() {
  const jar = await cookies();
  const configured = isConfigured();
  const unlimited = hasUnlimitedAccess(jar.get(CHAT_COOKIE)?.value, jar.get(AUTH_COOKIE)?.value);
  const limit = dailyLimit();

  return <TavernPage configured={configured} unlimited={unlimited} limit={limit} />;
}