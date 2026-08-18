import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';

/** R2 中保存的相册条目；manifest 本身不暴露访问凭据。 */
export interface StoredGalleryPhoto {
  id: string;
  title: string;
  description?: string;
  date: string;
  tags: string[];
  width: number;
  height: number;
  size?: number;
  /** 原图内容的 SHA-256；旧 manifest 条目可能没有该字段。 */
  sha256?: string;
  originalKey: string;
  previewKey: string;
  thumbnailKey: string;
  uploadedAt: string;
}

export interface GalleryPhoto extends Omit<StoredGalleryPhoto, 'originalKey' | 'previewKey' | 'thumbnailKey' | 'uploadedAt'> {
  image: string;
  preview: string;
  thumbnail: string;
  source: 'r2' | 'local';
  uploadedAt?: string;
}

interface GalleryManifest {
  version: 1;
  updatedAt: string;
  photos: StoredGalleryPhoto[];
}

export interface UploadPlan {
  id: string;
  originalKey: string;
  previewKey: string;
  thumbnailKey: string;
  originalUrl: string;
  previewUrl: string;
  thumbnailUrl: string;
}

const MANIFEST_KEY = 'gallery/manifest.json';
const UPLOAD_TTL_SECONDS = 15 * 60;
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);

function env(name: string): string | undefined {
  return (
    (typeof process !== 'undefined' ? process.env?.[name] : undefined) ??
    (import.meta.env as Record<string, string | undefined>)[name]
  )?.trim() || undefined;
}

function config() {
  const accountId = env('R2_ACCOUNT_ID');
  const accessKeyId = env('R2_ACCESS_KEY_ID');
  const secretAccessKey = env('R2_SECRET_ACCESS_KEY');
  const bucket = env('R2_BUCKET');
  const publicUrl = env('R2_PUBLIC_URL')?.replace(/\/$/, '');
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicUrl) return null;
  return { accountId, accessKeyId, secretAccessKey, bucket, publicUrl };
}

export function isGalleryR2Configured(): boolean {
  return Boolean(config());
}

let client: S3Client | null = null;

