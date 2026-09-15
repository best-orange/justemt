/** 正文页面（博客 / 画廊 / 来访等）：窄版内容玻璃面板 */
export default function ContentLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="site-main mx-auto max-w-3xl px-4 pb-12 pt-24">
      <div className="site-content-surface">{children}</div>
    </main>
  );
}