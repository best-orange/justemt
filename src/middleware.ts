import { defineMiddleware } from 'astro:middleware';
import { AUTH_COOKIE, verifyToken } from './lib/auth';

/**
 * 隐藏区域的访问控制：
 * /blog 下的所有页面（服务端渲染）需要有效的签名会话 Cookie，
 * 否则重定向到 /login 并记录来源路径。
 */
export const onRequest = defineMiddleware((context, next) => {
  const { pathname } = context.url;

  if (pathname === '/blog' || pathname.startsWith('/blog/')) {
    const token = context.cookies.get(AUTH_COOKIE)?.value;
    if (!verifyToken(token)) {
      const nextUrl = encodeURIComponent(pathname);
      return context.redirect(`/login?next=${nextUrl}`, 302);
    }
  }

  return next();
});
