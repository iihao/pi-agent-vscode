// ---------------------------------------------------------------------------
// Message rendering: user/assistant bubbles, thinking folding, streaming, message actions, turn changes
// ---------------------------------------------------------------------------

import type { WebviewContext, MessageAttachment } from '../types';
import { escapeHtml, formatMessageTime, formatMessageDay, messageDay, scrollToBottom, isNearBottom, isElNearBottom } from '../utils';
import type MarkdownIt from 'markdown-it';
import { setupMarkdown, renderMarkdown, renderMermaid, setLiveRender } from '../markdown';
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

/** Calendar day of the last message rendered, so a day change can get a divider */
let lastMessageDay: string | undefined;

/** Forget the last rendered day (clear / new session) so the next message starts fresh */
export function resetDates(): void {
    lastMessageDay = undefined;
}

/**
 * Add a day divider when the calendar day changes.
 *
 * Only messages that carry pi's own timestamp (a replayed transcript) can trigger
 * one: a live turn's messages have none and simply join the current day, so the
 * divider never appears out of nowhere while streaming.
 */
function appendDateDivider(timestamp?: string): void {
    if (!timestamp) { return; }
    const day = messageDay(timestamp);
    if (day === lastMessageDay) { return; }
    lastMessageDay = day;
    const el = document.createElement('div');
    el.className = 'date-divider';
    el.textContent = formatMessageDay(timestamp);
    ctx.els.chat.appendChild(el);
}

// ---- Replay batching ----

/**
 * During a transcript replay every appended node used to trigger its own
 * scroll-to-bottom (forced layout), message count and rail rebuild (full
 * `.message` sweep each) — O(n²) over a long session's items. While a batch is
 * open those per-node refreshes are suppressed and done once at the end.
 */
let batchReplay = false;
export function isReplayBatch(): boolean { return batchReplay; }
export function beginReplayBatch(): void { batchReplay = true; }
export function endReplayBatch(): void {
    batchReplay = false;
    updateMessageCount();
    renderRail();
    scrollToBottom(ctx.els.chat);
}

