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

/** 只在本地留存对话，服务端不保存任何内容 */
const STORAGE_KEY = 'justemt:chat:history';
/** 与服务端 MAX_MESSAGES 对齐：更早的消息不会随请求发出 */
const MAX_MESSAGES = 21;

type Role = 'user' | 'assistant';
type StoredMessage = { role: Role; content: string };

const isMessage = (value: unknown): value is StoredMessage => {
  const item = value as Partial<StoredMessage> | null;
  return (item?.role === 'user' || item?.role === 'assistant') && typeof item.content === 'string';
};

const loadStored = (): StoredMessage[] => {
  if (typeof window === 'undefined') return [];
  try {
    // 历史内容可能被手改过，逐条校验后只留结构合法的
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isMessage).map(({ role, content }) => ({ role, content }));
  } catch {
    // localStorage 不可用（隐私模式）或内容损坏时从空对话开始
    return [];
  }
};

const saveStored = (messages: UIMessage[]) => {
  if (typeof window === 'undefined') return;
  try {
    const records: StoredMessage[] = [];
    for (const message of messages) {
      if (message.role !== 'user' && message.role !== 'assistant') continue;
      const content = textOf(message);
      // 出错未出字的回答不进历史，避免把报错当成 Emilia 说过的话带进下一轮
      if (!content) continue;
      records.push({ role: message.role, content });
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records.slice(-MAX_MESSAGES * 4)));
  } catch {
    // 存不下就算了，不影响当前这轮对话
  }
};

const textOf = (message: UIMessage): string =>
  message.parts
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('');

/**
 * 极轻量的 Markdown 渲染：只处理代码块、行内代码和段落。
 * 全程用 textContent 写入，不拼 innerHTML —— 模型输出等同于不可信内容，
 * 拼 HTML 就等于把 XSS 的入口交给上游。
 */
