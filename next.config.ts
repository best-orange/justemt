import type { NextConfig } from 'next';

// 流式路由的函数时长上限在各自的 route.ts 里以 `export const maxDuration = 60` 声明
const nextConfig: NextConfig = {
  // 允许从 127.0.0.1（IP 直连）访问开发资源，便于无 Cookie 环境的本地调试
  allowedDevOrigins: ['127.0.0.1'],
};

export default nextConfig;