/**
 * OpenAI 兼容对话接口的服务端客户端。
 *
 * AI_API_KEY 只在服务端使用，绝不下发到浏览器 —— 它直接对应账单，
 * 一旦出现在前端源码里，任何人都能拿去刷额度。
 *
 * 只依赖 /chat/completions 的流式协议，所以 OpenAI、DeepSeek、Moonshot、
 * OpenRouter、各种自建网关都能用，区别只在 AI_BASE_URL 和 AI_MODEL。
 */

import { AUTH_COOKIE, verifyToken } from './auth';
import { store } from './store';

/** 单条消息长度上限，避免把超长文本整段送去上游 */
export const MAX_MESSAGE_LENGTH = 4000;
/** 一次请求最多带多少条消息（含本轮提问），超出时只保留最近的 */
export const MAX_MESSAGES = 21;

/**
 * 上游流式响应的整体超时。
 * 必须小于 astro.config.mjs 里的 maxDuration —— 否则平台先杀掉函数，
 * 这里的超时和退还配额的逻辑根本轮不到执行。
 */
const TIMEOUT_MS = 55_000;
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_DAILY_LIMIT = 30;
/** 匿名访客的每日总次数硬顶：配得再高也不会超过这个数 */
export const MAX_DAILY_LIMIT = 100;
/** 计数键留够两天再过期，日切靠键名本身完成 */
const QUOTA_TTL = 48 * 60 * 60;

const DEFAULT_SYSTEM_PROMPT = [
  '你是爱蜜莉雅（Emilia），《Re:从零开始的异世界生活》中的银发半精灵，现在栖息在一座名为 justEMT 的冰上美术馆里。',
  '说话温柔、真诚、带一点点天然的笨拙，会自称“我”，偶尔提到冰、雪、精灵或帕克。',
  '不过温柔归温柔，回答问题要认真且准确：技术问题给出可用的答案和代码，不确定的地方直接说不确定，不要编造。',
  '默认使用简体中文回答，用户用其他语言提问时跟随对方的语言。',
].join('\n');

/**
 * 运行时优先读 process.env：
 * import.meta.env 在构建时就被内联了，部署平台后来改的值只有 process.env 能拿到。
 */
function env(name: string): string | undefined {
  return (
    (typeof process !== 'undefined' ? process.env?.[name] : undefined) ??
    (import.meta.env as Record<string, string | undefined>)[name]
  );
}

const apiKey = (): string | undefined => env('AI_API_KEY')?.trim() || undefined;

/** 上游根地址，需要带上版本前缀（例如 https://api.deepseek.com/v1） */
const baseUrl = (): string => (env('AI_BASE_URL')?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '');

export const model = (): string => env('AI_MODEL')?.trim() || DEFAULT_MODEL;

const systemPrompt = (): string => env('AI_SYSTEM_PROMPT')?.trim() || DEFAULT_SYSTEM_PROMPT;

/**
 * 匿名访客共享的每日对话次数上限，可用 AI_DAILY_LIMIT 覆盖。
 * 这是全站合计的次数，不是每人的 —— 对话页公开，只能靠总量止损。
 */
export function dailyLimit(): number {
  const raw = env('AI_DAILY_LIMIT')?.trim();
  const value = raw ? Number(raw) : DEFAULT_DAILY_LIMIT;
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_DAILY_LIMIT;
  return Math.min(MAX_DAILY_LIMIT, Math.floor(value));
}

/** 完整的对话端点；AI_BASE_URL 已经指到 /chat/completions 时不再重复拼接 */
function endpoint(): string {
  const base = baseUrl();
  return base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
}

/** 没配 key 时对话页只展示提示，不发请求 */
export function isConfigured(): boolean {
  return Boolean(apiKey());
}

/**
 * 登录会话不受每日次数限制。
 * AUTH_SECRET 未配置时 verifyToken 会在生产环境抛错，而对话页是公开的，
 * 那种情况按“未登录”处理即可，不该让整个页面 500。
 */
export function hasUnlimitedAccess(token: string | undefined): boolean {
  try {
    return verifyToken(token);
  } catch {
    return false;
  }
}

export { AUTH_COOKIE };

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export class ChatApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/* ---------------- 每日配额 ---------------- */

/** 以北京时间计日，和站点其他统计保持一致 */
function quotaKey(): string {
  const shifted = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return `chat:quota:${shifted.toISOString().slice(0, 10)}`;
}

