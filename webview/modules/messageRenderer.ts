// ---------------------------------------------------------------------------
// 消息渲染：用户/助手气泡、思考折叠、流式渲染、消息操作、回合改动
// ---------------------------------------------------------------------------

import type { WebviewContext } from '../types';
import { escapeHtml, formatTime, formatTokens, scrollToBottom, isNearBottom, isElNearBottom } from '../utils';
import type MarkdownIt from 'markdown-it';
import { setupMarkdown, renderMarkdown, renderMermaid } from '../markdown';
import { updateMessageCount } from './panels';
import { renderRail } from './navigator';

export interface MessageImage {
    dataUrl?: string;
    data?: string;
    mimeType?: string;
}

let ctx: WebviewContext;
let md: MarkdownIt;
let thinkingMeta: HTMLElement | null = null;
let thinkingPreview: HTMLElement | null = null;
let thinkingStartedAt = 0;
let thinkingTimer: ReturnType<typeof setInterval> | undefined;
let thinkingLastTokens = -1;
let thinkingLastBump = 0;
let workingEl: HTMLElement | null = null;
let activityActive = 0;

export function initMessageRenderer(c: WebviewContext): void {
    ctx = c;
    md = setupMarkdown(c.S);
}

function render(markdown: string): string {
    return renderMarkdown(md, markdown);
}

export function renderMessageImages(images: MessageImage[]): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'message-images';
    images.forEach(function (img) {
        const src = img.dataUrl || (img.data && img.mimeType ? 'data:' + img.mimeType + ';base64,' + img.data : '');
        if (!src) { return; }
        const im = document.createElement('img');
        im.src = src;
        im.alt = '';
        im.loading = 'lazy';
        wrap.appendChild(im);
    });
    return wrap;
}

export function addMessage(
    role: string,
    markdown: string,
    isError?: boolean,
    pending?: string,
    images?: MessageImage[],
): HTMLElement {
    const S = ctx.S;
    ctx.els.welcome.style.display = 'none';
    const el = document.createElement('div');
    el.className = 'message ' + (isError ? 'error' : role);
    if (pending) {
        el.dataset.pending = pending;
        el.dataset.pendingText = markdown || '';
    }
    const label = role === 'user' ? '' : 'Pi';
    const time = formatTime();
    const badge = pending
        ? '<span class="pending-badge ' + pending + '">' + (pending === 'steering' ? S.steering : S.queued) + '</span>'
        : '';
    let actions = '';
    if (!isError) {
        actions = '<div class="message-actions">' +
            '<button class="msg-action-btn" data-action="copy" title="' + S.copyMsg + '">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>' +
            '</button>' +
            (role === 'user' ?
                '<button class="msg-action-btn" data-action="edit" title="' + S.editMsg + '">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"></path></svg>' +
                '</button>' : '') +
            '<button class="msg-action-btn" data-action="delete" title="' + S.deleteMsg + '">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>' +
            '</button>' +
            '</div>';
    }
    el.innerHTML = '<div class="msg-main"><div class="message-header">' + (label ? '<span class="role-label">' + label + '</span>' : '') + badge + '<span class="message-time">' + time + '</span>' + actions + '</div><div class="message-body"></div></div>';
    const body = el.querySelector('.message-body') as HTMLElement;
    if (images && images.length) { body.appendChild(renderMessageImages(images)); }
    body.insertAdjacentHTML('beforeend', render(markdown));
    ctx.els.chat.appendChild(el);
    scrollToBottom(ctx.els.chat);
    updateMessageCount();
    renderRail();
    return body;
}

export function createCollapsible(title: string, count: number, collapsed: boolean): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'collapsible' + (collapsed ? ' collapsed' : '');
    const header = document.createElement('div');
    header.className = 'collapsible-header';
    header.innerHTML = '<span class="chevron">▼</span><span class="title">' + escapeHtml(title) + '</span>' + (count > 0 ? '<span class="count">' + count + '</span>' : '');
    const content = document.createElement('div');
    content.className = 'collapsible-content';
    header.addEventListener('click', function () { wrap.classList.toggle('collapsed'); });
    wrap.appendChild(header);
    wrap.appendChild(content);
    ctx.els.chat.appendChild(wrap);
    scrollToBottom(ctx.els.chat);
    return content;
}

function formatElapsed(totalSeconds: number): string {
    if (totalSeconds < 60) { return totalSeconds + 's'; }
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return m + 'm ' + (s < 10 ? '0' + s : s) + 's';
}

function stopThinkingTimer(): void {
    if (thinkingTimer !== undefined) { clearInterval(thinkingTimer); thinkingTimer = undefined; }
}

