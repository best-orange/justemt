import type { NextConfig } from 'next';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];

// 流式路由的函数时长上限在各自的 route.ts 里以 `export const maxDuration = 60` 声明
const nextConfig: NextConfig = {
  // 允许从 127.0.0.1（IP 直连）访问开发资源，便于无 Cookie 环境的本地调试
  allowedDevOrigins: ['127.0.0.1'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
