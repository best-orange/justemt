/**
 * 跨实例共享存储。
 *
 * 配了 Upstash 就走 Redis（原子计数 + 全局缓存），没配则回落到进程内存 ——
 * 内存版在 Vercel 上是每实例独立的，只能算尽力而为，本地开发够用。
 *
 * 直接打 Upstash 的 REST API，不引 @upstash/redis，省一个依赖。
 */

/**
 * 运行时优先读 process.env：
 * import.meta.env 在构建时就被内联了，而 Upstash 集成注入的变量
 * 可能在构建之后才变化，读 process.env 才能拿到最新值。
 */
function env(name: string): string | undefined {
  return (
    (typeof process !== 'undefined' ? process.env?.[name] : undefined) ??
    (import.meta.env as Record<string, string | undefined>)[name]
  );
}

// Vercel 的 Upstash 集成会注入 UPSTASH_* ；早期 Vercel KV 用的是 KV_* ，两种都认
const restUrl = () => env('UPSTASH_REDIS_REST_URL') ?? env('KV_REST_API_URL');
const restToken = () => env('UPSTASH_REDIS_REST_TOKEN') ?? env('KV_REST_API_TOKEN');

export interface Store {
  readonly kind: 'redis' | 'memory';
  /** 原子自增并返回自增后的值；键不存在时顺带设上 TTL */
  incr(key: string, ttlSeconds: number): Promise<number>;
  decr(key: string): Promise<void>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
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
    // 键已存在时保留原有到期时间，避免每次自增都把 TTL 续上
    const existing = mem.get(key);
    const expiresAt =
      existing && Date.now() <= existing.expiresAt
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
  return body.map((r: any) => r?.result ?? null);
}

const redisStore: Store = {
  kind: 'redis',
  async incr(key, ttlSeconds) {
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
};

/* ---------------- 选择与降级 ---------------- */

let warned = false;
/** Redis 最近一次调用是否成功；失败后由下一次成功调用自动恢复 */
let healthy = true;

/**
 * Redis 不可用时不能让站点跟着挂，所以每个方法都包一层 try：
 * 失败就退回内存实现，只是精度下降。
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
          console.warn('[music] Redis 不可用，暂时回落到内存计数：', err);
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
  };
}

let cached: Store | null = null;

export function store(): Store {
  if (cached) return cached;
  cached = restUrl() && restToken() ? guarded(redisStore, memoryStore) : memoryStore;
  return cached;
}

/**
 * 供 /api/music?action=quota 展示。
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
