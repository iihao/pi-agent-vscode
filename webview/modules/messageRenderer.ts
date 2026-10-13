// ---------------------------------------------------------------------------
// 消息渲染：用户/助手气泡、思考折叠、流式渲染、消息操作、回合改动
// ---------------------------------------------------------------------------

import type { WebviewContext, MessageAttachment } from '../types';
import { escapeHtml, formatTime, scrollToBottom, isNearBottom, isElNearBottom } from '../utils';
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

const FILE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>';

/** 用户消息回显：本条携带的文件/选区附件 */
export function renderMessageAttachments(atts: MessageAttachment[]): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'message-attachments';
    atts.forEach(function (a) {
        const isSel = a.type === 'selection' && Boolean(a.lineRange);
        const label = isSel ? a.path + ':' + a.lineRange : a.path;
        const tag = document.createElement('span');
        tag.className = 'msg-attachment';
        tag.title = label;
        tag.innerHTML = FILE_ICON +
            '<span class="msg-attachment-path">' + escapeHtml(a.path) + '</span>' +
            (isSel ? '<span class="msg-attachment-range">:' + escapeHtml(String(a.lineRange)) + '</span>' : '');
        wrap.appendChild(tag);
    });
    return wrap;
}

export function addMessage(
    role: string,
    markdown: string,
    isError?: boolean,
    pending?: string,
    images?: MessageImage[],
    attachments?: MessageAttachment[],
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
    if (attachments && attachments.length) { body.appendChild(renderMessageAttachments(attachments)); }
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

function stopThinkingTimer(): void {
    if (thinkingTimer !== undefined) { clearInterval(thinkingTimer); thinkingTimer = undefined; }
}

/** 耗时格式化：不足 1 秒显示毫秒，之后显示秒/分 */
function formatElapsed(ms: number): string {
    if (ms < 1000) { return ms + 'ms'; }
    const totalSeconds = Math.floor(ms / 1000);
    if (totalSeconds < 60) { return totalSeconds + 's'; }
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return m + 'm ' + (s < 10 ? '0' + s : s) + 's';
}

function updateThinkingMeta(): void {
    if (!thinkingMeta) { return; }
    const tokens = Math.ceil(ctx.thinkingContent.length / 4);
    const elapsed = Math.max(0, Date.now() - thinkingStartedAt);
    // token 显示实际值（不做 k/M 简化）；耗时不足 1s 显示毫秒
    thinkingMeta.textContent = (tokens > 0 ? tokens + ' tok · ' : '') + formatElapsed(elapsed);
    // token 数变化时轻微跳动（节流，避免高频定时器导致动画过于频繁）
    if (tokens !== thinkingLastTokens) {
        thinkingLastTokens = tokens;
        const now = Date.now();
        if (tokens > 0 && now - thinkingLastBump > 800) {
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

export function showThinking(preserveContent = false): void {
    ctx.els.welcome.style.display = 'none';
    // preserveContent：补齐漏掉的思考内容时复用已有内容，不要清空
    if (!preserveContent) { ctx.thinkingContent = ''; }
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
        thinkingTimer = setInterval(updateThinkingMeta, 100);
    }
    updateThinkingMeta();
    updateThinkingPreview();
    refreshWorking();
}

export function appendThinking(text: string): void {
    if (!text) { return; }
    ctx.thinkingContent += text;
    // 兜底：思考行已被收起（hideThinking）时重新展开，避免补齐的内容不可见
    if (!ctx.thinkingLine) { showThinking(true); }
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
    if (!text) { return; }
    // 兜底：气泡不存在（漏了 assistantStart / webview 重建）时补开一个，
    // 保证任何一段正文都不会被静默丢掉。
    if (!ctx.currentBody) { startAssistantStream(); }
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

const REVERT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 14 4 9 9 4"></polyline><path d="M4 9h11a5 5 0 0 1 0 10h-1"></path></svg>';
const UNDO_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 14 20 9 15 4"></polyline><path d="M20 9H9a5 5 0 0 0 0 10h1"></path></svg>';

function turnFileRow(f: { path: string; status: 'created' | 'modified'; revertible: boolean; state?: string; diff?: string }): string {
    const S = ctx.S;
    const isAdd = f.status === 'created';
    const state = f.state || 'pending';
    const revertBtn = f.revertible
        ? '<button class="turn-file-revert" data-act="revert-file" title="' + escapeHtml(S.revertOne) + '" aria-label="' + escapeHtml(S.revertOne) + '">' + REVERT_ICON + '</button>'
        : '<span class="turn-file-locked" title="' + escapeHtml(S.revertLocked) + '">⊘</span>';
    const diffBtn = f.diff
        ? '<button class="turn-file-diff-toggle" data-act="toggle-diff" title="' + escapeHtml(S.showDiff) + '" aria-label="' + escapeHtml(S.showDiff) + '">±</button>'
        : '';
    const result = state === 'pending' ? ''
        : state === 'failed' ? '<span class="turn-result-fail">✗</span>'
        : state === 'skipped' ? '<span class="turn-result-skip">⊘</span>'
        : '<span class="turn-result-ok">✓</span>';
    const row = '<div class="turn-file-row" data-path="' + escapeHtml(f.path) + '" data-state="' + state + '">' +
        '<span class="turn-file-badge ' + (isAdd ? 'add' : 'mod') + '">' + (isAdd ? 'A' : 'M') + '</span>' +
        '<span class="turn-file-path" title="' + escapeHtml(f.path) + '">' + escapeHtml(f.path) + '</span>' +
        '<span class="turn-file-action">' + result + diffBtn + revertBtn + '</span>' +
        '</div>';
    // 内联 diff（点击 ± 展开），让“改了哪些文件”不只是文件名
    const diffBlock = f.diff
        ? '<div class="turn-file-diff hidden" data-path="' + escapeHtml(f.path) + '"><div class="turn-file-diff-inner">' + diffHtml(f.diff) + '</div></div>'
        : '';
    return row + diffBlock;
}

/** 把简易 diff 文本渲染成带颜色的行（+ 绿 / - 红） */
function diffHtml(diff: string): string {
    return diff.split('\n').map(function (line) {
        let cls = 'turn-diff-line';
        if (line.charAt(0) === '+') { cls += ' add'; }
        else if (line.charAt(0) === '-') { cls += ' del'; }
        return '<span class="' + cls + '">' + escapeHtml(line || ' ') + '</span>';
    }).join('');
}

export function renderTurnChanges(files: Array<{ path: string; status: 'created' | 'modified'; revertible: boolean; state?: string }>): void {
    const S = ctx.S;
    const existing = ctx.els.chat.querySelector('.turn-changes');
    if (existing) { existing.remove(); }
    if (!files || !files.length) { return; }
    const el = document.createElement('div');
    el.className = 'turn-changes';
    const rows = files.map(turnFileRow).join('');
    const anyRevertible = files.some((f) => f.revertible);
    const revertAll = anyRevertible
        ? '<button class="turn-changes-revert" data-act="revert-all">' + S.revert + '</button>'
        : '';
    el.innerHTML = '<div class="turn-changes-head">' +
        '<span class="turn-changes-title">' + S.changedFiles + ' (' + files.length + ')</span>' +
        '<button class="turn-changes-undo hidden" data-act="undo" title="' + escapeHtml(S.undoRevertHint) + '">' + UNDO_ICON + escapeHtml(S.undoRevert) + '</button>' +
        revertAll +
        '</div><div class="turn-changes-list">' + rows + '</div>';
    ctx.els.chat.appendChild(el);
    if (isNearBottom(ctx.els.chat)) { scrollToBottom(ctx.els.chat); }
}

/** 原地更新卡片的逐文件撤销结果：打勾弹出、更新头部与 Undo 按钮 */
export function updateTurnChangesResult(
    results: Array<{ path: string; result: 'reverted' | 'deleted' | 'failed' | 'skipped'; error?: string }>,
    files: Array<{ path: string; status: 'created' | 'modified'; revertible: boolean; state?: string }>,
    canUndo: boolean,
    autoHideMs: number,
): void {
    const S = ctx.S;
    const card = ctx.els.chat.querySelector('.turn-changes') as HTMLElement | null;
    if (!card) { return; }

    const byPath = new Map<string, typeof results[0]>();
    results.forEach((r) => byPath.set(r.path, r));
    results.forEach((r) => {
        const row = card.querySelector('.turn-file-row[data-path="' + CSS.escape(r.path) + '"]') as HTMLElement | null;
        if (!row) { return; }
        row.dataset.state = r.result;
        row.classList.add(r.result);
        if (r.error) { row.title = r.error; }
        const action = row.querySelector('.turn-file-action') as HTMLElement | null;
        if (!action) { return; }
        if (r.result === 'reverted' || r.result === 'deleted') {
            action.innerHTML = '<span class="turn-result-ok">✓</span>';
        } else if (r.result === 'skipped') {
            action.innerHTML = '<span class="turn-result-skip" title="' + escapeHtml(r.error || '') + '">⊘</span>';
        } else {
            action.innerHTML = '<span class="turn-result-fail" title="' + escapeHtml(r.error || '') + '">✗</span>';
        }
    });

    // 待撤销的文件（仍可单独撤销）保持不变
    const pendingCount = files.filter((f) => (f.state || 'pending') === 'pending').length;
    const successCount = results.filter((r) => r.result === 'reverted' || r.result === 'deleted').length;
    const failedCount = results.length - successCount;

    const headTitle = card.querySelector('.turn-changes-title') as HTMLElement;
    if (headTitle) {
        if (failedCount === 0) {
            // 仍有待撤销文件时显示总文件数（含已撤销的），全部完成时显示完成文案
            headTitle.textContent = pendingCount > 0
                ? S.changedFiles + ' (' + card.querySelectorAll('.turn-file-row').length + ')'
                : S.allRestored;
        } else {
            headTitle.textContent = S.someRestoreFailed.replace('{0}', String(successCount)).replace('{1}', String(results.length));
        }
    }

    // Undo 按钮
    const undoBtn = card.querySelector('.turn-changes-undo') as HTMLButtonElement | null;
    if (undoBtn) {
        undoBtn.classList.toggle('hidden', !canUndo);
        undoBtn.classList.remove('busy');
        undoBtn.disabled = false;
    }

    // 没有待撤销文件时隐藏「Revert all」（尤其是失败后无法重试的场景）
    const revertAllBtn = card.querySelector('.turn-changes-revert') as HTMLButtonElement | null;
    if (revertAllBtn && pendingCount === 0) {
        revertAllBtn.remove();
    } else if (revertAllBtn) {
        revertAllBtn.classList.remove('busy');
        revertAllBtn.disabled = false;
    }

    // 全部撤销完成 → 绿色完成态
    if (failedCount === 0 && pendingCount === 0) {
        card.classList.add('all-done');
        if (canUndo) {
            // 保留「再撤回」入口：卡片不自动消失，直到下一个回合 / 新会话
            // （给用户充分的安全感：随时能把这次撤销撤销回去）
            return;
        }
        setTimeout(function () {
            card.classList.add('fade-out');
            setTimeout(function () { card.remove(); }, 400);
        }, autoHideMs);
    }
}

/** 撤销完成后：淡出卡片并给出温暖反馈 */
export function finishUndoRevert(text: string): void {
    const card = ctx.els.chat.querySelector('.turn-changes') as HTMLElement | null;
    if (card) {
        card.classList.add('fade-out');
        setTimeout(function () { card.remove(); }, 400);
    }
    addNotice(text);
}

export function addNotice(text: string): void {
    // 通知不应清掉空状态：新会话/空会话切换后仍需保留引导与 logo
    const el = document.createElement('div');
    el.className = 'status-line notice';
    el.textContent = text;
    ctx.els.chat.appendChild(el);
    if (isNearBottom(ctx.els.chat)) { scrollToBottom(ctx.els.chat); }
}

/** 错误气泡上的可操作按钮（重试 / 切模型 / 查看日志） */
export function renderErrorActions(body: HTMLElement, actions?: Array<{ id: string; label: string }>): void {
    if (!body || !actions || !actions.length) { return; }
    const row = document.createElement('div');
    row.className = 'error-actions';
    actions.forEach(function (a) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'error-action';
        btn.dataset.action = a.id;
        btn.textContent = a.label;
        row.appendChild(btn);
    });
    body.appendChild(row);
}

export function setBusy(value: boolean): void {
    const S = ctx.S;
    const els = ctx.els;
    ctx.busy = value;
    els.input.placeholder = value ? S.inputBusyPlaceholder : S.inputPlaceholder;
    updateSendAffordances();
    if (value) {
        // 运行中立即给出“思考中”反馈（无正在流式的正文时）
        if (!ctx.currentBody) { showThinking(); }
    } else {
        hideThinking();
        // 安全网：如果 busy 变为 false 时助手流仍未关闭（扩展侧遗漏了 assistantEnd），
        // 用已缓冲的内容结束流式渲染，避免光标永久悬停。
        if (ctx.currentBody && ctx.currentBuffer.length > 0) {
            endAssistantStream();
        }
    }
    refreshWorking();
}

/**
 * 根据忙碌状态与发送模式刷新「发送 / 停止 / 排队·插话」控件。
 * 空闲：只显示发送；忙碌：额外显示停止按钮与「排队 / 插话」切换。
 */
export function updateSendAffordances(): void {
    const S = ctx.S;
    const els = ctx.els;
    const busy = ctx.busy;
    els.stopBtn.classList.toggle('hidden', !busy);
    els.modeBtn.classList.toggle('hidden', !busy);
    if (busy) {
        const queue = ctx.sendMode === 'queue';
        els.modeLabel.textContent = queue ? S.modeQueue : S.modeSteer;
        els.modeBtn.title = S.modeTitle;
        els.modeBtn.classList.toggle('steer', !queue);
        const label = queue ? S.queueTitle : S.steerTitle;
        els.sendBtn.title = label;
        els.sendBtn.setAttribute('aria-label', label);
    } else {
        els.sendBtn.title = S.sendTitle;
        els.sendBtn.setAttribute('aria-label', S.sendTitle);
    }
}
