import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { AUTH_COOKIE, verifyToken } from '../../lib/auth';
import {
  commitGalleryPhoto,
  createGalleryUploadPlan,
  deleteGalleryPhoto,
  galleryLimits,
  isGalleryR2Configured,
  readGalleryManifest,
  toPublicGalleryPhoto,
} from '../../lib/gallery';
import type { GalleryPhoto } from '../../lib/gallery';

export const prerender = false;

const json = (data: unknown, status = 200, cache?: string) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    ...(cache ? { 'Cache-Control': cache } : {}),
  },
});

function isAdmin(cookies: Parameters<NonNullable<APIRoute>>[0]['cookies']): boolean {
  return verifyToken(cookies.get(AUTH_COOKIE)?.value);
}

/** 将现有 YAML 内容转成与 R2 manifest 相同的公开结构，确保迁移期间无缝回退。 */
async function localPhotos(): Promise<GalleryPhoto[]> {
  const collection = await getCollection('gallery', ({ data }) => !data.draft);
  return collection.map((item) => ({
    id: `local-${item.id}`,
    title: item.data.title,
    description: item.data.description,
    date: item.data.date.toISOString().slice(0, 10),
    tags: item.data.tags,
    width: item.data.width ?? 0,
    height: item.data.height ?? 0,
    image: item.data.image,
    preview: item.data.preview ?? item.data.image,
    thumbnail: item.data.thumbnail ?? item.data.image,
    source: 'local' as const,
  }));
}

async function allPhotos(): Promise<{ photos: GalleryPhoto[]; remoteAvailable: boolean }> {
  const local = await localPhotos();
  if (!isGalleryR2Configured()) {
    return { photos: local, remoteAvailable: false };
  }
  try {
    const manifest = await readGalleryManifest();
    const remote = manifest.photos.map(toPublicGalleryPhoto);
    return { photos: [...remote, ...local], remoteAvailable: true };
  } catch (error) {
    console.error('[gallery] R2 manifest unavailable, using local gallery:', error);
    return { photos: local, remoteAvailable: false };
  }
}

function tagsFrom(photos: GalleryPhoto[]): string[] {
  return [...new Set(photos.flatMap((photo) => photo.tags))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

/** GET /api/gallery —— 分页读取远程 manifest 与本地 YAML 的合并结果。 */
export const GET: APIRoute = async ({ url }) => {
  const limit = Math.min(48, Math.max(1, Number(url.searchParams.get('limit') ?? 24) || 24));
  const cursor = Math.max(0, Number(url.searchParams.get('cursor') ?? 0) || 0);
  const tag = url.searchParams.get('tag')?.trim() ?? '*';
  try {
    const result = await allPhotos();
    const filtered = result.photos
      .filter((photo) => tag === '*' || photo.tags.includes(tag))
      .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
    const items = filtered.slice(cursor, cursor + limit);
    const nextCursor = cursor + items.length < filtered.length ? String(cursor + items.length) : null;
    return json({
      ok: true,
      items,
      nextCursor,
      total: filtered.length,
      tags: tagsFrom(result.photos),
      remoteAvailable: result.remoteAvailable,
    }, 200, 'public, max-age=0, s-maxage=30, stale-while-revalidate=300');
  } catch (error) {
    console.error('[gallery] list failed:', error);
    return json({ ok: false, message: '画廊暂时无法加载' }, 500, 'no-store');
  }
};

/** POST /api/gallery —— 管理员签发直传 URL 或提交上传后的元数据。 */
export const POST: APIRoute = async ({ request, cookies }) => {
  if (!isAdmin(cookies)) return json({ ok: false, message: '需要先解封阅览室' }, 401);
  if (!isGalleryR2Configured()) return json({ ok: false, message: 'R2 尚未配置' }, 503);

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return json({ ok: false, message: '请求格式错误' }, 400);
  }

  try {
    if (body.action === 'presign') {
      const fileName = typeof body.fileName === 'string' ? body.fileName : '';
      const contentType = typeof body.contentType === 'string' ? body.contentType : '';
      const sha256 = typeof body.sha256 === 'string' ? body.sha256 : '';
      if (!fileName || !galleryLimits.allowedTypes.includes(contentType)) {
        return json({ ok: false, message: '不支持的图片格式' }, 400);
      }
      return json({ ok: true, plan: await createGalleryUploadPlan(fileName, contentType, sha256) }, 200, 'no-store');
    }

    if (body.action === 'commit') {
      const required = ['id', 'originalKey', 'previewKey', 'thumbnailKey', 'title', 'date'];
      if (required.some((key) => typeof body[key] !== 'string')) {
        return json({ ok: false, message: '缺少图片信息' }, 400);
      }
      const tags = Array.isArray(body.tags) ? body.tags.filter((tag): tag is string => typeof tag === 'string') : [];
      const photo = await commitGalleryPhoto({
        id: body.id as string,
        originalKey: body.originalKey as string,
        previewKey: body.previewKey as string,
        thumbnailKey: body.thumbnailKey as string,
        title: body.title as string,
        description: typeof body.description === 'string' ? body.description : undefined,
        date: body.date as string,
        tags,
        width: Number(body.width),
        height: Number(body.height),
        size: Number(body.size),
        sha256: typeof body.sha256 === 'string' ? body.sha256 : '',
      });
      return json({ ok: true, photo }, 201, 'no-store');
    }

    return json({ ok: false, message: '未知 action' }, 400);
  } catch (error) {
    console.error('[gallery] admin action failed:', error);
    return json({ ok: false, message: error instanceof Error ? error.message : '相册操作失败' }, 400);
  }
};

/** DELETE /api/gallery?id=... —— 删除一张远程作品；本地 YAML 内容不会被此接口删除。 */
export const DELETE: APIRoute = async ({ url, cookies }) => {
  if (!isAdmin(cookies)) return json({ ok: false, message: '需要先解封阅览室' }, 401);
  if (!isGalleryR2Configured()) return json({ ok: false, message: 'R2 尚未配置' }, 503);
  const id = url.searchParams.get('id')?.trim();
  if (!id || id.startsWith('local-')) return json({ ok: false, message: '这张作品来自仓库，不能在线删除' }, 400);
  try {
    const deleted = await deleteGalleryPhoto(id);
    return deleted ? json({ ok: true }, 200, 'no-store') : json({ ok: false, message: '作品不存在' }, 404);
  } catch (error) {
    console.error('[gallery] delete failed:', error);
    return json({ ok: false, message: '删除失败' }, 500);
  }
};
