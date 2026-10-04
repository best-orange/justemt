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
      className="glass-btn shrink-0 !px-3.5 !py-1.5 text-xs font-medium"
    >
      重新上锁
    </button>
  );
}