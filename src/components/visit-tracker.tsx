'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

/**
 * 只记录“有人来了”，不记录站内每次翻页：一次浏览会话上报一次入口页面。
 * 逻辑与 Astro 版 BaseLayout 的内联脚本一致；客户端导航到可记录页面时补报。
 */
export default function VisitTracker() {
  const pathname = usePathname();
  const recordVisitRef = useRef<() => void>(() => {});

  useEffect(() => {
    const marker = '__justEmtVisitorTracking';
    if (Reflect.get(globalThis, marker)) return;
    Reflect.set(globalThis, marker, true);

    const SESSION_FLAG = 'justemt:visit-reported';

    const isTrackablePath = (path: string) => path.startsWith('/')
      && !path.startsWith('/api/')
      && !path.startsWith('/_next/')
      && path !== '/login'
      && path !== '/visitors'
      && path !== '/gallery/manage'
      && !path.startsWith('/blog/');

    // 本次浏览会话是否已经上报过；sessionStorage 不可用（隐私模式等）时退回内存标记。
    let reported = false;
    const alreadyReported = () => {
      if (reported) return true;
      try {
        return window.sessionStorage.getItem(SESSION_FLAG) === '1';
      } catch {
        return false;
      }
    };
    const markReported = () => {
      reported = true;
      try {
        window.sessionStorage.setItem(SESSION_FLAG, '1');
      } catch {
        // 无法写入时靠内存标记兜底，服务端还有时间窗口去重。
      }
    };

    const recordVisit = () => {
      const path = window.location.pathname;
      if (!isTrackablePath(path) || alreadyReported()) return;
      markReported();
      void fetch('/api/visitors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
        keepalive: true,
      }).catch(() => {
        // 统计故障不能影响页面使用。
      });
    };

    recordVisitRef.current = recordVisit;
    // 入口页面即可记录时立刻上报（效果执行时 location 已可用）
    recordVisit();
  }, []);

  useEffect(() => {
    // 入口页面不可记录时（例如从博客进站），等切到可记录页面再补一次。
    recordVisitRef.current();
  }, [pathname]);

  return null;
}