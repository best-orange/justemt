// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

import vercel from '@astrojs/vercel';

// https://astro.build/config
export default defineConfig({
  vite: {
    plugins: [tailwindcss()]
  },

  // maxDuration 必须大于 src/lib/chat.ts 的 TIMEOUT_MS（55s），
  // 否则流式对话会被平台先掐断，超时和退还配额的逻辑来不及执行。
  // Hobby 计划上限 60s；Pro 可以调更高。
  adapter: vercel({ maxDuration: 60 })
});
