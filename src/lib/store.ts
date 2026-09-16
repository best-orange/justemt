/**
 * 跨实例共享存储。
 *
 * 配了 Upstash 就走 Redis（原子计数 + 全局缓存），没配则回落到进程内存 ——
 * 内存版在 Vercel 上是每实例独立的，只能算尽力而为，本地开发够用。
 *
 * 直接打 Upstash 的 REST API，不引 @upstash/redis，省一个依赖。
 */

import { env } from './env';

// Vercel 的 Upstash 集成会注入 UPSTASH_* ；早期 Vercel KV 用的是 KV_* ，两种都认
const restUrl = () => env('UPSTASH_REDIS_REST_URL') ?? env('KV_REST_API_URL');
const restToken = () => env('UPSTASH_REDIS_REST_TOKEN') ?? env('KV_REST_API_TOKEN');

export interface Store {
  readonly kind: 'redis' | 'memory';
  /** 原子自增并返回自增后的值；传 ttlSeconds 时只在键首次创建时设置 TTL，不传则永久保存。 */
  incr(key: string, ttlSeconds?: number): Promise<number>;
  decr(key: string): Promise<void>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  /** 删除一个键；键不存在时也算成功。 */
  del(key: string): Promise<void>;
  /** 仅在键不存在时写入；传 ttlSeconds 时设置 TTL，不传则永久保存。 */
  setIfAbsent(key: string, value: string, ttlSeconds?: number): Promise<boolean>;
  /** 值仍与 expected 一致时才删除；用于释放带 token 的分布式锁。 */
  compareAndDelete(key: string, expected: string): Promise<boolean>;
  /** 在列表头部写入一项，并将列表裁剪到指定长度。 */
  listPrepend(key: string, value: string, maxItems: number): Promise<void>;
  /** 读取列表的一段内容。 */
  listRange(key: string, start: number, end: number): Promise<string[]>;
}

/* ---------------- 内存实现 ---------------- */

const mem = new Map<string, { value: string; expiresAt: number }>();

function memGet(key: string): string | null {
  const hit = mem.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    mem.delete(key);
    return null;
  }
  return hit.value;
}

const memoryStore: Store = {
  kind: 'memory',
  async incr(key, ttlSeconds) {
    const next = Number(memGet(key) ?? 0) + 1;
    const existing = mem.get(key);
    // 不传 TTL 代表调用方明确要求永久计数；若是从旧版本迁移来的有限 TTL 键，
    // 这里也会顺手转成永久，避免“累计”计数一年后归零。
    const expiresAt = ttlSeconds === undefined
      ? Number.POSITIVE_INFINITY
      : existing && Date.now() <= existing.expiresAt
        ? existing.expiresAt
        : Date.now() + ttlSeconds * 1000;
    mem.set(key, { value: String(next), expiresAt });
    return next;
  },
  async decr(key) {
    const cur = Number(memGet(key) ?? 0);
    const existing = mem.get(key);
    if (existing && cur > 0) mem.set(key, { ...existing, value: String(cur - 1) });
  },
  async get(key) {
    return memGet(key);
  },
  async set(key, value, ttlSeconds) {
    mem.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  },
  async del(key) {
    mem.delete(key);
  },
  async setIfAbsent(key, value, ttlSeconds) {
    const existingValue = memGet(key);
    if (existingValue !== null) {
      if (ttlSeconds === undefined) {
        const existing = mem.get(key);
        if (existing) mem.set(key, { ...existing, expiresAt: Number.POSITIVE_INFINITY });
      }
      return false;
    }
    mem.set(key, {
      value,
      expiresAt: ttlSeconds === undefined ? Number.POSITIVE_INFINITY : Date.now() + ttlSeconds * 1000,
    });
    return true;
  },
  async compareAndDelete(key, expected) {
    if (memGet(key) !== expected) return false;
    mem.delete(key);
    return true;
  },
  async listPrepend(key, value, maxItems) {
    const existing = memGet(key);
    let items: string[] = [];
    if (existing) {
      try {
        const parsed = JSON.parse(existing);
        if (Array.isArray(parsed)) items = parsed.filter((item): item is string => typeof item === 'string');
      } catch {
        // 列表内容损坏时从空列表恢复，避免影响访客记录接口。
      }
    }
    items.unshift(value);
    mem.set(key, {
      value: JSON.stringify(items.slice(0, Math.max(1, maxItems))),
      expiresAt: Number.POSITIVE_INFINITY,
    });
  },
  async listRange(key, start, end) {
    const existing = memGet(key);
    if (!existing) return [];
    try {
      const parsed = JSON.parse(existing);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .slice(start, end < 0 ? undefined : end + 1)
        .filter((item): item is string => typeof item === 'string');
    } catch {
      return [];
    }
  },
};

/* ---------------- Redis 实现 ---------------- */

const REDIS_TIMEOUT_MS = 3_000;

