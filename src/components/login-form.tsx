'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';

export default function LoginForm({ next }: { next: string }) {
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const form = event.currentTarget;
    const password = new FormData(form).get('password');
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = (await res.json()) as { ok?: boolean; message?: string };
      if (res.ok && data.ok) {
        location.href = next;
      } else {
        setError(data.message ?? '验证失败');
      }
    } catch {
      setError('网络异常，请稍后再试');
    }
  };

  return (
    <form
      id="login-form"
      className="mt-6"
      method="post"
      action="/api/auth"
      onSubmit={onSubmit}
    >
      {/* 无 JS 时随原生提交带回跳转目标；JS 流程用的是 LoginForm 的 next prop */}
      <input type="hidden" name="next" value={next} />
      <input
        type="password"
        name="password"
        required
        autoComplete="current-password"
        placeholder="暗号"
        className="w-full rounded-xl border border-white/20 bg-white/10 px-4 py-2.5 text-center text-white placeholder-white/40 outline-none backdrop-blur transition-colors focus:border-lilac-300"
      />
      <p id="login-error" className={`mt-3 text-sm text-rose-300${error ? '' : ' hidden'}`}>
        {error}
      </p>
      <button
        type="submit"
        className="mt-4 w-full rounded-xl bg-gradient-to-r from-lilac-500 to-ice-400 px-4 py-2.5 font-medium text-white shadow-lg shadow-lilac-500/25 transition-transform hover:scale-[1.02] active:scale-[0.98]"
      >
        解 封
      </button>
    </form>
  );
}