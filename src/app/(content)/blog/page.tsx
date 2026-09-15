import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import Card from '@/components/card';
import LogoutButton from '@/components/logout-button';
import { AUTH_COOKIE, verifyToken } from '@/lib/auth';
import { listBlogPosts } from '@/lib/blog';

export const metadata: Metadata = {
  title: '博客 · justEMT',
  description: 'Emilia 的博客文章与心情笔记。',
};

export default async function BlogIndexPage() {
  const jar = await cookies();
  const isAuthenticated = verifyToken(jar.get(AUTH_COOKIE)?.value);
  // 服务端渲染：列表根据文章 private 字段决定是否显示私有文章。
  const posts = (await listBlogPosts())
    .filter((post) => !post.draft && (isAuthenticated || !post.private))
    .sort((a, b) => b.pubDate.localeCompare(a.pubDate));

  return (
    <>
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-wide sm:text-4xl">
            <span className="text-frost">冰封阅览室</span>
          </h1>
          <p className="mt-3 text-slate-600 dark:text-slate-300">
            {isAuthenticated ? '公开文章与私密笔记，都在这里安静地等候。' : '公开文章无需暗号；私密笔记会在验证后开放。'}
          </p>
        </div>
        {isAuthenticated ? (
          <LogoutButton />
        ) : (
          <a
            href="/login?next=%2Fblog"
            className="shrink-0 rounded-lg border border-lilac-400/30 px-3 py-1.5 text-sm text-slate-500 transition-colors hover:text-violet-700 dark:text-slate-300 dark:hover:text-lilac-200"
          >
            解封私密文章
          </a>
        )}
      </header>

      {posts.length > 0 ? (
        <div className="mt-8 grid gap-4">
          {posts.map((post) => (
            <Card
              key={post.slug}
              title={post.title}
              description={post.description}
              href={`/blog/${post.slug}`}
              date={post.pubDate}
              tags={post.tags}
              isPrivate={post.private}
            />
          ))}
        </div>
      ) : (
        <p className="mt-8 rounded-2xl border border-dashed border-lilac-400/30 px-5 py-8 text-center text-sm text-slate-500 dark:text-slate-300">
          暂时没有公开文章，解封后可以查看私密笔记。
        </p>
      )}
    </>
  );
}