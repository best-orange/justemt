/**
 * OpenAI 兼容对话接口的服务端配置与配额。
 *
 * AI_API_KEY 只在服务端使用，绝不下发到浏览器 —— 它直接对应账单，
 * 一旦出现在前端源码里，任何人都能拿去刷额度。
 *
 * 上游调用本身交给 Vercel AI SDK（见 lib/chat/ai.ts）：
 * 只依赖 /chat/completions 的流式协议，所以 OpenAI、DeepSeek、Moonshot、
 * OpenRouter、各种自建网关都能用，区别只在 AI_BASE_URL 和 AI_MODEL。
 */

import { AUTH_COOKIE, CHAT_COOKIE, chatPasswordConfigured, verifyToken } from './auth';
import { env } from './env';
import { store } from './store';

/** 单条消息长度上限，避免把超长文本整段送去上游 */
export const MAX_MESSAGE_LENGTH = 4000;
/** 一次请求最多带多少条消息（含本轮提问），超出时只保留最近的 */
export const MAX_MESSAGES = 21;

/**
 * 上游流式响应的整体超时。
 * 必须小于 next.config.ts 里的 maxDuration —— 否则平台先杀掉函数，
 * 这里的超时和退还配额的逻辑根本轮不到执行。
 */
export const TIMEOUT_MS = 55_000;
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

const apiKey = (): string | undefined => env('AI_API_KEY')?.trim() || undefined;

/**
 * 上游根地址，需要带上版本前缀（例如 https://api.deepseek.com/v1）。
 * 老配置可能直接把 AI_BASE_URL 指到 /chat/completions，这里收敛成根地址，
 * 由 AI SDK 的 OpenAI 兼容 Provider 负责拼接。
 */
export const baseUrl = (): string =>
  (env('AI_BASE_URL')?.trim() || DEFAULT_BASE_URL)
    .replace(/\/+$/, '')
    .replace(/\/chat\/completions$/, '');

export const model = (): string => env('AI_MODEL')?.trim() || DEFAULT_MODEL;

export const systemPrompt = (): string => env('AI_SYSTEM_PROMPT')?.trim() || DEFAULT_SYSTEM_PROMPT;

/** 没配 key 时对话页只展示提示，不发请求 */
export function isConfigured(): boolean {
  return Boolean(apiKey());
}

/** AI SDK Provider 用的密钥；isConfigured 为 false 时绝不该被调用 */
export const apiKeyOrThrow = (): string => {
  const key = apiKey();
  if (!key) throw new Error('未配置 AI_API_KEY');
  return key;
};

/**
 * 登录会话不受每日次数限制。
 * 单独配置了 CHAT_PASSWORD 时只认对话自己的会话；没配时沿用博客会话。
 * AUTH_SECRET 未配置时 verifyToken 会在生产环境抛错，而对话页是公开的，
 * 那种情况按“未登录”处理即可，不该让整个页面 500。
 */
export function hasUnlimitedAccess(chatToken: string | undefined, blogToken: string | undefined): boolean {
  try {
    if (verifyToken(chatToken, 'chat')) return true;
    return !chatPasswordConfigured() && verifyToken(blogToken);
  } catch {
    return false;
  }
}

export { AUTH_COOKIE, CHAT_COOKIE };

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

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
 * 把浏览器传来的消息数组收敛成可信的最小结构。
 * 兼容两种形态：
 * - 旧版 {role, content: string}
 * - AI SDK v5+ 的 UI 消息：文本放在顶层 parts 数组（{type:'text',text} 段落）
 *
 * 角色只认 user/assistant，逐条截断长度，只保留最近若干条，且必须以用户提问结尾。
 */
export function sanitizeMessages(input: unknown): ChatMessage[] {
  if (!Array.isArray(input)) return [];

  const messages: ChatMessage[] = [];
  for (const item of input) {
    const entry = item as { role?: unknown; content?: unknown; parts?: unknown };
    if (entry.role !== 'user' && entry.role !== 'assistant') continue;
    const text = textFromContent(entry.parts ?? entry.content);
    if (!text) continue;
    messages.push({ role: entry.role, content: text });
  }

  const recent = messages.slice(-MAX_MESSAGES);
  // 助手消息结尾说明这轮没有提问，直接判为无效请求
  return recent.at(-1)?.role === 'user' ? recent : [];
}

function textFromContent(content: unknown): string | undefined {
  if (typeof content === 'string') {
    const text = content.trim().slice(0, MAX_MESSAGE_LENGTH);
    return text || undefined;
  }
  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        if (!part || typeof part !== 'object') return '';
        const candidate = part as Record<string, unknown>;
        return candidate.type === 'text' && typeof candidate.text === 'string' ? candidate.text : '';
      })
      .join('')
      .trim()
      .slice(0, MAX_MESSAGE_LENGTH);
    return text || undefined;
  }
  return undefined;
}

/* ---------------- 上游错误 → 用户可读 ---------------- */

/**
 * 把 AI SDK 抛出的错误收敛成一句能直接给访客看的话，
 * 优先取上游返回 JSON 里的报错原文（限长），其余退回通用提示。
 */
export function friendlyAiError(error: unknown): string {
  const candidate = error as { responseBody?: unknown; statusCode?: unknown; name?: string; message?: string };
  if (typeof candidate.responseBody === 'string' && candidate.responseBody) {
    try {
      const parsed = JSON.parse(candidate.responseBody) as { error?: { message?: unknown }; message?: unknown };
      const message =
        (typeof parsed.error?.message === 'string' && parsed.error.message)
        || (typeof parsed.message === 'string' && parsed.message);
      if (message) return message.slice(0, 200);
    } catch {
      // 不是 JSON 就继续往下走
    }
  }
  if (candidate.statusCode === 401 || candidate.statusCode === 403) {
    return '上游鉴权失败，请检查 AI_API_KEY';
  }
  if (typeof candidate.message === 'string' && candidate.message && !candidate.message.startsWith('AI_')) {
    return candidate.message.slice(0, 200);
  }
  return 'AI 服务暂时不可用';
}