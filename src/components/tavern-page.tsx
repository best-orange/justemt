'use client';

import { Chat, useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import type { UIMessage } from 'ai';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { FormEvent, KeyboardEvent } from 'react';

/** 聊天正文与角色状态都只存在浏览器本地，服务器不落存储 */
const HISTORY_KEY = 'justemt:tavern:history';
const CONTEXT_KEY = 'justemt:tavern:context';
const MAX_MESSAGES = 21;

type Role = 'user' | 'assistant';
type StoredMessage = { role: Role; content: string };

type TavernContext = {
  persona?: { name?: string; description?: string; notes?: string[] };
  state: {
    relationshipStage: 'stranger' | 'acquaintance' | 'trusted' | 'close';
    trust: number;
    affinity: number;
    mood: string;
    location?: string;
    scene?: string;
    turnCount: number;
  };
  memory: { summary: string; facts: string[]; importantEvents: string[] };
};

const DEFAULT_CONTEXT: TavernContext = {
  state: {
    relationshipStage: 'acquaintance',
    trust: 20,
    affinity: 10,
    mood: '平静、愿意倾听',
    location: 'justEMT 冰上美术馆',
    scene: '安静的日常对话',
    turnCount: 0,
  },
  memory: { summary: '', facts: [], importantEvents: [] },
};

const isMessage = (value: unknown): value is StoredMessage => {
  const item = value as Partial<StoredMessage> | null;
  return (item?.role === 'user' || item?.role === 'assistant') && typeof item.content === 'string';
};

const loadStored = (): StoredMessage[] => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isMessage).map(({ role, content }) => ({ role, content }));
  } catch {
    return [];
  }
};

const loadContext = (): TavernContext => {
  if (typeof window === 'undefined') return structuredClone(DEFAULT_CONTEXT);
  try {
    const raw = window.localStorage.getItem(CONTEXT_KEY);
    return raw ? JSON.parse(raw) as TavernContext : structuredClone(DEFAULT_CONTEXT);
  } catch {
    return structuredClone(DEFAULT_CONTEXT);
  }
};

const saveContext = (context: TavernContext) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CONTEXT_KEY, JSON.stringify(context));
  } catch {
    // 存不下就算了
  }
};

const textOf = (message: UIMessage): string =>
  message.parts
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('');

/**
 * error.message 可能是响应体原文（{"ok":false,"message":"…"}），
 * 拆出里面的提示再展示，别让访客看到原始 JSON。
 */
const friendlyError = (message: string) => {
  try {
    const parsed = JSON.parse(message) as { message?: unknown };
    if (typeof parsed.message === 'string' && parsed.message) return parsed.message.slice(0, 200);
  } catch {
    // 不是 JSON，原样展示
  }
  return message.slice(0, 200);
};

const saveStored = (messages: UIMessage[]) => {
  if (typeof window === 'undefined') return;
  try {
    const records: StoredMessage[] = [];
    for (const message of messages) {
      if (message.role !== 'user' && message.role !== 'assistant') continue;
      const content = textOf(message);
      if (!content) continue;
      records.push({ role: message.role, content });
    }
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(records.slice(-MAX_MESSAGES * 2)));
  } catch {
    // 存不下就算了
  }
};

interface TavernPageProps {
  configured: boolean;
  unlimited: boolean;
  limit: number;
}

