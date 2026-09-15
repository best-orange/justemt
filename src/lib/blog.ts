/**
 * 读取仓库内的博客文章（src/content/blog/*.md），
 * 替代 Astro Content Collections 的 getCollection + render。
 *
 * 文章是仓库自己的内容，被视为可信输入；正文经 marked 渲染成 HTML。
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { marked } from 'marked';
import { parse as parseYaml } from 'yaml';

const BLOG_DIR = path.join(process.cwd(), 'src', 'content', 'blog');

export interface BlogPostMeta {
  title: string;
  description: string;
  pubDate: string;
  updatedDate?: string;
  tags: string[];
  draft: boolean;
  private: boolean;
}

export interface BlogPost extends BlogPostMeta {
  slug: string;
  html: string;
}

/** 拆出 YAML frontmatter 与正文；没有 frontmatter 时按整篇正文处理 */
function splitFrontmatter(raw: string): { data: Record<string, unknown>; content: string } {
  const normalized = raw.replace(/^\uFEFF/, '');
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { data: {}, content: normalized };
  let data: Record<string, unknown> = {};
  try {
    data = (parseYaml(match[1]) ?? {}) as Record<string, unknown>;
  } catch (error) {
    console.error('[blog] frontmatter 解析失败：', error);
  }
  return { data, content: normalized.slice(match[0].length) };
}

const text = (value: unknown, max: number, fallback: string): string => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed ? trimmed.slice(0, max) : fallback;
};

function dateFrom(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return '';
}

function tagsFrom(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => text(item, 24, ''))
    .filter(Boolean)
    .slice(0, 12);
}

function metaFrom(raw: string, data: Record<string, unknown>): BlogPostMeta {
  // 标题缺失时退回正文第一行的标题（`# ...`）或文件名占位，保持列表稳定
  const fallbackTitle = raw.match(/^#\s+(.+)$/m)?.[1]?.trim().slice(0, 120) ?? '未命名笔记';
  return {
    title: text(data.title, 120, fallbackTitle),
    description: text(data.description, 300, ''),
    pubDate: dateFrom(data.pubDate),
    updatedDate: dateFrom(data.updatedDate) || undefined,
    tags: tagsFrom(data.tags),
    draft: data.draft === true,
    private: data.private === true,
  };
}

async function parsePost(file: string): Promise<BlogPost | null> {
  const slug = file.replace(/\.(md|mdx)$/, '');
  try {
    const raw = await readFile(path.join(BLOG_DIR, file), 'utf8');
    const { data, content } = splitFrontmatter(raw);
    const meta = metaFrom(content, data);
    return { slug, ...meta, html: marked.parse(content) as string };
  } catch (error) {
    console.error(`[blog] ${file} 读取失败：`, error);
    return null;
  }
}

/** 按发布倒序读取全部文章；draft 不进入可访问集合，调用方负责 private 过滤 */
export async function listBlogPosts(): Promise<BlogPost[]> {
  let files: string[];
  try {
    files = (await readdir(BLOG_DIR)).filter((name) => /\.(md|mdx)$/.test(name));
  } catch {
    return [];
  }
  const posts = (await Promise.all(files.map(parsePost)))
    .filter((post): post is BlogPost => post !== null && !post.draft);
  return posts.sort((a, b) => b.pubDate.localeCompare(a.pubDate) || b.slug.localeCompare(a.slug));
}

export async function getBlogPost(slug: string): Promise<BlogPost | undefined> {
  const posts = await listBlogPosts();
  return posts.find((post) => post.slug === slug);
}