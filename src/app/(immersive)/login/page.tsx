import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import LoginForm from '@/components/login-form';
import Particles from '@/components/particles';
import { AUTH_COOKIE, CHAT_COOKIE, verifyToken } from '@/lib/auth';
import { hasUnlimitedAccess } from '@/lib/chat';

export const metadata: Metadata = {
  title: '风铃之间 · justEMT',
  description: '说出暗号，进入冰封的阅览室。',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const next = params.next ?? '/blog';
  const safeNext = next.startsWith('/blog') || ['/gallery/manage', '/visitors', '/chat'].includes(next) ? next : '/blog';

  // 已登录：直接放行到目标页。对话目标按对话自己的规则判断（配了 CHAT_PASSWORD 时博客会话不算数）
  const jar = await cookies();
  const authenticated = safeNext === '/chat'
    ? hasUnlimitedAccess(jar.get(CHAT_COOKIE)?.value, jar.get(AUTH_COOKIE)?.value)
    : verifyToken(jar.get(AUTH_COOKIE)?.value);
  if (authenticated) {
    redirect(safeNext);
  }

  return (
    <section className="relative z-10 flex min-h-svh items-center justify-center overflow-hidden px-4 pt-16">
      <Particles density={0.7} />
      <div className="absolute inset-0 -z-[6] bg-night-950/60"></div>

      <div className="glass w-full max-w-sm rounded-3xl p-8 text-center">
        <svg className="mx-auto h-10 w-10 text-lilac-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
        </svg>
        <h1 className="mt-4 font-display text-2xl font-bold tracking-wide text-white">
          风铃之间
        </h1>
        <p className="mt-2 text-sm text-white/70">
          前方是冰封的阅览室。<br />说出暗号，微精灵才会为你让路。
        </p>

        <LoginForm next={safeNext} />

        <a href="/" className="mt-5 inline-block text-xs text-white/75 transition-colors hover:text-white">
          ← 返回美术馆大厅
        </a>
      </div>
    </section>
  );
}