function r2Client(): S3Client {
  const current = config();
  if (!current) throw new Error('R2 storage is not configured');
  if (!client) {
    client = new S3Client({
      region: 'auto',
      endpoint: `https://${current.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: current.accessKeyId,
        secretAccessKey: current.secretAccessKey,
      },
    });
  }
  return client;
}

function bucket(): string {
  const current = config();
  if (!current) throw new Error('R2 storage is not configured');
  return current.bucket;
}

function publicUrl(key: string): string {
  const current = config();
  if (!current) throw new Error('R2 storage is not configured');
  const encoded = key.split('/').map((part) => encodeURIComponent(part)).join('/');
  return `${current.publicUrl}/${encoded}`;
}

function extensionFor(type: string, fileName: string): string {
  const fromName = fileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (type === 'image/jpeg') return 'jpg';
  if (type === 'image/png') return 'png';
  if (type === 'image/webp') return 'webp';
  if (type === 'image/avif') return 'avif';
  return fromName || 'bin';
}

function isMissingObject(error: unknown): boolean {
  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return candidate?.name === 'NoSuchKey' || candidate?.$metadata?.httpStatusCode === 404;
}

function normalizeSha256(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new Error('图片指纹无效');
  return normalized;
}

let manifestCache: { value: GalleryManifest; expiresAt: number } | null = null;

/** 读取相册清单并在一次函数实例内短暂缓存，降低首页连续请求的 R2 读次数。 */
export async function readGalleryManifest(force = false): Promise<GalleryManifest> {
  if (!force && manifestCache && manifestCache.expiresAt > Date.now()) return manifestCache.value;

  try {
    const response = await r2Client().send(new GetObjectCommand({ Bucket: bucket(), Key: MANIFEST_KEY }));
    const text = await response.Body?.transformToString();
    const parsed = text ? JSON.parse(text) as Partial<GalleryManifest> : null;
    const value: GalleryManifest = {
      version: 1,
      updatedAt: parsed?.updatedAt ?? new Date(0).toISOString(),
      photos: Array.isArray(parsed?.photos) ? parsed.photos : [],
    };
    manifestCache = { value, expiresAt: Date.now() + 30_000 };
    return value;
  } catch (error) {
    if (isMissingObject(error)) {
      const value: GalleryManifest = { version: 1, updatedAt: new Date(0).toISOString(), photos: [] };
      manifestCache = { value, expiresAt: Date.now() + 30_000 };
      return value;
    }
    throw error;
  }
}

/** 覆盖写入 manifest；R2 只保存元数据，图片对象本身仍由 CDN 直接提供。 */
export async function writeGalleryManifest(photos: StoredGalleryPhoto[]): Promise<void> {
  const manifest: GalleryManifest = {
    version: 1,
    updatedAt: new Date().toISOString(),
    photos,
  };
  await r2Client().send(new PutObjectCommand({
    Bucket: bucket(),
    Key: MANIFEST_KEY,
    Body: JSON.stringify(manifest),
    ContentType: 'application/json; charset=utf-8',
    CacheControl: 'no-store',
  }));
  manifestCache = { value: manifest, expiresAt: Date.now() + 30_000 };
}

/** 根据原图文件名生成三个资源 key，并签发短时直传 URL。 */
export async function createGalleryUploadPlan(fileName: string, contentType: string, sha256: string): Promise<UploadPlan> {
  if (!ALLOWED_TYPES.has(contentType)) throw new Error('仅支持 JPG、PNG、WebP 或 AVIF 图片');
  const normalizedSha256 = normalizeSha256(sha256);
  const current = await readGalleryManifest(true);
  const duplicate = current.photos.find((photo) => photo.sha256?.toLowerCase() === normalizedSha256);
  if (duplicate) throw new Error(`图片已存在于远程馆藏：「${duplicate.title}」`);
  const id = randomUUID();
  const ext = extensionFor(contentType, fileName);
  const originalKey = `gallery/originals/${id}.${ext}`;
  const previewKey = `gallery/previews/${id}.webp`;
  const thumbnailKey = `gallery/thumbnails/${id}.webp`;
  const makeUrl = (key: string, type: string) => getSignedUrl(
    r2Client(),
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      ContentType: type,
      ...(key === originalKey ? { Metadata: { sha256: normalizedSha256 } } : {}),
      CacheControl: 'public, max-age=31536000, immutable',
    }),
    { expiresIn: UPLOAD_TTL_SECONDS },
  );
  const [originalUrl, previewUrl, thumbnailUrl] = await Promise.all([
    makeUrl(originalKey, contentType),
    makeUrl(previewKey, 'image/webp'),
    makeUrl(thumbnailKey, 'image/webp'),
  ]);
  return { id, originalKey, previewKey, thumbnailKey, originalUrl, previewUrl, thumbnailUrl };
}

/** 校验直传对象确实存在，并把客户端元数据写入相册清单。 */
export async function commitGalleryPhoto(input: {
  id: string;
  originalKey: string;
  previewKey: string;
  thumbnailKey: string;
  title: string;
  description?: string;
  date: string;
  tags: string[];
  width: number;
  height: number;
  size: number;
  sha256: string;
}): Promise<GalleryPhoto> {
  const idPattern = /^[0-9a-f-]{36}$/i;
  if (!idPattern.test(input.id)) throw new Error('图片标识无效');
  if (![input.width, input.height, input.size].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error('图片尺寸或文件大小无效');
  }
  if (input.size > MAX_UPLOAD_BYTES) throw new Error('单张图片不能超过 25 MB');
  const normalizedSha256 = normalizeSha256(input.sha256);
  if (!input.originalKey.startsWith(`gallery/originals/${input.id}.`)
    || input.previewKey !== `gallery/previews/${input.id}.webp`
    || input.thumbnailKey !== `gallery/thumbnails/${input.id}.webp`) {
    throw new Error('上传对象路径无效');
  }
  const keys = [input.originalKey, input.previewKey, input.thumbnailKey];
  const heads = await Promise.all(keys.map((Key) => r2Client().send(new HeadObjectCommand({ Bucket: bucket(), Key }))));
  const originalSize = Number(heads[0].ContentLength ?? 0);
  if (!originalSize || originalSize > MAX_UPLOAD_BYTES) throw new Error('原图不存在或超过 25 MB');
  if (heads[0].Metadata?.sha256?.toLowerCase() !== normalizedSha256) {
    throw new Error('图片内容校验失败，请重新选择后上传');
  }

  const current = await readGalleryManifest(true);
  const duplicate = current.photos.find((photo) => photo.sha256?.toLowerCase() === normalizedSha256);
  if (duplicate) {
    await r2Client().send(new DeleteObjectsCommand({
      Bucket: bucket(),
      Delete: { Objects: keys.map((Key) => ({ Key })) },
    }));
    throw new Error(`图片已存在于远程馆藏：「${duplicate.title}」`);
  }
  if (current.photos.some((photo) => photo.id === input.id)) throw new Error('这张图片已经登记过了');
  const photo: StoredGalleryPhoto = {
    id: input.id,
    title: input.title.trim().slice(0, 120) || '未命名作品',
    description: input.description?.trim().slice(0, 500) || undefined,
    date: /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : new Date().toISOString().slice(0, 10),
    tags: [...new Set(input.tags.map((tag) => tag.trim()).filter(Boolean))].slice(0, 12),
    width: Math.round(input.width),
    height: Math.round(input.height),
    size: originalSize,
    sha256: normalizedSha256,
    originalKey: input.originalKey,
    previewKey: input.previewKey,
    thumbnailKey: input.thumbnailKey,
    uploadedAt: new Date().toISOString(),
  };
  await writeGalleryManifest([photo, ...current.photos]);
  return toPublicGalleryPhoto(photo);
}

/** 删除远程相册条目及其三个派生对象。 */
export async function deleteGalleryPhoto(id: string): Promise<boolean> {
  const current = await readGalleryManifest(true);
  const photo = current.photos.find((item) => item.id === id);
  if (!photo) return false;
  await writeGalleryManifest(current.photos.filter((item) => item.id !== id));
  await r2Client().send(new DeleteObjectsCommand({
    Bucket: bucket(),
    Delete: { Objects: [photo.originalKey, photo.previewKey, photo.thumbnailKey].map((Key) => ({ Key })) },
  }));
  return true;
}

/** 将 manifest 内部 key 转成可下发给浏览器的公开地址。 */
export function toPublicGalleryPhoto(photo: StoredGalleryPhoto): GalleryPhoto {
  return {
    id: photo.id,
    title: photo.title,
    description: photo.description,
    date: photo.date,
    tags: photo.tags,
    width: photo.width,
    height: photo.height,
    size: photo.size,
    uploadedAt: photo.uploadedAt,
    image: publicUrl(photo.originalKey),
    preview: publicUrl(photo.previewKey),
    thumbnail: publicUrl(photo.thumbnailKey),
    source: 'r2',
  };
}

export const galleryLimits = { maxUploadBytes: MAX_UPLOAD_BYTES, allowedTypes: [...ALLOWED_TYPES] };