function updateThinkingMeta(): void {
    if (!thinkingMeta) { return; }
    const tokens = Math.ceil(ctx.thinkingContent.length / 4);
    const seconds = Math.max(0, Math.floor((Date.now() - thinkingStartedAt) / 1000));
    thinkingMeta.textContent = (tokens > 0 ? formatTokens(tokens) + ' tok · ' : '') + formatElapsed(seconds);
    // token 数变化时轻微跳动（节流，避免频繁重排）
    if (tokens !== thinkingLastTokens) {
        thinkingLastTokens = tokens;
        const now = Date.now();
        if (tokens > 0 && now - thinkingLastBump > 140) {
            thinkingLastBump = now;
            thinkingMeta.classList.remove('bump');
            void thinkingMeta.offsetWidth;
            thinkingMeta.classList.add('bump');
        }
    }
}

function updateThinkingPreview(): void {
    if (!thinkingPreview) { return; }
    const text = ctx.thinkingContent.replace(/\s+/g, ' ').trim();
    thinkingPreview.textContent = text.length > 180 ? '…' + text.slice(-180) : text;
}

export function showThinking(): void {
    ctx.els.welcome.style.display = 'none';
    ctx.thinkingContent = '';
    thinkingStartedAt = Date.now();
    thinkingLastTokens = -1;
    if (!ctx.thinkingLine) {
        // 运行中默认折叠：只显示“思考中”动画 + token/时长，内容可手动展开
        ctx.thinkingLine = createCollapsible(ctx.S.thinking, 0, true);
        const wrap = ctx.thinkingLine.closest('.collapsible') as HTMLElement | null;
        if (wrap) {
            wrap.classList.add('flat', 'thinking');
            const header = wrap.querySelector('.collapsible-header');
            if (header) {
                thinkingMeta = document.createElement('span');
                thinkingMeta.className = 'thinking-meta';
                header.appendChild(thinkingMeta);
                const previewWrap = document.createElement('div');
                previewWrap.className = 'thinking-preview';
                thinkingPreview = previewWrap;
                header.insertAdjacentElement('afterend', previewWrap);
            }
        }
    }
    if (thinkingTimer === undefined) {
        thinkingTimer = setInterval(updateThinkingMeta, 1000);
    }
    updateThinkingMeta();
    updateThinkingPreview();
    refreshWorking();
}

export function appendThinking(text: string): void {
    ctx.thinkingContent += text;
    const line = ctx.thinkingLine;
    if (!line) { return; }
    let detail = line.querySelector('.thinking-detail') as HTMLElement | null;
    if (!detail) {
        detail = document.createElement('div');
        detail.className = 'thinking-detail';
        line.innerHTML = '';
        line.appendChild(detail);
    }
    detail.textContent = ctx.thinkingContent;
    updateThinkingMeta();
    updateThinkingPreview();
    // 折叠时（运行中默认）无需滚动；用户展开时才跟随最新内容
    const wrap = line.closest('.collapsible') as HTMLElement | null;
    if (wrap && !wrap.classList.contains('collapsed') && isElNearBottom(wrap)) {
        wrap.scrollTop = wrap.scrollHeight;
    }
}

export function hideThinking(): void {
    stopThinkingTimer();
    const line = ctx.thinkingLine;
    ctx.thinkingLine = null;
    thinkingMeta = null; // 停止更新；最终数值保留在折叠的表头里
    thinkingPreview = null;
    if (line) {
        const wrap = line.closest('.collapsible') as HTMLElement | null;
        const content = ctx.thinkingContent;
        if (!content.trim()) {
            // 没有任何思考内容：移除占位，避免留下空行
            if (wrap) { wrap.remove(); }
        } else {
            let detail = line.querySelector('.thinking-detail') as HTMLElement | null;
            if (!detail) {
                detail = document.createElement('div');
                detail.className = 'thinking-detail';
                line.innerHTML = '';
                line.appendChild(detail);
            }
            detail.textContent = content;
            if (wrap) {
                wrap.classList.remove('thinking'); // 停止动画
                wrap.classList.add('collapsed');   // 结束后默认折叠，用户可展开
            }
        }
    }
    refreshWorking();
}

/** 丢弃进行中的思考指示（清空/切换会话时调用，避免定时器泄漏） */
export function resetThinking(): void {
    stopThinkingTimer();
    thinkingMeta = null;
    ctx.thinkingLine = null;
    ctx.thinkingContent = '';
}

// ---- 持续运行指示（填补各阶段之间的空档，避免“卡顿”观感） ----

export function showWorking(): void {
    if (workingEl) { return; }
    workingEl = document.createElement('div');
    workingEl.className = 'working';
    workingEl.innerHTML = '<span class="working-dots"><i></i><i></i><i></i></span>';
    ctx.els.chat.appendChild(workingEl);
    scrollToBottom(ctx.els.chat);
}

export function hideWorking(): void {
    if (workingEl) { workingEl.remove(); workingEl = null; }
}

/** 工具/bash 卡片进入运行态（占用一个动画位） */
export function activityBegin(): void {
    activityActive++;
    refreshWorking();
}

/** 工具/bash 卡片运行结束 */
export function activityEnd(): void {
    if (activityActive > 0) { activityActive--; }
    refreshWorking();
}

/** 仅当“忙碌且无思考行、无运行中卡片”时，用底部圆点填补空档 */
function refreshWorking(): void {
    const show = ctx.busy && activityActive === 0 && !ctx.thinkingLine;
    if (show) { showWorking(); } else { hideWorking(); }
}

