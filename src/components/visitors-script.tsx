'use client';

import { useEffect } from 'react';

type VisitorRecord = {
  visitorKey: string;
  ip: string;
  path: string;
  visitedAt: string;
  firstToday: boolean;
};

type VisitorResponse = {
  ok?: boolean;
  totalVisitors?: number;
  totalVisits?: number;
  todayVisits?: number;
  todayUniqueVisitors?: number;
  siteStartedAt?: string;
  uptimeSeconds?: number;
  recent?: VisitorRecord[];
  store?: { effective?: 'redis' | 'memory' };
  message?: string;
};

/** “来访雪笺”页面脚本：统计卡片 + 足迹列表 + 密码重置，与 Astro 版一致 */
export default function VisitorsScript() {
  useEffect(() => {
    const page = document.querySelector<HTMLElement>('[data-visitors-page]');
    if (!page) return;

    // 页面模板已固定包含全部挂载点，与 Astro 版一样直接断言非空
    const totalUnique = page.querySelector<HTMLElement>('#visitor-total-unique')!;
    const todayUnique = page.querySelector<HTMLElement>('#visitor-today-unique')!;
    const todayVisits = page.querySelector<HTMLElement>('#visitor-today-visits')!;
    const uptime = page.querySelector<HTMLElement>('#visitor-uptime')!;
    const started = page.querySelector<HTMLElement>('#visitor-started')!;
    const storage = page.querySelector<HTMLElement>('#visitor-storage')!;
    const status = page.querySelector<HTMLElement>('#visitor-status')!;
    const list = page.querySelector<HTMLElement>('#visitor-list')!;
    const refresh = page.querySelector<HTMLButtonElement>('#visitor-refresh')!;
    const resetToggle = page.querySelector<HTMLButtonElement>('#visitor-reset-toggle')!;
    const resetForm = page.querySelector<HTMLFormElement>('#visitor-reset-form')!;
    const resetPassword = page.querySelector<HTMLInputElement>('#visitor-reset-password')!;
    const resetCancel = page.querySelector<HTMLButtonElement>('#visitor-reset-cancel')!;
    const resetSubmit = resetForm.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    const resetMessage = page.querySelector<HTMLElement>('#visitor-reset-message')!;

    const controller = new AbortController();
    const { signal } = controller;

    const pathLabel = (path: string) => ({
      '/': '首页',
      '/music': '音乐室',
      '/gallery': '画廊',
      '/about': '关于',
    }[path] ?? path);

    const formatTime = (value: string) => {
      const date = new Date(value);
      if (Number.isNaN(date.valueOf())) return '时间未知';
      return new Intl.DateTimeFormat('zh-CN', {
        month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
      }).format(date);
    };

    const formatUptime = (seconds: number) => {
      const totalSeconds = Math.max(0, Math.floor(seconds));
      const days = Math.floor(totalSeconds / 86400);
      const hours = Math.floor((totalSeconds % 86400) / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      if (days) return `${days} 天 ${hours} 小时`;
      if (hours) return `${hours} 小时 ${minutes} 分钟`;
      return `${minutes} 分钟`;
    };

    function renderRecord(record: VisitorRecord) {
      const row = document.createElement('article');
      row.className = 'flex items-center justify-between gap-4 py-3';

      const main = document.createElement('div');
      main.className = 'min-w-0';
      const path = document.createElement('p');
      path.className = 'truncate text-sm font-medium text-slate-700 dark:text-slate-200';
      path.textContent = pathLabel(record.path);
      const detail = document.createElement('p');
      detail.className = 'mt-1 truncate text-xs text-slate-400 dark:text-slate-400';
      detail.textContent = `${record.ip} · ${record.path} · 匿名访客 ${record.visitorKey}`;
      main.append(path, detail);

      const aside = document.createElement('div');
      aside.className = 'flex shrink-0 items-center gap-2';
      if (record.firstToday) {
        const badge = document.createElement('span');
        badge.className = 'rounded-full bg-lilac-400/15 px-2 py-1 text-[10px] text-violet-700 dark:text-lilac-200';
        badge.textContent = '今日首次';
        aside.append(badge);
      }
      const time = document.createElement('time');
      time.className = 'text-xs text-slate-400 dark:text-slate-400';
      time.dateTime = record.visitedAt;
      time.textContent = formatTime(record.visitedAt);
      aside.append(time);

      row.append(main, aside);
      return row;
    }

    async function load() {
      refresh.disabled = true;
      status.textContent = '载入中…';
      try {
        const response = await fetch('/api/visitors', { cache: 'no-store', signal });
        const body = await response.json() as VisitorResponse;
        if (!response.ok || !body.ok) throw new Error(body.message ?? '读取失败');
        totalUnique.textContent = String(body.totalVisitors ?? 0);
        todayUnique.textContent = String(body.todayUniqueVisitors ?? 0);
        todayVisits.textContent = String(body.todayVisits ?? 0);
        uptime.textContent = formatUptime(body.uptimeSeconds ?? 0);
        started.textContent = body.siteStartedAt ? `自 ${formatTime(body.siteStartedAt)}` : '上线时间未知';
        storage.textContent = body.store?.effective === 'redis' ? '已同步云端存储' : '当前为本地临时存储';
        const records = body.recent ?? [];
        list.replaceChildren(...(records.length
          ? records.map(renderRecord)
          : [Object.assign(document.createElement('p'), {
            className: 'py-5 text-sm text-slate-400 dark:text-slate-400',
            textContent: '还没有来访记录。',
          })]));
        status.textContent = `最近 ${records.length} 条`;
      } catch (error) {
        if (signal.aborted) return;
        status.textContent = '读取失败';
        storage.textContent = '存储状态未知';
        list.replaceChildren(Object.assign(document.createElement('p'), {
          className: 'py-5 text-sm text-rose-500 dark:text-rose-300',
          textContent: error instanceof Error ? error.message : '来访雪笺暂时无法打开',
        }));
      } finally {
        refresh.disabled = false;
      }
    }

    const showResetMessage = (text: string, tone: 'ok' | 'error') => {
      resetMessage.textContent = text;
      resetMessage.className = tone === 'ok'
        ? 'mt-3 text-sm text-emerald-600 dark:text-emerald-300'
        : 'mt-3 text-sm text-rose-500 dark:text-rose-300';
    };

    const hideResetMessage = () => {
      resetMessage.textContent = '';
      resetMessage.className = 'mt-3 hidden text-sm';
    };

    const toggleResetForm = (open: boolean) => {
      resetForm.classList.toggle('hidden', !open);
      resetToggle.setAttribute('aria-expanded', String(open));
      if (open) {
        resetPassword.focus();
      } else {
        resetForm.reset();
        hideResetMessage();
      }
    };

    async function submitReset(event: SubmitEvent) {
      event.preventDefault();
      const password = resetPassword.value;
      if (!password) return;

      resetSubmit.disabled = true;
      hideResetMessage();
      try {
        const response = await fetch('/api/visitors', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password }),
          signal,
        });
        const body = await response.json() as VisitorResponse;
        if (!response.ok || !body.ok) throw new Error(body.message ?? '清空失败');
        resetPassword.value = '';
        showResetMessage('足迹已清空，累计数据保留。', 'ok');
        await load();
      } catch (error) {
        if (signal.aborted) return;
        showResetMessage(error instanceof Error ? error.message : '网络异常，请稍后再试', 'error');
      } finally {
        resetSubmit.disabled = false;
      }
    }

    page.classList.add('is-visible');
    refresh.addEventListener('click', () => void load(), { signal });
    resetToggle.addEventListener('click', () => {
      toggleResetForm(resetForm.classList.contains('hidden'));
    }, { signal });
    resetCancel.addEventListener('click', () => toggleResetForm(false), { signal });
    resetForm.addEventListener('submit', (event) => void submitReset(event), { signal });
    void load();

    return () => controller.abort();
  }, []);

  return null;
}