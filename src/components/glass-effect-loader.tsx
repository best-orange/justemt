'use client';

import { useEffect } from 'react';

/**
 * 在挂载后（水合完成）再加载 liquid-glass 脚本。
 * 该脚本会给 .music-player / .music-room__now / .glass-dark 元素设置内联 style，
 * 如果在 hydration 之前执行，React 会报属性不匹配的水合告警。
 * 脚本自己会在加载后立刻扫描一次，并在 justemt:page-load 事件时重扫。
 */
export default function GlassEffectLoader() {
  useEffect(() => {
    const script = document.createElement('script');
    script.src = '/scripts/liquid-glass-effect.js';
    script.async = true;
    document.body.append(script);
    return () => script.remove();
  }, []);

  return null;
}