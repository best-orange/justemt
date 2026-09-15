'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

/**
 * 客户端路由变化时广播 justemt:page-load，
 * 供 liquid-glass-effect 等需要在导航后重新扫一遍 DOM 的脚本使用。
 */
export default function NavigationEvents() {
  const pathname = usePathname();

  useEffect(() => {
    window.dispatchEvent(new Event('justemt:page-load'));
  }, [pathname]);

  return null;
}