/**
 * 占用一次配额，返回 false 表示今日已达上限。
 * 先增后判，而不是先查后增 —— 后者在并发下会双双通过，超发配额。
 */
export async function consumeQuota(): Promise<boolean> {
  const key = quotaKey();
  const used = await store().incr(key, QUOTA_TTL);
  if (used > dailyLimit()) {
    await store().decr(key);
    return false;
  }
  return true;
}

/** 上游一个字都没产出时退还，免得网络抖动白白吃掉今天的额度 */
export async function refundQuota(): Promise<void> {
  await store().decr(quotaKey());
}

export async function chatUsage(): Promise<{ used: number; limit: number; remaining: number }> {
  const raw = await store().get(quotaKey());
  const limit = dailyLimit();
  // 上限被调小后，历史计数可能已经超过它，remaining 不能变成负数
  const used = Math.min(limit, Math.max(0, Number(raw ?? 0)));
  return { used, limit, remaining: Math.max(0, limit - used) };
}

/* ---------------- 请求体校验 ---------------- */

/**
 * 把浏览器传来的消息数组收敛成可信的最小结构：
 * 角色只认 user/assistant，逐条截断长度，只保留最近若干条，且必须以用户提问结尾。
 */
export function sanitizeMessages(input: unknown): ChatMessage[] {
  if (!Array.isArray(input)) return [];

  const messages: ChatMessage[] = [];
  for (const item of input) {
    const role = (item as { role?: unknown })?.role;
    const content = (item as { content?: unknown })?.content;
    if (role !== 'user' && role !== 'assistant') continue;
    if (typeof content !== 'string') continue;
    const text = content.trim().slice(0, MAX_MESSAGE_LENGTH);
    if (!text) continue;
    messages.push({ role, content: text });
  }

  const recent = messages.slice(-MAX_MESSAGES);
  // 助手消息结尾说明这轮没有提问，直接判为无效请求
  return recent.at(-1)?.role === 'user' ? recent : [];
}

/* ---------------- 流式调用 ---------------- */

/** 上游把业务错误放在 JSON 里，尽量取出可读的那一句 */
async function upstreamMessage(response: Response): Promise<string> {
  const raw = await response.text().catch(() => '');
  try {
    const body = JSON.parse(raw) as { error?: { message?: unknown }; message?: unknown };
    const message = (typeof body.error?.message === 'string' && body.error.message)
      || (typeof body.message === 'string' && body.message);
    if (message) return message.slice(0, 200);
  } catch {
    // 不是 JSON 就退回状态码描述
  }
  return `上游返回 ${response.status}`;
}

/**
 * 向上游发起流式对话，逐段产出文本增量。
 *
 * 这里只管调用，不碰配额 —— 是否计次取决于访客有没有登录，那是路由才知道的事。
 * 调用方负责把增量转发给浏览器；对话内容不落任何存储。
 */
export async function* streamChat(
  messages: ChatMessage[],
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const key = apiKey();
  if (!key) throw new ChatApiError('未配置 AI_API_KEY，对话功能尚未开启', 503);
  if (!messages.length) throw new ChatApiError('请求内容为空', 400);

  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(endpoint(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        model: model(),
        stream: true,
        messages: [{ role: 'system', content: systemPrompt() }, ...messages],
      }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch {
    if (signal?.aborted) return;
    throw new ChatApiError('AI 服务连接失败', 502);
  }

  if (!response.ok || !response.body) {
    const message = await upstreamMessage(response);
    throw new ChatApiError(message, response.status === 401 || response.status === 403 ? 503 : 502);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      // SSE 以行分隔；最后一行可能不完整，留在 buffer 里等下一块
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;

        let chunk: { choices?: { delta?: { content?: unknown } }[]; error?: { message?: unknown } };
        try {
          chunk = JSON.parse(payload);
        } catch {
          continue; // 半截或非标准的行直接跳过，不影响后续增量
        }

        if (chunk.error) {
          const message = typeof chunk.error.message === 'string' ? chunk.error.message : 'AI 服务返回错误';
          throw new ChatApiError(message.slice(0, 200), 502);
        }

        const delta = chunk.choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta) yield delta;
      }
    }
  } finally {
    await reader.cancel().catch(() => {
      // 浏览器提前断开时上游连接一并放弃，忽略关闭异常
    });
  }
}
