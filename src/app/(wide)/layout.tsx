/** 宽版页面（音乐室 / 对话 / 酒馆）：需要同时展示封面与内容的工具页面 */
export default function WideLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="site-main mx-auto max-w-6xl px-4 pb-12 pt-24">
      <div className="site-content-surface">{children}</div>
    </main>
  );
}