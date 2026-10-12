// ---------------------------------------------------------------------------
// 纯工具函数（无状态依赖）
// ---------------------------------------------------------------------------

import type { SessionInfo, UiStrings } from './types';

export function escapeHtml(s: string): string {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

export function escapeAttr(s: string): string {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function formatTime(): string {
    const now = new Date();
    return now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
}

export function capitalize(s: string): string {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

export function formatDuration(ms?: number): string {
    if (ms === undefined || ms === null) { return ''; }
    return ms < 1000 ? ms + 'ms' : (ms / 1000).toFixed(1) + 's';
}

export function shortId(id: string, S: UiStrings): string {
    return id ? String(id).slice(0, 8) : (S as Record<string, string>).sessionTitle || '';
}

export function sessionDisplayName(s: SessionInfo): string {
    return s.name || s.preview || shortId(s.id, {} as UiStrings);
}

export function formatTokens(n: number): string {
    n = n || 0;
    if (n >= 1e9) { return (n / 1e9).toFixed(1) + 'B'; }
    if (n >= 1e6) { return (n / 1e6).toFixed(1) + 'M'; }
    if (n >= 1e3) { return Math.round(n / 1e3) + 'k'; }
    return String(n);
}

export function scrollToBottom(chat: HTMLElement): void {
    chat.scrollTop = chat.scrollHeight;
}

export function isNearBottom(chat: HTMLElement): boolean {
    return (chat.scrollHeight - chat.scrollTop - chat.clientHeight) < 80;
}

export function isElNearBottom(el: HTMLElement): boolean {
    return (el.scrollHeight - el.scrollTop - el.clientHeight) < 40;
}

/** 提取纯净文本：克隆后剔除代码行号，避免复制/导出/搜索混入行号 */
export function bashId(): string {
    return 'bash-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
}

export function getMessageText(body: HTMLElement | null): string {
    if (!body) { return ''; }
    const clone = body.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('.line-numbers').forEach(function (el) { el.remove(); });
    clone.style.position = 'absolute';
    clone.style.left = '-9999px';
    clone.style.top = '0';
    clone.style.whiteSpace = 'pre-wrap';
    document.body.appendChild(clone);
    const text = clone.innerText;
    clone.remove();
    return text;
}
