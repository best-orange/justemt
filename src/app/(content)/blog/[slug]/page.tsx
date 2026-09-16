import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AUTH_COOKIE, verifyToken } from '@/lib/auth';
import { getBlogPost } from '@/lib/blog';

interface BlogPostPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: BlogPostPageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = await getBlogPost(slug);
  if (!post) {
    return {
      title: '博客 · justEMT',
      description: 'Emilia 的博客文章与心情笔记。',
    };
  }

  // 私密文章的正文虽然会在 page render 时重定向，但 metadata 是独立生成的。
  // 未鉴权时不能把标题/摘要泄漏给爬虫、链接预览器或直接请求 metadata 的客户端。
  if (post.private) {
    const jar = await cookies();
    const authenticated = verifyToken(jar.get(AUTH_COOKIE)?.value);
    if (!authenticated) {
      return {
        title: '私密文章 · justEMT',
        description: '这篇笔记需要验证后才能查看。',
        robots: { index: false, follow: false, noarchive: true },
      };
    }
  }

  return {
    title: `${post.title} · justEMT`,
    description: post.description || 'Emilia 的博客文章与心情笔记。',
    robots: post.private ? { index: false, follow: false, noarchive: true } : undefined,
  };
}

export default async function BlogPostPage({ params }: BlogPostPageProps) {
  const { slug } = await params;
  const post = await getBlogPost(slug);
  if (!post) {
    redirect('/blog');
  }

  const jar = await cookies();
  if (post.private && !verifyToken(jar.get(AUTH_COOKIE)?.value)) {
    redirect(`/login?next=${encodeURIComponent(`/blog/${post.slug}`)}`);
  }

  const fmt = (value: string | Date) =>
    new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }).format(
      value instanceof Date ? value : new Date(value)
    );
  const pubDate = new Date(post.pubDate);
  const updatedDate = post.updatedDate ? new Date(post.updatedDate) : undefined;

  return (
    <article>
      <Link
        href="/blog"
        className="text-sm text-slate-500 transition-colors hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
      >
        ← 返回博客
      </Link>

      <header className="mt-6">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">{post.title}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500 dark:text-slate-300">
          <time dateTime={pubDate.toISOString()}>{fmt(pubDate)}</time>
          {updatedDate && <span>· 更新于 {fmt(updatedDate)}</span>}
          {post.private && <span className="rounded-full bg-lilac-400/15 px-2 py-0.5 text-xs text-violet-700 dark:text-lilac-200">私密文章</span>}
        </div>
        {post.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {post.tags.map((tag) => (
              <span key={tag} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                {tag}
              </span>
            ))}
          </div>
        )}
      </header>

      {/* 博客正文来自仓库内的 Markdown；若未来开放后台投稿，应在这里之前增加 HTML sanitizer。 */}
      <div
        className="prose prose-slate mt-8 max-w-none dark:prose-invert prose-headings:font-semibold prose-a:text-blue-600 dark:prose-a:text-blue-400"
        dangerouslySetInnerHTML={{ __html: post.html }}
      />
    </article>
  );
}