/** 打 Upstash 的 pipeline 接口，一次往返执行多条命令 */
async function pipeline(commands: (string | number)[][]): Promise<any[]> {
  const res = await fetch(`${restUrl()}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${restToken()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(commands),
    signal: AbortSignal.timeout(REDIS_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Upstash ${res.status}`);
  const body = await res.json();
  if (!Array.isArray(body)) throw new Error('Upstash 返回格式异常');
  // 单条命令失败时 Upstash 仍是 HTTP 200，错误藏在结果项里：
  // 必须上抛让 guarded() 回落到内存实现，而不是把错误当 null 静默放行（否则配额会悄悄失效）
  return body.map((r: any) => {
    if (r && typeof r === 'object' && r.error) {
      throw new Error(`Upstash 命令失败：${String(r.error).slice(0, 120)}`);
    }
    return r?.result ?? null;
  });
}

const redisStore: Store = {
  kind: 'redis',
  async incr(key, ttlSeconds) {
    if (ttlSeconds === undefined) {
      // PERSIST 负责把旧版本中残留 TTL 的累计计数原地迁移成永久键。
      const [n] = await pipeline([
        ['INCR', key],
        ['PERSIST', key],
      ]);
      return Number(n);
    }
    // INCR 是原子的；NX 让 TTL 只在键首次创建时设置，后续自增不会把过期时间续上
    const [n] = await pipeline([
      ['INCR', key],
      ['EXPIRE', key, ttlSeconds, 'NX'],
    ]);
    return Number(n);
  },
  async decr(key) {
    await pipeline([['DECR', key]]);
  },
  async get(key) {
    const [v] = await pipeline([['GET', key]]);
    return v == null ? null : String(v);
  },
  async set(key, value, ttlSeconds) {
    await pipeline([['SET', key, value, 'EX', ttlSeconds]]);
  },
  async del(key) {
    await pipeline([['DEL', key]]);
  },
  async setIfAbsent(key, value, ttlSeconds) {
    if (ttlSeconds === undefined) {
      const [result] = await pipeline([
        ['SET', key, value, 'NX'],
        ['PERSIST', key],
      ]);
      return result === 'OK';
    }
    const [result] = await pipeline([['SET', key, value, 'EX', ttlSeconds, 'NX']]);
    return result === 'OK';
  },
  async compareAndDelete(key, expected) {
    const script = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end";
    const [result] = await pipeline([['EVAL', script, 1, key, expected]]);
    return Number(result) === 1;
  },
  async listPrepend(key, value, maxItems) {
    await pipeline([
      ['LPUSH', key, value],
      ['LTRIM', key, 0, Math.max(0, maxItems - 1)],
    ]);
  },
  async listRange(key, start, end) {
    const [result] = await pipeline([['LRANGE', key, start, end]]);
    return Array.isArray(result) ? result.map((item) => String(item)) : [];
  },
};

/* ---------------- 选择与降级 ---------------- */

let warned = false;
/** Redis 最近一次调用是否成功；失败后由下一次成功调用自动恢复 */
let healthy = true;

/**
 * Redis 不可用时不能让站点跟着挂，所以每个方法都包一层 try：
 * 失败就退回内存实现，只是精度下降。
 *
 * 安全敏感调用（例如登录防爆破）会在更上层通过 storeStatus() 检测降级，
 * 并选择 fail closed；这里继续保持通用 Store 的高可用语义。
 */
function guarded(primary: Store, fallback: Store): Store {
  const wrap = <K extends keyof Omit<Store, 'kind'>>(name: K): Store[K] =>
    (async (...args: any[]) => {
      try {
        const out = await (primary[name] as any)(...args);
        healthy = true;
        return out;
      } catch (err) {
        healthy = false;
        if (!warned) {
          warned = true;
          console.warn('[store] Redis 不可用，暂时回落到内存存储：', err);
        }
        return await (fallback[name] as any)(...args);
      }
    }) as Store[K];

  return {
    kind: primary.kind,
    incr: wrap('incr'),
    decr: wrap('decr'),
    get: wrap('get'),
    set: wrap('set'),
    del: wrap('del'),
    setIfAbsent: wrap('setIfAbsent'),
    compareAndDelete: wrap('compareAndDelete'),
    listPrepend: wrap('listPrepend'),
    listRange: wrap('listRange'),
  };
}

let cached: Store | null = null;

export function store(): Store {
  if (cached) return cached;
  cached = restUrl() && restToken() ? guarded(redisStore, memoryStore) : memoryStore;
  return cached;
}

/**
 * 供诊断接口展示。
 * configured 是配置意图，effective 是此刻真正在用的 —— Redis 挂掉时两者会不一致，
 * 排查问题时这个区分很关键。
 */
export function storeStatus(): { configured: Store['kind']; effective: Store['kind'] } {
  const configured = store().kind;
  return {
    configured,
    effective: configured === 'redis' && !healthy ? 'memory' : configured,
  };
}
