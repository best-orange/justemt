import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const blog = defineCollection({
  loader: glob({ base: './src/content/blog', pattern: '**/*.{md,mdx}' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
    private: z.boolean().default(false),
  }),
});

const gallery = defineCollection({
  loader: glob({ base: './src/content/gallery', pattern: '**/*.yaml' }),
  schema: z.object({
    title: z.string(),
    /** 图片路径（public/ 下） */
    image: z.string(),
    /** 可选的预览图与缩略图；远程图库迁移后用于渐进加载 */
    preview: z.string().optional(),
    thumbnail: z.string().optional(),
    /** 图片尺寸；没有填写时画廊会使用保守的 3:4 占位比例 */
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    /** 作品说明 */
    description: z.string().optional(),
    date: z.coerce.date(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
});

export const collections = { blog, gallery };
