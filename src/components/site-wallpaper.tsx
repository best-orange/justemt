'use client';

import { useEffect } from 'react';

/**
 * 全站固定壁纸 + 滚动驱动的玻璃渐变（--site-glass-* 变量）
 * + 深色模式背景亮度自适应检测（动态设置 data-bg="light" / "dark" 使白底呈现深紫色字体）。
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

      // ---------- 离屏壁纸亮度采样器 ----------
      const sampleWidth = 48;
      const sampleHeight = 27;
      let sampleData: ImageData | null = null;
      let imageAspectRatio = 16 / 9;

      const loadWallpaperSample = () => {
        if (typeof window === 'undefined') return;
        const isDark = document.documentElement.classList.contains('dark');
        if (!isDark) {
          sampleData = null;
          return;
        }

        const isMobile = window.innerWidth <= 768;
        const src = isMobile ? '/hero-dark-mobile.webp' : '/hero.webp';
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = sampleWidth;
            canvas.height = sampleHeight;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (!ctx) return;
            ctx.drawImage(img, 0, 0, sampleWidth, sampleHeight);
            sampleData = ctx.getImageData(0, 0, sampleWidth, sampleHeight);
            if (img.naturalWidth && img.naturalHeight) {
              imageAspectRatio = img.naturalWidth / img.naturalHeight;
            }
            updateAdaptiveText();
          } catch {
            sampleData = null;
          }
        };
        img.onerror = () => {
          sampleData = null;
        };
        img.src = src;
      };

      // ---------- 采样特定元素背后壁纸的感知亮度 ----------
      const getElementBackdropLuminance = (el: HTMLElement): number => {
        if (!sampleData) return 0.8; // 默认深色模式桌面壁纸为白色大教堂
        const rect = el.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        const viewAspect = vw / vh;
        let scale: number, offsetX = 0, offsetY = 0;
        if (viewAspect > imageAspectRatio) {
          scale = vw;
          const renderedH = vw / imageAspectRatio;
          offsetY = (vh - renderedH) / 2;
        } else {
          scale = vh * imageAspectRatio;
          const renderedW = scale;
          offsetX = (vw - renderedW) / 2;
          offsetY = 0;
        }

        const u1 = Math.max(0, Math.min(1, (rect.left - offsetX) / (viewAspect > imageAspectRatio ? vw : scale)));
        const v1 = Math.max(0, Math.min(1, (rect.top - offsetY) / (viewAspect > imageAspectRatio ? (vw / imageAspectRatio) : vh)));
        const u2 = Math.max(0, Math.min(1, (rect.right - offsetX) / (viewAspect > imageAspectRatio ? vw : scale)));
        const v2 = Math.max(0, Math.min(1, (rect.bottom - offsetY) / (viewAspect > imageAspectRatio ? (vw / imageAspectRatio) : vh)));

        const xStart = Math.floor(u1 * (sampleWidth - 1));
        const xEnd = Math.ceil(u2 * (sampleWidth - 1));
        const yStart = Math.floor(v1 * (sampleHeight - 1));
        const yEnd = Math.ceil(v2 * (sampleHeight - 1));

        let totalLum = 0;
        let count = 0;
        const data = sampleData.data;

        for (let y = yStart; y <= yEnd; y++) {
          for (let x = xStart; x <= xEnd; x++) {
            const idx = (y * sampleWidth + x) * 4;
            const r = data[idx];
            const g = data[idx + 1];
            const b = data[idx + 2];
            const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
            totalLum += lum;
            count++;
          }
        }

        return count > 0 ? totalLum / count : 0.8;
      };

      const updateAdaptiveText = () => {
        const isDark = document.documentElement.classList.contains('dark');
        if (!isDark) {
          document.querySelectorAll('[data-bg]').forEach((node) => {
            node.removeAttribute('data-bg');
          });
          return;
        }

        const selector =
          '.site-content-surface, #site-header, .hero-subtitle-capsule, #quote-carousel, [data-home-page], .chat__shell, [data-adaptive-bg]';
        const targets = document.querySelectorAll<HTMLElement>(selector);

        targets.forEach((target) => {
          const lum = getElementBackdropLuminance(target);
          const mode = lum > 0.45 ? 'light' : 'dark';
          if (target.getAttribute('data-bg') !== mode) {
            target.setAttribute('data-bg', mode);
          }
        });
      };

      // ---------- 玻璃渐变与亮度更新循环 ----------
      const updateGlass = () => {
        glassFrame = undefined;

        const scrollRange = Math.max(window.innerHeight * 1.25, 1);
        const rawProgress = Math.min(Math.max(window.scrollY / scrollRange, 0), 1);
        const progress = rawProgress * rawProgress * (3 - 2 * rawProgress);

        wallpaper.style.setProperty('--site-glass-opacity', (progress * 0.7).toFixed(3));
        wallpaper.style.setProperty('--site-glass-blur', `${(progress * 22).toFixed(2)}px`);
        wallpaper.style.setProperty('--site-glass-saturation', (1 + progress * 0.38).toFixed(3));

        updateAdaptiveText();
      };

      const requestGlassUpdate = () => {
        if (glassFrame === undefined) glassFrame = window.requestAnimationFrame(updateGlass);
      };

      // 预先给主要容器赋予 light 属性以避免深色模式下初次渲染白字看不清
      if (document.documentElement.classList.contains('dark')) {
        document.querySelectorAll<HTMLElement>(
          '.site-content-surface, #site-header, .hero-subtitle-capsule, #quote-carousel, [data-home-page]'
        ).forEach((el) => {
          if (!el.hasAttribute('data-bg')) el.setAttribute('data-bg', 'light');
        });
      }

      loadWallpaperSample();
      updateGlass();

      window.addEventListener('scroll', requestGlassUpdate, { passive: true, signal: controller.signal });
      window.addEventListener('resize', () => {
        loadWallpaperSample();
        requestGlassUpdate();
      }, { passive: true, signal: controller.signal });

      // 监听 html.dark 切换
      const themeObserver = new MutationObserver(() => {
        loadWallpaperSample();
        requestGlassUpdate();
      });
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class'],
      });

      cleanup = () => {
        controller.abort();
        themeObserver.disconnect();
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