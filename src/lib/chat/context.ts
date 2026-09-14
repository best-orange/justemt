import type { ChatContext, ChatMemory, ChatState, UserPersona } from './types';

const MAX_SHORT = 200;
const MAX_LONG = 2000;
const MAX_LIST_ITEMS = 20;

export const DEFAULT_CHAT_STATE: ChatState = {
  relationshipStage: 'acquaintance',
  trust: 20,
  affinity: 10,
  mood: '平静、愿意倾听',
  location: 'justEMT 冰上美术馆',
  scene: '安静的日常对话',
  turnCount: 0,
};

export const EMPTY_CHAT_MEMORY: ChatMemory = {
  summary: '',
  facts: [],
  importantEvents: [],
};

export const DEFAULT_CHAT_CONTEXT: ChatContext = {
  state: DEFAULT_CHAT_STATE,
  memory: EMPTY_CHAT_MEMORY,
};

function text(value: unknown, max = MAX_SHORT): string | undefined {
  if (typeof value !== 'string') return undefined;
  const result = value.trim().slice(0, max);
  return result || undefined;
}

function list(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => text(item))
    .filter((item): item is string => Boolean(item))
    .slice(0, MAX_LIST_ITEMS);
}

function score(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function sanitizePersona(value: unknown): UserPersona | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const source = value as Record<string, unknown>;
  const persona: UserPersona = {
    name: text(source.name, 80),
    description: text(source.description, MAX_LONG),
    notes: list(source.notes),
  };
  return persona.name || persona.description || persona.notes?.length ? persona : undefined;
}

function sanitizeState(value: unknown): ChatState {
  if (!value || typeof value !== 'object') return { ...DEFAULT_CHAT_STATE };
  const source = value as Record<string, unknown>;
  const rawStage = source.relationshipStage;
  const relationshipStage = rawStage === 'stranger'
    || rawStage === 'acquaintance'
    || rawStage === 'trusted'
    || rawStage === 'close'
    ? rawStage
    : DEFAULT_CHAT_STATE.relationshipStage;

  return {
    relationshipStage,
    trust: score(source.trust, DEFAULT_CHAT_STATE.trust),
    affinity: score(source.affinity, DEFAULT_CHAT_STATE.affinity),
    mood: text(source.mood, 120) ?? DEFAULT_CHAT_STATE.mood,
    location: text(source.location, 160) ?? DEFAULT_CHAT_STATE.location,
    scene: text(source.scene, 240) ?? DEFAULT_CHAT_STATE.scene,
    turnCount: Math.max(0, Math.min(100000, Math.floor(Number(source.turnCount) || 0))),
  };
}

function sanitizeMemory(value: unknown): ChatMemory {
  if (!value || typeof value !== 'object') return { ...EMPTY_CHAT_MEMORY };
  const source = value as Record<string, unknown>;
  return {
    summary: text(source.summary, MAX_LONG) ?? '',
    facts: list(source.facts),
    importantEvents: list(source.importantEvents),
  };
}

/**
 * 浏览器传来的 persona/state/memory 都属于不可信输入，必须在服务端收敛长度和结构。
 * v1 不把这些内容写入服务器；它们只是本轮 Prompt 的结构化上下文。
 */
export function sanitizeChatContext(value: unknown): ChatContext {
  if (!value || typeof value !== 'object') return {
    state: { ...DEFAULT_CHAT_STATE },
    memory: { ...EMPTY_CHAT_MEMORY },
  };

  const source = value as Record<string, unknown>;
  return {
    persona: sanitizePersona(source.persona),
    state: sanitizeState(source.state),
    memory: sanitizeMemory(source.memory),
  };
}
