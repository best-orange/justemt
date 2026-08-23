import { createHash, randomUUID } from 'node:crypto';
import { store, storeStatus } from './store';

/** 浏览器匿名标识的 Cookie 名称；IP 只保存脱敏后的展示值。 */
export const VISITOR_COOKIE = 'emt_visitor_id';
export const VISITOR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const RECENT_KEY = 'visitors:recent';
const TOTAL_KEY = 'visitors:total';
const TOTAL_VISITORS_KEY = 'visitors:unique:total';
const TOTAL_TTL = 10 * 365 * 24 * 60 * 60;
const DAY_TTL = 3 * 24 * 60 * 60;
const VISIT_DEDUPE_TTL = 5 * 60;
const RECENT_LIMIT = 100;
const DEFAULT_SITE_LAUNCHED_AT = '2026-08-19T21:24:14+08:00';
const VISITOR_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface VisitorRecord {
  visitorKey: string;
  ip: string;
  path: string;
  visitedAt: string;
  firstToday: boolean;
}

export interface VisitorStats {
  totalVisitors: number;
  totalVisits: number;
  todayVisits: number;
  todayUniqueVisitors: number;
  siteStartedAt: string;
  uptimeSeconds: number;
  recent: VisitorRecord[];
  store: ReturnType<typeof storeStatus>;
}

export function createVisitorId(): string {
  return randomUUID();
}

export function isValidVisitorId(value: string | undefined): value is string {
  return Boolean(value && VISITOR_ID_PATTERN.test(value));
}

export function isTrackablePath(path: string): boolean {
  return path.startsWith('/')
    && !path.startsWith('/api/')
    && !path.startsWith('/_astro/')
    && path !== '/login'
    && path !== '/visitors'
    && path !== '/gallery/manage'
    && !path.startsWith('/blog/');
}

/**
 * 仅保留 IP 前半部分，IPv4 形如 192.168.*.*，IPv6 保留前四段。
 * 脱敏后才会写入记录，服务端不会把完整 IP 放进访客列表。
 */
export function maskIp(address: string | undefined): string {
  const value = address?.trim().replace(/^\[|\]$/g, '').split('%')[0] ?? '';
  if (!value) return '未知 IP';

  const embeddedIpv4 = value.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)?.[1];
  if (embeddedIpv4) {
    const octets = embeddedIpv4.split('.');
    if (octets.every((octet) => Number(octet) >= 0 && Number(octet) <= 255)) {
      return `${value.slice(0, -embeddedIpv4.length)}${octets[0]}.${octets[1]}.*.*`;
    }
  }

  const sections = value.includes('::')
    ? (() => {
      const [left, right] = value.split('::');
      const leftSections = left ? left.split(':').filter(Boolean) : [];
      const rightSections = right ? right.split(':').filter(Boolean) : [];
      const missing = 8 - leftSections.length - rightSections.length;
      return missing > 0
        ? [...leftSections, ...Array.from({ length: missing }, () => '0'), ...rightSections]
        : [];
    })()
    : value.split(':');
  if (sections.length === 8 && sections.every((section) => /^[0-9a-f]{1,4}$/i.test(section))) {
    return `${sections.slice(0, 4).join(':')}:*:*:*:*`;
  }

  return '未知 IP';
}

