'use client';

import { useEffect } from 'react';

/**
 * 全站固定壁纸 + 滚动驱动的玻璃渐变（--site-glass-* 变量），
 * 逻辑与 Astro 版 BaseLayout 的内联脚本一致。根布局持久挂载，
 * 客户端导航不会重建该节点，这里补监听 justemt:page-load 只是兜底。
 */
export default function SiteWallpaper() {
  useEffect(() => {
    let cleanup = () => {};
    let glassFrame: number | undefined;

    const initializeSiteWallpaper = () => {
      cleanup();

      const wallpaper = document.querySelector('[data-site-wallpaper]');
      if (!wallpaper || !(wallpaper instanceof HTMLElement)) return;

      const controller = new AbortController();
      const updateGlass = () => {
        glassFrame = undefined;

        const scrollRange = Math.max(window.innerHeight * 1.25, 1);
        const rawProgress = Math.min(Math.max(window.scrollY / scrollRange, 0), 1);
        // 让玻璃层在刚开始上滑时更柔和，接近内容区时再明显出现。
        const progress = rawProgress * rawProgress * (3 - 2 * rawProgress);

        wallpaper.style.setProperty('--site-glass-opacity', (0.035 + progress * 0.66).toFixed(3));
        wallpaper.style.setProperty('--site-glass-blur', `${(progress * 22).toFixed(2)}px`);
        wallpaper.style.setProperty('--site-glass-saturation', (1 + progress * 0.38).toFixed(3));
      };
      const requestGlassUpdate = () => {
        if (glassFrame === undefined) glassFrame = window.requestAnimationFrame(updateGlass);
      };

      updateGlass();
      window.addEventListener('scroll', requestGlassUpdate, { passive: true, signal: controller.signal });
      window.addEventListener('resize', requestGlassUpdate, { passive: true, signal: controller.signal });

      cleanup = () => {
        controller.abort();
        if (glassFrame !== undefined) window.cancelAnimationFrame(glassFrame);
        glassFrame = undefined;
      };
    };

    initializeSiteWallpaper();
    const onPageLoad = () => initializeSiteWallpaper();
    window.addEventListener('justemt:page-load', onPageLoad);

    return () => {
      cleanup();
      window.removeEventListener('justemt:page-load', onPageLoad);
    };
  }, []);

  return (
    <div className="site-wallpaper" data-site-wallpaper aria-hidden="true">
      <div className="hero-bg site-wallpaper__image" />
      <div className="site-wallpaper__glass" />
    </div>
  );
}