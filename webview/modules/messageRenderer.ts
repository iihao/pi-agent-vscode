// ---------------------------------------------------------------------------
// Message rendering: user/assistant bubbles, thinking folding, streaming, message actions, turn changes
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

/** User-message echo: the file / selection attachments this message carried */
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

/** Elapsed formatting: milliseconds under 1s, then seconds / minutes */
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
    // Show the exact token count (no k/M shorthand); elapsed time in ms under 1s
    thinkingMeta.textContent = (tokens > 0 ? tokens + ' tok · ' : '') + formatElapsed(elapsed);
    // Subtle bump when the token count changes (throttled so the fast timer doesn't animate too often)
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
    // preserveContent: when backfilling missed thinking, reuse what we have instead of clearing
    if (!preserveContent) { ctx.thinkingContent = ''; }
    thinkingStartedAt = Date.now();
    thinkingLastTokens = -1;
    if (!ctx.thinkingLine) {
        // Collapsed while running by default: just the "thinking" animation + tokens/duration; click to expand
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
    // Safety net: re-open the thinking line if hideThinking already closed it, so backfilled content stays visible
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
    // No scrolling while collapsed (the running default); follow the newest content only when expanded
    const wrap = line.closest('.collapsible') as HTMLElement | null;
    if (wrap && !wrap.classList.contains('collapsed') && isElNearBottom(wrap)) {
        wrap.scrollTop = wrap.scrollHeight;
    }
}

export function hideThinking(): void {
    stopThinkingTimer();
    const line = ctx.thinkingLine;
    ctx.thinkingLine = null;
    thinkingMeta = null; // stop updating; the final values stay in the collapsed header
    thinkingPreview = null;
    if (line) {
        const wrap = line.closest('.collapsible') as HTMLElement | null;
        const content = ctx.thinkingContent;
        if (!content.trim()) {
            // No thinking content at all: remove the placeholder so no empty line remains
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
                wrap.classList.remove('thinking'); // stop the animation
                wrap.classList.add('collapsed');   // collapse by default once done; the user can expand
            }
        }
    }
    refreshWorking();
}

/** Drop the in-progress thinking indicator (called on clear / session switch to avoid leaking the timer) */
export function resetThinking(): void {
    stopThinkingTimer();
    thinkingMeta = null;
    ctx.thinkingLine = null;
    ctx.thinkingContent = '';
}

// ---- Ongoing-run indicator (fills the gaps between phases so it never looks stuck) ----

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

/** A tool/bash card entered the running state (takes one animation slot) */
export function activityBegin(): void {
    activityActive++;
    refreshWorking();
}

/** A tool/bash card finished running */
export function activityEnd(): void {
    if (activityActive > 0) { activityActive--; }
    refreshWorking();
}

/** Show the bottom dots only while busy with no thinking line and no running cards */
function refreshWorking(): void {
    const show = ctx.busy && activityActive === 0 && !ctx.thinkingLine;
    if (show) { showWorking(); } else { hideWorking(); }
}

export function resetWorking(): void {
    activityActive = 0;
    hideWorking();
}

// ---- Streaming render (time-driven typewriter reveal, independent of chunk timing) ----

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
    // About 3-6 chars per frame normally; catch up faster when further behind so long replies don't queue up
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
    // Safety net: if the bubble is missing (an assistantStart was dropped or the
    // webview was recreated), open one so no text is ever silently lost.
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

// ---- Message actions: edit/delete/copy/trim live in the inputHandling module ----

// ---- This turn's change review ----

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
    // Inline diff (click ± to expand), so "which files changed" is more than names
    const diffBlock = f.diff
        ? '<div class="turn-file-diff hidden" data-path="' + escapeHtml(f.path) + '"><div class="turn-file-diff-inner">' + diffHtml(f.diff) + '</div></div>'
        : '';
    return row + diffBlock;
}