/** 以北京时间为准切分“今天”，与站点其他统计保持一致。 */
function today(): string {
  const shifted = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function visitorKey(visitorId: string): string {
  return hash(`justemt:${visitorId}`).slice(0, 8).toUpperCase();
}

function pathKey(path: string): string {
  return hash(path).slice(0, 16);
}

function dayVisitsKey(day: string): string {
  return `visitors:day:${day}`;
}

function dayUniqueKey(day: string): string {
  return `visitors:unique:${day}`;
}

function daySeenKey(day: string, id: string): string {
  return `visitors:seen:${day}:${id}`;
}

function allSeenKey(id: string): string {
  return `visitors:seen:all:${id}`;
}

function dedupeKey(day: string, id: string, path: string): string {
  return `visitors:dedupe:${day}:${id}:${pathKey(path)}`;
}

function safePath(path: string): string {
  return path.startsWith('/') ? path.slice(0, 200) : `/${path.slice(0, 199)}`;
}

/**
 * 记录一次页面来访。
 * 同一匿名访客在同一路径 5 分钟内刷新不会重复写入，避免浏览器重试制造噪音。
 */
export async function recordVisit(input: { visitorId: string; path: string; ip?: string; visitedAt?: Date }): Promise<boolean> {
  const path = safePath(input.path);
  const day = today();
  const storage = store();
  const shouldRecord = await storage.setIfAbsent(
    dedupeKey(day, input.visitorId, path),
    '1',
    VISIT_DEDUPE_TTL,
  );
  if (!shouldRecord) return false;

  const [firstToday, firstEver] = await Promise.all([
    storage.setIfAbsent(daySeenKey(day, input.visitorId), '1', DAY_TTL),
    storage.setIfAbsent(allSeenKey(input.visitorId), '1', TOTAL_TTL),
  ]);
  const record: VisitorRecord = {
    visitorKey: visitorKey(input.visitorId),
    ip: maskIp(input.ip),
    path,
    visitedAt: (input.visitedAt ?? new Date()).toISOString(),
    firstToday,
  };

  await Promise.all([
    storage.incr(TOTAL_KEY, TOTAL_TTL),
    firstEver ? storage.incr(TOTAL_VISITORS_KEY, TOTAL_TTL) : Promise.resolve(),
    storage.incr(dayVisitsKey(day), DAY_TTL),
    firstToday ? storage.incr(dayUniqueKey(day), DAY_TTL) : Promise.resolve(),
    storage.listPrepend(RECENT_KEY, JSON.stringify(record), RECENT_LIMIT),
  ]);
  return true;
}

function numberFrom(raw: string | null): number {
  const value = Number(raw ?? 0);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function parseRecord(raw: string): VisitorRecord | null {
  try {
    const value = JSON.parse(raw) as Partial<VisitorRecord>;
    if (
      typeof value.visitorKey !== 'string'
      || typeof value.path !== 'string'
      || typeof value.visitedAt !== 'string'
      || typeof value.firstToday !== 'boolean'
    ) return null;
    return {
      visitorKey: value.visitorKey.slice(0, 8),
      ip: typeof value.ip === 'string' ? value.ip : '未知 IP',
      path: safePath(value.path),
      visitedAt: value.visitedAt,
      firstToday: value.firstToday,
    };
  } catch {
    return null;
  }
}

function env(name: string): string | undefined {
  return (
    (typeof process !== 'undefined' ? process.env?.[name] : undefined) ??
    (import.meta.env as Record<string, string | undefined>)[name]
  );
}

function siteRuntime(): { siteStartedAt: string; uptimeSeconds: number } {
  const configured = env('SITE_LAUNCHED_AT')?.trim() || DEFAULT_SITE_LAUNCHED_AT;
  const parsed = Date.parse(configured);
  const fallback = Date.parse(DEFAULT_SITE_LAUNCHED_AT);
  const started = Number.isFinite(parsed) && parsed <= Date.now() ? parsed : fallback;
  return {
    siteStartedAt: new Date(started).toISOString(),
    uptimeSeconds: Math.max(0, Math.floor((Date.now() - started) / 1000)),
  };
}

export async function visitorStats(): Promise<VisitorStats> {
  const day = today();
  const storage = store();
  const [totalVisitors, total, todayVisits, todayUniqueVisitors, rawRecent] = await Promise.all([
    storage.get(TOTAL_VISITORS_KEY),
    storage.get(TOTAL_KEY),
    storage.get(dayVisitsKey(day)),
    storage.get(dayUniqueKey(day)),
    storage.listRange(RECENT_KEY, 0, RECENT_LIMIT - 1),
  ]);

  return {
    totalVisitors: numberFrom(totalVisitors),
    totalVisits: numberFrom(total),
    todayVisits: numberFrom(todayVisits),
    todayUniqueVisitors: numberFrom(todayUniqueVisitors),
    ...siteRuntime(),
    recent: rawRecent.map(parseRecord).filter((record): record is VisitorRecord => record !== null),
    store: storeStatus(),
  };
}