export default function TavernPage({ configured, unlimited, limit }: TavernPageProps) {
  const contextRef = useRef<TavernContext>(loadContext());

  const initialMessages = useMemo(
    () => loadStored().map((message, index): UIMessage => ({
      id: `stored-${index}`,
      role: message.role,
      parts: [{ type: 'text', text: message.content }],
    })),
    [],
  );

  // 每轮请求都会带上当前的角色状态，由服务端把它与最近消息一起组成上下文
  const transport = useMemo(
    () => new DefaultChatTransport({
      api: '/api/tavern',
      prepareSendMessagesRequest: ({ messages }) => ({
        body: { messages, context: contextRef.current },
      }),
    }),
    [],
  );

  const interruptRef = useRef<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  // Chat 实例随挂载只建一次；onFinish 直接挂在实例上（构造期契约），
  // 回调内只引用 ref 与 setter，不依赖 useChat 对最新回调的转发。
  const chatRef = useRef<Chat<UIMessage> | null>(null);
  if (chatRef.current === null) {
    chatRef.current = new Chat<UIMessage>({
      messages: initialMessages,
      transport,
      onFinish: ({ message }) => {
        try {
          if (interruptRef.current) {
            const reason = interruptRef.current;
            interruptRef.current = null;
            if (message.role === 'assistant') {
              setNotes((previous) => ({ ...previous, [message.id]: reason }));
            }
          }
          // 成功回答与「停止但已出字」都算一轮：abort 同样会走到这里
          if (message.role === 'assistant' && textOf(message)) {
            contextRef.current.state.turnCount += 1;
            saveContext(contextRef.current);
          }
        } catch {
          // 状态记录失败不影响对话本身
        }
      },
      onError: (err) => {
        if (interruptRef.current === null) interruptRef.current = friendlyError(err.message);
      },
    });
  }

  const {
    messages,
    sendMessage,
    stop,
    status,
    error,
    clearError,
    setMessages,
  } = useChat({ chat: chatRef.current });

  const [input, setInput] = useState('');
  const [quota, setQuota] = useState<{ text: string; tone: 'ok' | 'warn' | 'idle' }>({
    text: configured ? '正在确认今日次数…' : '服务尚未连接',
    tone: 'idle',
  });
  const sectionRef = useRef<HTMLElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const busy = status === 'submitted' || status === 'streaming';

  const refreshQuota = useCallback(async () => {
    if (!configured) {
      setQuota({ text: '服务尚未连接', tone: 'idle' });
      return;
    }
    if (unlimited) {
      setQuota({ text: '已登录 · 不限次数', tone: 'ok' });
      return;
    }
    try {
      const response = await fetch('/api/chat', { cache: 'no-store' });
      const body = await response.json() as { ok?: boolean; remaining?: number; limit?: number };
      if (!response.ok || !body.ok) throw new Error('读取失败');
      const remaining = body.remaining ?? 0;
      setQuota({
        text: `今日剩余 ${remaining} / ${body.limit ?? 0} 次`,
        tone: remaining > 0 ? 'ok' : 'warn',
      });
    } catch {
      setQuota({ text: '次数状态未知', tone: 'idle' });
    }
  }, [configured, unlimited]);

  useEffect(() => {
    sectionRef.current?.classList.add('is-visible');
  }, []);

  useEffect(() => {
    void refreshQuota();
  }, [refreshQuota, status]);

  useEffect(() => {
    saveStored(messages);
  }, [messages]);

  useEffect(() => {
    const thread = threadRef.current;
    if (thread) thread.scrollTop = thread.scrollHeight;
  }, [messages, status]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  const submit = (raw: string) => {
    if (!configured || busy) return;
    const content = raw.trim().slice(0, 4000);
    if (!content) return;
    interruptRef.current = null;
    clearError();
    sendMessage({ text: content });
    setInput('');
  };

  const onFormSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submit(input);
  };

  const onInputKeydown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit(input);
  };

  const onClear = () => {
    if (busy) stop();
    interruptRef.current = null;
    setMessages([]);
    setNotes({});
    clearError();
    contextRef.current = structuredClone(DEFAULT_CONTEXT);
    saveContext(contextRef.current);
    try {
      window.localStorage.removeItem(HISTORY_KEY);
      window.localStorage.removeItem(CONTEXT_KEY);
    } catch {
      // 清不掉就算了
    }
    inputRef.current?.focus();
  };

  const displayMessages = messages.filter((message) => {
    if (message.role !== 'user' && message.role !== 'assistant') return false;
    const text = textOf(message);
    return text.length > 0 || Boolean(notes[message.id]);
  });
  const lastMessage = messages[messages.length - 1];
  const showHttpError = Boolean(error) && !busy && (lastMessage?.role === 'user' || messages.length === 0);

  return (
    <section data-tavern-page ref={sectionRef} className="chat reveal is-visible" data-configured={configured} data-unlimited={unlimited}>
      <header className="chat__intro">
        <div className="min-w-0">
          <p className="eyebrow text-lilac-500 dark:text-lilac-300">TAVERN ENGINE · V1</p>
          <h1 className="mt-4 font-display text-4xl font-black tracking-wide sm:text-5xl">
            <span className="text-frost">与 Emilia 对话</span>
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-8 text-slate-600 dark:text-slate-300">
            这一页使用新的角色引擎：Character、Persona、关系状态与长期记忆会在每轮对话前组成上下文。
            v1 仍把聊天和状态保存在浏览器本地，不把正文写入服务器。
          </p>
        </div>
        <div className="chat__intro-side">
          <span
            id="tavern-quota"
            role="status"
            className={`chat__chip${quota.tone === 'warn' ? ' is-warn' : ''}${quota.tone === 'idle' ? ' is-idle' : ''}`}
          >
            <span className="chat__chip-dot" aria-hidden="true"></span>
            {quota.text}
          </span>
          <button id="tavern-clear" type="button" onClick={onClear} className="chat__ghost-button">清空对话</button>
        </div>
      </header>

      <div className="chat__shell mt-10">
        <div
          id="tavern-thread"
          className="chat__thread"
          aria-live="polite"
          aria-label="对话记录"
          ref={threadRef}
          suppressHydrationWarning
        >
          <div id="tavern-empty" className={`chat__empty${displayMessages.length > 0 ? ' hidden' : ''}`}>
            <p className="font-display text-2xl font-bold text-frost">欢迎回来。</p>
            <p className="mt-3 text-sm leading-7 text-slate-500 dark:text-slate-400">
              这次她不只会看到最近几句话，还会收到当前关系、场景与长期记忆结构。
            </p>
            <div className="chat__suggestions">
              <button type="button" className="chat__suggestion" data-prompt="今天的美术馆好安静，你在做什么？" onClick={() => submit('今天的美术馆好安静，你在做什么？')}>和她聊聊现在</button>
              <button type="button" className="chat__suggestion" data-prompt="你还记得我们之前聊过的事情吗？" onClick={() => submit('你还记得我们之前聊过的事情吗？')}>试试连续性</button>
              <button type="button" className="chat__suggestion" data-prompt="我有一个 TypeScript 问题想问你。" onClick={() => submit('我有一个 TypeScript 问题想问你。')}>问技术问题</button>
            </div>
          </div>

          {displayMessages.map((message) => {
            const text = textOf(message);
            const note = notes[message.id] && message.role === 'assistant' ? notes[message.id] : undefined;
            const errorOnly = !text && Boolean(note);
            // 与旧版一致：中断提示只随本次渲染出现，写进历史的仍只有正文
            const bubbleText = errorOnly
              ? note
              : text + (note ? `\n\n（回答中断：${note}）` : '');

            return (
              <article key={message.id} className={`chat__row chat__row--${message.role}`}>
                <span className="chat__role">{message.role === 'user' ? '你' : 'Emilia'}</span>
                <div className={`chat__bubble${errorOnly ? ' chat__bubble--error' : ''}`} style={{ whiteSpace: 'pre-wrap' }}>
                  {bubbleText}
                </div>
              </article>
            );
          })}

          {showHttpError && (
            <article className="chat__row chat__row--assistant">
              <span className="chat__role">Emilia</span>
              <div className="chat__bubble chat__bubble--error" style={{ whiteSpace: 'pre-wrap' }}>
                {error?.message?.slice(0, 200) ?? '出了点问题'}
              </div>
            </article>
          )}
        </div>

        <form id="tavern-form" className="chat__composer" onSubmit={onFormSubmit}>
          <label className="sr-only" htmlFor="tavern-input">想说的话</label>
          <textarea
            id="tavern-input"
            rows={1}
            maxLength={4000}
            placeholder={configured ? '和 Emilia 说点什么…' : '对话服务尚未开启'}
            disabled={!configured || busy}
            className="chat__input"
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={onInputKeydown}
          ></textarea>
          <div className="chat__composer-actions">
            <p className="chat__hint">
              {unlimited ? '已登录，不限次数。' : <>公开对话每天合计 {limit} 次；登录后不限次。</>}
            </p>
            <button id="tavern-stop" type="button" className={`chat__ghost-button${busy ? '' : ' hidden'}`} onClick={() => stop()}>停止</button>
            <button id="tavern-send" type="submit" className="chat__send" disabled={!configured || busy}>发送</button>
          </div>
        </form>
      </div>
    </section>
  );
}