const renderMarkdown = (target: HTMLElement, text: string) => {
  target.replaceChildren();

  for (const [index, segment] of text.split(/```/).entries()) {
    // 奇数段落在两个 ``` 之间，按代码块处理
    if (index % 2 === 1) {
      const firstBreak = segment.indexOf('\n');
      const lang = firstBreak > 0 ? segment.slice(0, firstBreak).trim() : '';
      const code = firstBreak >= 0 ? segment.slice(firstBreak + 1) : segment;

      const block = document.createElement('div');
      block.className = 'chat__code';
      if (lang) {
        const label = document.createElement('span');
        label.className = 'chat__code-lang';
        label.textContent = lang;
        block.append(label);
      }
      const pre = document.createElement('pre');
      const codeEl = document.createElement('code');
      codeEl.textContent = code.replace(/\n$/, '');
      pre.append(codeEl);
      block.append(pre);
      target.append(block);
      continue;
    }

    for (const paragraph of segment.split(/\n{2,}/)) {
      if (!paragraph.trim()) continue;
      const p = document.createElement('p');
      // 行内代码同样只用 textContent 填充
      paragraph.split(/(`[^`\n]+`)/).forEach((part, partIndex) => {
        if (!part) return;
        if (partIndex % 2 === 1) {
          const code = document.createElement('code');
          code.textContent = part.slice(1, -1);
          p.append(code);
        } else {
          // 单个换行保留为软换行
          part.split('\n').forEach((line, lineIndex) => {
            if (lineIndex) p.append(document.createElement('br'));
            p.append(document.createTextNode(line));
          });
        }
      });
      target.append(p);
    }
  }
};

function MarkdownBubble({ text, note }: { text: string; note?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const target = ref.current;
    if (!target) return;
    renderMarkdown(target, text);
    if (note) {
      const p = document.createElement('p');
      p.className = 'chat__bubble-note';
      p.textContent = `（回答中断：${note}）`;
      target.append(p);
    }
  }, [text, note]);

  return <div ref={ref} />;
}

const friendlyError = (message: string) => {
  if (/fetch failed|failed to fetch|networkerror|网络/i.test(message)) return '网络中断了，稍后再试试？';
  if (/timed out|timeout/i.test(message)) return '她还没想好回答，稍后再问一次？';
  // 服务端拒绝时 error.message 是响应体原文（{"ok":false,"message":"…"}），拆出里面的提示
  try {
    const parsed = JSON.parse(message) as { message?: unknown };
    if (typeof parsed.message === 'string' && parsed.message) return parsed.message.slice(0, 200);
  } catch {
    // 不是 JSON，走通用截断
  }
  return message.slice(0, 200);
};

interface ChatPageProps {
  configured: boolean;
  unlimited: boolean;
  limit: number;
}

export default function ChatPage({ configured, unlimited, limit }: ChatPageProps) {
  const initialMessages = useMemo(
    () => loadStored().map((message, index): UIMessage => ({
      id: `stored-${index}`,
      role: message.role,
      parts: [{ type: 'text', text: message.content }],
    })),
    [],
  );

  // 流中报错但已出字时的中断原因：onError 先到、onFinish 后到，配对存储
  const interruptRef = useRef<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  // Chat 实例随挂载只建一次；onFinish 直接挂在实例上（构造期契约），
  // 回调内只引用 ref 与 setter，不依赖 useChat 对最新回调的转发。
  const chatRef = useRef<Chat<UIMessage> | null>(null);
  if (chatRef.current === null) {
    chatRef.current = new Chat<UIMessage>({
      messages: initialMessages,
      transport: new DefaultChatTransport({ api: '/api/chat' }),
      onFinish: ({ message }) => {
        if (interruptRef.current) {
          const reason = interruptRef.current;
          interruptRef.current = null;
          if (message.role === 'assistant') {
            setNotes((previous) => ({ ...previous, [message.id]: reason }));
          }
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
    tone: configured ? 'idle' : 'idle',
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

  // reveal 动画即时亮起
  useEffect(() => {
    sectionRef.current?.classList.add('is-visible');
  }, []);

  // 挂载与每轮结束后刷新余量
  useEffect(() => {
    void refreshQuota();
  }, [refreshQuota, status]);

  // 对话变化时写回本地历史
  useEffect(() => {
    saveStored(messages);
  }, [messages]);

  // 滚动到底部（新消息与流式增量都会触达）
  useEffect(() => {
    const thread = threadRef.current;
    if (thread) thread.scrollTop = thread.scrollHeight;
  }, [messages, status]);

  // 输入框自适应高度
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
    // Enter 发送、Shift + Enter 换行；输入法组合中的回车不触发发送
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
    try {
      window.localStorage.removeItem(STORAGE_KEY);
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
  // 非 2xx / 网络失败时不会追加 assistant 消息，error 状态单独成泡
  const showHttpError = Boolean(error) && !busy && (lastMessage?.role === 'user' || messages.length === 0);

  return (
    <section data-chat-page ref={sectionRef} className="chat reveal" data-configured={configured} data-unlimited={unlimited}>
      <header className="chat__intro">
        <div className="min-w-0">
          <p className="eyebrow text-lilac-500 dark:text-lilac-300">TALK WITH EMILIA</p>
          <h1 className="mt-4 font-display text-4xl font-black tracking-wide sm:text-5xl">
            <span className="text-frost">与 Emilia 对话</span>
          </h1>
          <p className="mt-4 max-w-xl text-base leading-8 text-slate-600 dark:text-slate-300">
            雪停下来的时候，她会认真听你说话。对话不会被保存在服务器上。
          </p>
        </div>
        <div className="chat__intro-side">
          <span
            id="chat-quota"
            role="status"
            className={`chat__chip${quota.tone === 'warn' ? ' is-warn' : ''}${quota.tone === 'idle' ? ' is-idle' : ''}`}
          >
            <span className="chat__chip-dot" aria-hidden="true"></span>
            {quota.text}
          </span>
          <button id="chat-clear" type="button" onClick={onClear} className="chat__ghost-button">清空对话</button>
        </div>
      </header>

      {!configured && (
        <p className="chat__notice mt-8 text-sm text-slate-500 dark:text-slate-300">
          对话服务还没有连接。配置 <code>AI_API_KEY</code> 与 <code>AI_BASE_URL</code> 之后，这里就能开始聊天了。
        </p>
      )}

      <div className="chat__shell mt-10">
        <div
          id="chat-thread"
          className="chat__thread"
          aria-live="polite"
          aria-label="对话记录"
          ref={threadRef}
          suppressHydrationWarning
        >
          <div id="chat-empty" className={`chat__empty${displayMessages.length > 0 ? ' hidden' : ''}`}>
            <p className="font-display text-2xl font-bold text-frost">今天想聊些什么呢？</p>
            <p className="mt-3 text-sm leading-7 text-slate-500 dark:text-slate-400">
              随便问都可以。技术问题、心里话，或者只是想有人陪着说说话。
            </p>
            <div className="chat__suggestions">
              <button type="button" className="chat__suggestion" data-prompt="给我讲讲你眼中的雪，好吗？" onClick={() => submit('给我讲讲你眼中的雪，好吗？')}>给我讲讲你眼中的雪</button>
              <button type="button" className="chat__suggestion" data-prompt="帮我用 TypeScript 写一个带超时的 fetch 封装" onClick={() => submit('帮我用 TypeScript 写一个带超时的 fetch 封装')}>写一个带超时的 fetch</button>
              <button type="button" className="chat__suggestion" data-prompt="今天有点累，说点让人安心的话吧。" onClick={() => submit('今天有点累，说点让人安心的话吧。')}>今天有点累</button>
            </div>
          </div>

          {displayMessages.map((message) => {
            const text = textOf(message);
            const note = notes[message.id] && message.role === 'assistant' ? notes[message.id] : undefined;
            const isLast = message === lastMessage;
            const streaming = busy && isLast && message.role === 'assistant';
            // 流中报错且一字未出：整泡按错误样式展示中断原因
            const errorOnly = !text && Boolean(note);

            return (
              <article key={message.id} className={`chat__row chat__row--${message.role}`}>
                <span className="chat__role">{message.role === 'user' ? '你' : 'Emilia'}</span>
                <div className={`chat__bubble${errorOnly ? ' chat__bubble--error' : ''}${streaming ? ' is-streaming' : ''}`}>
                  {errorOnly ? (
                    <p>{note}</p>
                  ) : (
                    <>
                      <MarkdownBubble text={text} note={note} />
                      {streaming && <span className="type-caret"></span>}
                    </>
                  )}
                </div>
              </article>
            );
          })}

          {showHttpError && (
            <article className="chat__row chat__row--assistant">
              <span className="chat__role">Emilia</span>
              <div className="chat__bubble chat__bubble--error">
                <p>{friendlyError(error?.message ?? '出了点问题')}</p>
              </div>
            </article>
          )}
        </div>

        <form id="chat-form" className="chat__composer" onSubmit={onFormSubmit}>
          <label className="sr-only" htmlFor="chat-input">想说的话</label>
          <textarea
            id="chat-input"
            name="message"
            rows={1}
            maxLength={4000}
            placeholder={configured ? '和 Emilia 说点什么…（Enter 发送，Shift + Enter 换行）' : '对话服务尚未开启'}
            disabled={!configured || busy}
            className="chat__input"
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={onInputKeydown}
          ></textarea>
          <div className="chat__composer-actions">
            <p id="chat-hint" className="chat__hint">
              {unlimited ? (
                '已登录，不限次数。'
              ) : (
                <>公开对话每天合计 {limit} 次，<a className="chat__hint-link" href={`/login?next=${encodeURIComponent('/chat')}`}>登录</a>后不限次。</>
              )}
            </p>
            <button id="chat-stop" type="button" className={`chat__ghost-button${busy ? '' : ' hidden'}`} onClick={() => stop()}>停止</button>
            <button id="chat-send" type="submit" className="chat__send" disabled={!configured || busy}>
              <span id="chat-send-label">{busy ? '回答中…' : '发送'}</span>
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}