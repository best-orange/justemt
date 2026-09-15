import { cookies } from 'next/headers';
import { AUTH_COOKIE, verifyToken } from '@/lib/auth';
import {
  commitGalleryPhoto,
  createGalleryUploadPlan,
  deleteGalleryPhoto,
  galleryLimits,
  isGalleryR2Configured,
  readGalleryManifest,
  toPublicGalleryPhoto,
} from '@/lib/gallery';
import type { GalleryPhoto } from '@/lib/gallery';
import { localGalleryPhotos } from '@/lib/localGallery';

export const maxDuration = 300;

const json = (data: unknown, status = 200, cache?: string) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    ...(cache ? { 'Cache-Control': cache } : {}),
  },
});

async function isAdmin(): Promise<boolean> {
  const jar = await cookies();
  return verifyToken(jar.get(AUTH_COOKIE)?.value);
}

async function allPhotos(): Promise<{ photos: GalleryPhoto[]; remoteAvailable: boolean }> {
  const local = await localGalleryPhotos();
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
export async function GET(request: Request) {
  const url = new URL(request.url);
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
}

/** POST /api/gallery —— 管理员签发直传 URL 或提交上传后的元数据。 */
export async function POST(request: Request) {
  if (!(await isAdmin())) return json({ ok: false, message: '需要先解封阅览室' }, 401);
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
}

/** DELETE /api/gallery?id=... —— 删除一张远程作品；本地 YAML 内容不会被此接口删除。 */
export async function DELETE(request: Request) {
  if (!(await isAdmin())) return json({ ok: false, message: '需要先解封阅览室' }, 401);
  if (!isGalleryR2Configured()) return json({ ok: false, message: 'R2 尚未配置' }, 503);
  const url = new URL(request.url);
  const id = url.searchParams.get('id')?.trim();
  if (!id || id.startsWith('local-')) return json({ ok: false, message: '这张作品来自仓库，不能在线删除' }, 400);
  try {
    const deleted = await deleteGalleryPhoto(id);
    return deleted ? json({ ok: true }, 200, 'no-store') : json({ ok: false, message: '作品不存在' }, 404);
  } catch (error) {
    console.error('[gallery] delete failed:', error);
    return json({ ok: false, message: '删除失败' }, 500);
  }
}