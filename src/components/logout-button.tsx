'use client';

/** 博客页的“重新上锁”：清掉两种会话 Cookie 后回首页 */
export default function LogoutButton() {
  const onLogout = async () => {
    await fetch('/api/auth', { method: 'DELETE' });
    location.href = '/';
  };

  return (
    <button
      id="logout-btn"
      type="button"
      onClick={onLogout}
      className="shrink-0 rounded-lg border border-lilac-400/30 px-3 py-1.5 text-sm text-slate-500 transition-colors hover:text-violet-700 dark:text-slate-300 dark:hover:text-lilac-200"
    >
      重新上锁
    </button>
  );
}