export function resetWorking(): void {
    activityActive = 0;
    hideWorking();
}

// ---- 流式渲染（时间驱动的打字机揭示，与分块到达时机无关） ----

let revealRaf: number | undefined;
let revealedLen = 0;

function stopReveal(): void {
    if (revealRaf !== undefined) { cancelAnimationFrame(revealRaf); revealRaf = undefined; }
}

function revealTick(): void {
    revealRaf = undefined;
    const body = ctx.currentBody;
    if (!body) { return; }
    const target = ctx.currentBuffer.length;
    if (revealedLen >= target) { return; }
    const pending = target - revealedLen;
    // 平时约 3–6 字/帧；落后越多追得越快，避免长回复积压
    const step = Math.max(3, Math.ceil(pending / 5));
    revealedLen = Math.min(target, revealedLen + step);
    const stick = isNearBottom(ctx.els.chat);
    body.innerHTML = render(ctx.currentBuffer.slice(0, revealedLen));
    if (stick) { scrollToBottom(ctx.els.chat); }
    if (revealedLen < target) { revealRaf = requestAnimationFrame(revealTick); }
}

function scheduleReveal(): void {
    if (revealRaf === undefined) { revealRaf = requestAnimationFrame(revealTick); }
}

export function startAssistantStream(): void {
    hideThinking();
    stopReveal();
    revealedLen = 0;
    ctx.currentBuffer = '';
    ctx.currentBody = addMessage('assistant', '');
    ctx.currentBody.classList.add('stream-cursor');
}

export function appendAssistantChunk(text: string): void {
    if (!ctx.currentBody) { return; }
    ctx.currentBuffer += text;
    scheduleReveal();
}

export function endAssistantStream(): void {
    stopReveal();
    if (ctx.currentBody) {
        const stick = isNearBottom(ctx.els.chat);
        ctx.currentBody.innerHTML = render(ctx.currentBuffer);
        ctx.currentBody.classList.remove('stream-cursor');
        ctx.currentBody = null;
        ctx.currentBuffer = '';
        revealedLen = 0;
        if (stick) { scrollToBottom(ctx.els.chat); }
    }
    void renderMermaid(ctx.els.chat);
}

export function abortAssistantStream(): void {
    stopReveal();
    if (ctx.currentBody) {
        ctx.currentBody.classList.remove('stream-cursor');
        ctx.currentBody = null;
        ctx.currentBuffer = '';
        revealedLen = 0;
    }
}

// ---- 消息操作：编辑/删除/复制/裁剪在 inputHandling 模块 ----

// ---- 本回合改动审阅 ----

export function renderTurnChanges(files: Array<{ path: string; status: 'created' | 'modified' }>): void {
    const S = ctx.S;
    const existing = ctx.els.chat.querySelector('.turn-changes');
    if (existing) { existing.remove(); }
    if (!files || !files.length) { return; }
    const el = document.createElement('div');
    el.className = 'turn-changes';
    let rows = '';
    files.forEach(function (f) {
        const isAdd = f.status === 'created';
        rows += '<button class="turn-file" data-path="' + escapeHtml(f.path) + '" title="' + escapeHtml(f.path) + '">' +
            '<span class="turn-file-badge ' + (isAdd ? 'add' : 'mod') + '">' + (isAdd ? 'A' : 'M') + '</span>' +
            '<span class="turn-file-path">' + escapeHtml(f.path) + '</span></button>';
    });
    el.innerHTML = '<div class="turn-changes-head">' +
        '<span class="turn-changes-title">' + S.changedFiles + ' (' + files.length + ')</span>' +
        '<button class="turn-changes-revert" data-act="revert">' + S.revert + '</button>' +
        '</div><div class="turn-changes-list">' + rows + '</div>';
    ctx.els.chat.appendChild(el);
    scrollToBottom(ctx.els.chat);
}

export function addNotice(text: string): void {
    // 通知不应清掉空状态：新会话/空会话切换后仍需保留引导与 logo
    const el = document.createElement('div');
    el.className = 'status-line notice';
    el.textContent = text;
    ctx.els.chat.appendChild(el);
    if (isNearBottom(ctx.els.chat)) { scrollToBottom(ctx.els.chat); }
}

export function setBusy(value: boolean): void {
    const S = ctx.S;
    const els = ctx.els;
    ctx.busy = value;
    els.input.placeholder = value ? S.inputBusyPlaceholder : S.inputPlaceholder;
    if (value) {
        els.sendBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg>';
        els.sendBtn.classList.add('stopping');
        els.sendBtn.title = S.stopTitle;
        // 运行中立即给出“思考中”反馈（无正在流式的正文时）
        if (!ctx.currentBody) { showThinking(); }
    } else {
        els.sendBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg>';
        els.sendBtn.classList.remove('stopping');
        els.sendBtn.title = S.sendTitle;
        hideThinking();
    }
    refreshWorking();
}
