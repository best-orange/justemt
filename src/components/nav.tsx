'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import ThemeToggle from './theme-toggle';
import { LiquidGlass, GlassIconButton } from './liquid-glass';

const links = [
  { href: '/', label: '首页' },
  { href: '/music', label: '音乐室' },
  { href: '/gallery', label: '画廊' },
  { href: '/chat', label: '对话' },
  { href: '/blog', label: '博客' },
  { href: '/visitors', label: '来访' },
  { href: '/about', label: '关于' },
];

export default function Nav() {
  const pathname = usePathname();
  // 沉浸式：初始透明悬浮在壁纸上，下滑后变为实色背景（首页与登录页）
  const immersive = pathname === '/' || pathname === '/login';
  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  const [menuOpen, setMenuOpen] = useState(false);

  // 液态玻璃按钮的局部折射光与点击扩散反馈；窗口拉宽时收起菜单。
  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      const control = event.target.closest<HTMLElement>(
        '.nav-glass-control, .glass-pill, .tag-chip, .glass-btn, .glass-icon-btn, .chat__chip, .chat__suggestion, .chat__ghost-button, .chat__send, .hero-subtitle-capsule'
      );
      if (!control) return;
      const rect = control.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      control.style.setProperty('--nav-light-x', `${px}px`);
      control.style.setProperty('--nav-light-y', `${py}px`);
      control.style.setProperty('--glass-x', `${((px / rect.width) * 100).toFixed(1)}%`);
      control.style.setProperty('--glass-y', `${((py / rect.height) * 100).toFixed(1)}%`);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      const control = event.target.closest<HTMLElement>(
        '.nav-glass-control, .glass-pill, .tag-chip, .glass-btn, .glass-icon-btn, .chat__chip, .chat__suggestion, .chat__ghost-button, .chat__send, .hero-subtitle-capsule'
      );
      if (!control) return;
      const rect = control.getBoundingClientRect();
      control.style.setProperty('--nav-press-x', `${event.clientX - rect.left}px`);
      control.style.setProperty('--nav-press-y', `${event.clientY - rect.top}px`);
      control.classList.remove('is-pressing');
      requestAnimationFrame(() => control.classList.add('is-pressing'));
      window.setTimeout(() => control.classList.remove('is-pressing'), 560);
    };
    const onResize = () => {
      if (window.innerWidth >= 640) setMenuOpen(false);
    };

    document.addEventListener('pointermove', onPointerMove, { passive: true });
    document.addEventListener('pointerdown', onPointerDown, { passive: true });
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  // 沉浸式顶栏：下滑超过一屏的 60% 时切换为实色背景。
  useEffect(() => {
    const header = document.getElementById('site-header');
    if (!header) return;
    if (!immersive) {
      header.classList.remove('scrolled');
      return;
    }
    const onScroll = () => {
      const scrolled = window.scrollY > window.innerHeight * 0.6;
      header.classList.toggle('scrolled', scrolled);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [immersive, pathname]);

  const brandLabelClass = immersive
    ? 'text-[#3d3658] dark:text-white dark:drop-shadow'
    : 'text-frost';
  const menuButtonClass = immersive
    ? 'text-[#3d3658] dark:text-white dark:drop-shadow'
    : 'text-slate-600 dark:text-slate-300';

  return (
    <header
      id="site-header"
      data-immersive={immersive ? 'true' : undefined}
      className="fixed inset-x-0 top-0 z-40"
    >
      <nav className="mx-auto flex h-16 max-w-4xl items-center justify-between px-4">
        <Link href="/" className="inline-block">
          <LiquidGlass
            radius={999}
            bevel={8}
            refraction={28}
            blur={0.2}
            dispersion={2.2}
            tint="transparent"
            className="transition-transform hover:-translate-y-0.5"
            contentClassName="px-3.5 py-1.5 font-display text-lg font-bold tracking-wide"
          >
            <span className={brandLabelClass}>Emilia</span>
          </LiquidGlass>
        </Link>

        {/* 桌面端：横向链接 */}
        <div className="hidden items-center gap-1.5 sm:flex">
          {links.map((link) => {
            const active = isActive(link.href);
            return (
              <Link key={link.href} href={link.href} className="inline-block">
                <LiquidGlass
                  radius={999}
                  bevel={7}
                  refraction={24}
                  blur={0.2}
                  dispersion={2.0}
                  tint={active ? 'rgba(160, 126, 240, 0.25)' : 'transparent'}
                  className="transition-transform hover:-translate-y-0.5"
                  contentClassName={`px-3.5 py-1.5 text-sm font-medium transition-colors ${
                    active
                      ? 'text-violet-700 dark:text-lilac-200'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-200 dark:hover:text-white'
                  }`}
                >
                  <span>{link.label}</span>
                </LiquidGlass>
              </Link>
            );
          })}
          <ThemeToggle />
        </div>

        {/* 移动端：主题开关 + 汉堡按钮 */}
        <div className="flex items-center gap-1.5 sm:hidden">
          <ThemeToggle />
          <GlassIconButton
            id="menu-btn"
            data-menu-toggle
            type="button"
            aria-label={menuOpen ? '关闭菜单' : '打开菜单'}
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            onClick={() => setMenuOpen((open) => !open)}
            wrapperClassName="!p-0"
          >
            {/* 三横线 */}
            <svg
              id="menu-icon-open"
              className={`h-5 w-5${menuOpen ? ' hidden' : ''}`}
              fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
            {/* 关闭叉 */}
            <svg
              id="menu-icon-close"
              className={`h-5 w-5${menuOpen ? '' : ' hidden'}`}
              fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </GlassIconButton>
        </div>
      </nav>

      {/* 移动端下拉面板 */}
      <div
        id="mobile-menu"
        className={`nav-mobile-panel px-4 pb-4 pt-2 sm:hidden${menuOpen ? '' : ' hidden'}`}
      >
        <div className="flex flex-col gap-2">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setMenuOpen(false)}
              className={`nav-glass-control nav-link nav-mobile-link rounded-2xl px-4 py-3 text-base font-medium${isActive(link.href) ? ' is-active' : ''}`}
            >
              <span className="relative z-[1]">{link.label}</span>
            </Link>
          ))}
        </div>
      </div>
    </header>
  );
}