export function addMessage(
    role: string,
    markdown: string,
    isError?: boolean,
    pending?: string,
    images?: MessageImage[],
    attachments?: MessageAttachment[],
    timestamp?: string,
): HTMLElement {
    const S = ctx.S;
    ctx.els.welcome.style.display = 'none';
    // A gap in the calendar gets a divider, so a replayed history doesn't look like
    // it all happened today
    appendDateDivider(timestamp);
    const el = document.createElement('div');
    el.className = 'message ' + (isError ? 'error' : role);
    if (pending) {
        el.dataset.pending = pending;
        el.dataset.pendingText = markdown || '';
    }
    const label = role === 'user' ? '' : 'Pi';
    const time = formatMessageTime(timestamp);
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
                    // A return arrow, not a pencil: the button reuses the text as a new
                    // message (a pencil promised an edit of what pi already has)
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 14 4 9 9 4"></polyline><path d="M4 9h10a6 6 0 0 1 6 6v2"></path></svg>' +
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
    if (!batchReplay) {
        scrollToBottom(ctx.els.chat);
        updateMessageCount();
        renderRail();
    }
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
    if (!batchReplay) { scrollToBottom(ctx.els.chat); }
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

/**
 * Render an already-finished thinking block (transcript replay). Same collapsed
 * presentation as a live one, but the live timer is skipped so a replayed block
 * is not stamped with a bogus duration.
 */
export function addHistoryThinking(text: string): void {
    if (!text.trim()) { return; }
    showThinking();
    const line = ctx.thinkingLine;
    stopThinkingTimer();
    appendThinking(text);
    hideThinking();
    const meta = (line?.closest('.collapsible') as HTMLElement | null)?.querySelector('.thinking-meta') as HTMLElement | null;
    if (meta) { meta.textContent = Math.ceil(text.length / 4) + ' tok'; }
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
let lastRevealAt = 0;

/**
 * Minimum interval between two typewriter re-renders. A reveal frame re-parses
 * the whole already-revealed prefix (markdown output grows as O(n²) in total),
 * and at 60fps the same message used to be re-rendered up to sixty times a
 * second. 50ms keeps the typing feel while bounding the work to ~20 renders/s.
 */
const REVEAL_RENDER_MS = 50;

function stopReveal(): void {
    if (revealRaf !== undefined) { cancelAnimationFrame(revealRaf); revealRaf = undefined; }
    lastRevealAt = 0;
}

/**
 * Whether the user has an active (non-collapsed) selection inside `el`.
 *
 * Rewriting an element's innerHTML destroys the DOM selection inside it. The
 * typewriter re-renders every ~50ms, so selecting text in a live answer — in
 * order to copy it — wiped the selection before Ctrl/Cmd+C could act on it
 * (nothing to copy), and with the focused text node gone Chromium dropped focus
 * back to the page, which in the webview lands on the composer. Same for the
 * final formatted render at the end of a stream.
 *
 * Deliberately defensive about the environment: the renderer is imported in
 * DOM-less unit tests too.
 */
export function hasSelectionInside(el: HTMLElement): boolean {
    const getSelection = (globalThis as { getSelection?: () => Selection | null }).getSelection;
    if (typeof getSelection !== 'function') { return false; }
    const sel = getSelection.call(globalThis);
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) { return false; }
    if (!String(sel).length) { return false; }
    try {
        return el.contains(sel.getRangeAt(0).commonAncestorContainer);
    } catch {
        return false;   // detached range (node replaced under us): treat as free
    }
}

function revealTick(): void {
    revealRaf = undefined;
    const body = ctx.currentBody;
    if (!body) { return; }
    const target = ctx.currentBuffer.length;
    if (revealedLen >= target) { return; }
    // The user is selecting this text: a re-render would throw the selection (and
    // the copy about to happen) away. Keep the frame pending and catch up as soon
    // as the selection is gone — the buffer keeps growing meanwhile.
    if (hasSelectionInside(body)) {
        revealRaf = requestAnimationFrame(revealTick);
        return;
    }
    const now = Date.now();
    if (lastRevealAt && now - lastRevealAt < REVEAL_RENDER_MS) {
        // too early for another full re-render; keep ticking, the elapsed time
        // (not chunk arrival) drives the pacing
        revealRaf = requestAnimationFrame(revealTick);
        return;
    }
    const elapsed = lastRevealAt ? now - lastRevealAt : REVEAL_RENDER_MS;
    lastRevealAt = now;
    const pending = target - revealedLen;
    // ~300 chars per second, with a proportional catch-up when far behind so
    // long replies don't queue up; scaled by the time actually elapsed
    const perTick = Math.max(15, Math.ceil(pending / 5));
    const step = perTick * Math.max(1, Math.round(elapsed / REVEAL_RENDER_MS));
    revealedLen = Math.min(target, revealedLen + step);
    const stick = isNearBottom(ctx.els.chat);
    // no highlight.js mid-stream; endAssistantStream renders the formatted pass
    setLiveRender(md, true);
    body.innerHTML = render(ctx.currentBuffer.slice(0, revealedLen));
    setLiveRender(md, false);
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
    const body = ctx.currentBody;
    if (!body) { void renderMermaid(ctx.els.chat); return; }
    const buffer = ctx.currentBuffer;
    ctx.currentBody = null;
    ctx.currentBuffer = '';
    revealedLen = 0;
    if (hasSelectionInside(body)) {
        // The final pass rewrites every text node (highlight.js), which would
        // destroy a selection the user is right now copying from. Do it the
        // moment the selection is released.
        deferFinalRender(body, buffer);
        return;
    }
    finalizeBody(body, buffer);
}

/** Render the finished, fully formatted message into its bubble */
function finalizeBody(body: HTMLElement, buffer: string): void {
    const stick = isNearBottom(ctx.els.chat);
    body.innerHTML = render(buffer);
    body.classList.remove('stream-cursor');
    if (stick) { scrollToBottom(ctx.els.chat); }
    void renderMermaid(ctx.els.chat);
}

/**
 * Finished messages whose formatted render is waiting for the user to finish
 * selecting. Flushed on `selectionchange` once nothing is selected inside them.
 */
const deferredFinals: Array<{ body: HTMLElement; buffer: string }> = [];
let listeningForSelection = false;

function deferFinalRender(body: HTMLElement, buffer: string): void {
    deferredFinals.push({ body, buffer });
    if (listeningForSelection) { return; }
    const doc = (globalThis as { document?: Document }).document;
    if (!doc || typeof doc.addEventListener !== 'function') {
        // No DOM (unit tests): nothing can be selected, render immediately
        flushDeferredFinals();
        return;
    }
    listeningForSelection = true;
    doc.addEventListener('selectionchange', flushDeferredFinals);
}

/** Render every finished message whose selection has been released */
export function flushDeferredFinals(): void {
    const doc = (globalThis as { document?: Document }).document;
    for (let i = deferredFinals.length - 1; i >= 0; i--) {
        const pending = deferredFinals[i];
        // Dropped by a transcript clear (New chat / session switch): nothing to do
        const attached = !doc || typeof doc.contains !== 'function' ? true : doc.contains(pending.body);
        if (!attached) { deferredFinals.splice(i, 1); continue; }
        if (hasSelectionInside(pending.body)) { continue; }
        deferredFinals.splice(i, 1);
        finalizeBody(pending.body, pending.buffer);
    }
    if (deferredFinals.length === 0 && listeningForSelection && doc) {
        listeningForSelection = false;
        doc.removeEventListener('selectionchange', flushDeferredFinals);
    }
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

const SEND_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg>';
const STOP_ICON = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="7" width="10" height="10" rx="2"></rect></svg>';

export function setBusy(value: boolean): void {
    const S = ctx.S;
    const els = ctx.els;
    ctx.busy = value;
    els.input.placeholder = value ? S.inputBusyPlaceholder : S.inputPlaceholder;
    // One button, two roles: send when idle, stop while a turn is running.
    els.sendBtn.innerHTML = value ? STOP_ICON : SEND_ICON;
    els.sendBtn.classList.toggle('stopping', value);
    const label = value ? S.stopTitle : S.sendTitle;
    els.sendBtn.title = label;
    els.sendBtn.setAttribute('aria-label', label);
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
 * Refresh the queue / steer toggle from the busy state and send mode.
 * While a turn is running the primary button is Stop, so this toggle only
 * decides how Enter sends (queue vs steer).
 */
export function updateSendAffordances(): void {
    const S = ctx.S;
    const els = ctx.els;
    els.modeBtn.classList.toggle('hidden', !ctx.busy);
    if (!ctx.busy) { return; }
    const queue = ctx.sendMode === 'queue';
    els.modeLabel.textContent = queue ? S.modeQueue : S.modeSteer;
    els.modeBtn.title = queue ? S.queueTitle : S.steerTitle;
    els.modeBtn.classList.toggle('steer', !queue);
}
