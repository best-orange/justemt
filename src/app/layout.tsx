import type { Metadata, Viewport } from 'next';
import Nav from '@/components/nav';
import Footer from '@/components/footer';
import SpiritSparks from '@/components/spirit-sparks';
import MusicPlayer from '@/components/music-player';
import SiteWallpaper from '@/components/site-wallpaper';
import VisitTracker from '@/components/visit-tracker';
import NavigationEvents from '@/components/navigation-events';
import { env } from '@/lib/env';
import './globals.css';

export const metadata: Metadata = {
  title: 'justEMT · 爱蜜莉雅主题站',
  description: 'EMT —— 爱蜜莉雅碳真是天使。一座冰上的美术馆，献给银发半精灵。',
  icons: {
    icon: [
      { url: '/favicon.png', sizes: '32x32', type: 'image/png' },
      { url: '/icon.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/icon.png',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0a0f26',
};

// 在页面渲染前设定主题，避免刷新时闪烁；默认雪夜（暗色）模式
const themeInit = `(function () {
  try {
    var stored = localStorage.getItem('theme');
    var dark = stored === 'dark' || !stored;
    document.documentElement.classList.toggle('dark', dark);
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', dark ? '#0a0f26' : '#f7f6fd');
  } catch (e) {
    document.documentElement.classList.add('dark');
  }
})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const musicEnabled = Boolean(env('MUSIC_API_KEY') && env('MUSIC_PLAYLIST_ID'));

  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="site-shell min-h-screen font-sans text-slate-800 antialiased dark:text-slate-200">
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
        {/* 衬线标题字体；国内网络加载失败时自动回落本地宋体 */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@500;700;900&display=swap"
        />

        <Nav />
        {/* 首页壁纸作为全站固定背景；内容通过下方的玻璃层与它融合。 */}
        <SiteWallpaper />
        {children}
        <Footer />
        <SpiritSparks />
        {musicEnabled ? <MusicPlayer /> : null}
        <VisitTracker />
        <NavigationEvents />
        <script src="/scripts/liquid-glass-effect.js" />
      </body>
    </html>
  );
}