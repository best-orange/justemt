import { defineMiddleware } from 'astro:middleware';
import { AUTH_COOKIE, verifyToken } from './lib/auth';

/**
 * 隐藏区域的访问控制：
 * 相册管理页需要有效的签名会话 Cookie；博客文章是否私有由文章自身的 frontmatter 决定。
 * 否则重定向到 /login 并记录来源路径。
 */
export const onRequest = defineMiddleware((context, next) => {
  const { pathname } = context.url;

  const protectedPage = pathname === '/gallery/manage';

  if (protectedPage) {
    const token = context.cookies.get(AUTH_COOKIE)?.value;
    if (!verifyToken(token)) {
      const nextUrl = encodeURIComponent(pathname);
      return context.redirect(`/login?next=${nextUrl}`, 302);
    }
  }

  return next();
});