/** Render simple diff text as colored lines (+ green / - red) */
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
    // Record the user's intent to follow first (most accurate before the card is added/removed)
    const stick = isNearBottom(ctx.els.chat);
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
    // The card grows as soon as it is added; checking after append would misread a multi-file card as "not at the bottom" and skip the scroll.
    ctx.els.chat.appendChild(el);
    if (!stick) { return; }
    const chat = ctx.els.chat;
    scrollToBottom(chat);
    // When the card is taller than the viewport, align to its top so reading starts at the first file
    if (el.getBoundingClientRect().height > chat.clientHeight) {
        chat.scrollTop += el.getBoundingClientRect().top - chat.getBoundingClientRect().top;
    }
}

/** Update the card's per-file revert results in place: check marks, header and Undo button */
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

    // Files still pending revert (each can still be reverted individually) stay unchanged
    const pendingCount = files.filter((f) => (f.state || 'pending') === 'pending').length;
    const successCount = results.filter((r) => r.result === 'reverted' || r.result === 'deleted').length;
    const failedCount = results.length - successCount;

    const headTitle = card.querySelector('.turn-changes-title') as HTMLElement;
    if (headTitle) {
        if (failedCount === 0) {
            // While files are still pending, show the total count (including reverted ones); show the done text when finished
            headTitle.textContent = pendingCount > 0
                ? S.changedFiles + ' (' + card.querySelectorAll('.turn-file-row').length + ')'
                : S.allRestored;
        } else {
            headTitle.textContent = S.someRestoreFailed.replace('{0}', String(successCount)).replace('{1}', String(results.length));
        }
    }

    // Undo button
    const undoBtn = card.querySelector('.turn-changes-undo') as HTMLButtonElement | null;
    if (undoBtn) {
        undoBtn.classList.toggle('hidden', !canUndo);
        undoBtn.classList.remove('busy');
        undoBtn.disabled = false;
    }

    // Hide "Revert all" when nothing is pending (especially after a failure that can't be retried)
    const revertAllBtn = card.querySelector('.turn-changes-revert') as HTMLButtonElement | null;
    if (revertAllBtn && pendingCount === 0) {
        revertAllBtn.remove();
    } else if (revertAllBtn) {
        revertAllBtn.classList.remove('busy');
        revertAllBtn.disabled = false;
    }

    // All reverted -> green done state
    if (failedCount === 0 && pendingCount === 0) {
        card.classList.add('all-done');
        if (canUndo) {
            // Keep the undo-of-revert entry: the card stays until the next turn /
            // new session (so the user always feels safe reverting again).
            return;
        }
        setTimeout(function () {
            card.classList.add('fade-out');
            setTimeout(function () { card.remove(); }, 400);
        }, autoHideMs);
    }
}

/** After a revert completes: fade the card out and give warm feedback */
export function finishUndoRevert(text: string): void {
    const card = ctx.els.chat.querySelector('.turn-changes') as HTMLElement | null;
    if (card) {
        card.classList.add('fade-out');
        setTimeout(function () { card.remove(); }, 400);
    }
    addNotice(text);
}

export function addNotice(text: string): void {
    // A notice must not clear the empty state: the guide and logo should remain after a new / empty session
    const el = document.createElement('div');
    el.className = 'status-line notice';
    el.textContent = text;
    const stick = isNearBottom(ctx.els.chat);
    ctx.els.chat.appendChild(el);
    if (stick) { scrollToBottom(ctx.els.chat); }
}

/** Action buttons on an error bubble (retry / switch model / show logs) */
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
        // Give immediate "thinking" feedback while running (when no text is streaming yet)
        if (!ctx.currentBody) { showThinking(); }
    } else {
        hideThinking();
        // Safety net: if the assistant stream is still open when busy turns false
        // (a missed assistantEnd from the host), close it with the buffered content
        // so the cursor never hangs forever.
        if (ctx.currentBody && ctx.currentBuffer.length > 0) {
            endAssistantStream();
        }
    }
    refreshWorking();
}

/**
 * Refresh the "send / stop / queue·steer" controls from the busy state and send
 * mode. Idle: send only. Busy: also show the stop button and the queue/steer toggle.
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
