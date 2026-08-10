---
title: "用 Astro 搭建内容型网站的一些体会"
description: "记录使用 Astro 的 Content Collections 管理博客和作品的心得。"
pubDate: 2026-07-24
tags: ["Astro", "前端", "技术"]
---

## 为什么选 Astro

Astro 默认输出零 JavaScript，页面加载非常快，特别适合博客、作品集这类以内容为主的网站。

## Content Collections

把文章和作品都放在 `src/content/` 下用 Markdown 管理，再用 `defineCollection` 定义 schema，就能获得类型检查和自动补全：

```ts
const blog = defineCollection({
  loader: glob({ base: "./src/content/blog", pattern: "**/*.md" }),
  schema: z.object({
    title: z.string(),
    pubDate: z.coerce.date(),
  }),
});
```

写内容时只管写 Markdown，字段写错了构建时就会报错，很省心。

## 小结

对个人网站来说，Astro 的开发体验和性能都很出色，推荐一试。
