// ---------------------------------------------------------------------------
// Tool-call / bash activity cards
// ---------------------------------------------------------------------------

import type { WebviewContext } from '../types';
import { escapeHtml, capitalize, formatDuration, scrollToBottom, isNearBottom, bashId } from '../utils';
import { hideThinking, activityBegin, activityEnd } from './messageRenderer';

let ctx: WebviewContext;

/** Max tools per group; beyond this the group is closed and a new one starts */
export const MAX_TOOLS_PER_GROUP = 5;

/** The tool group currently being accumulated (consecutive tool calls merge into one collapsible group) */
let currentGroup: HTMLElement | null = null;
let currentGroupNames: string[] = [];

export function initToolRenderer(c: WebviewContext): void {
    ctx = c;
}

/** Get (creating if needed) the current tool group container */
function ensureToolGroup(): HTMLElement {
    if (currentGroup) { return currentGroup; }
    const group = document.createElement('div');
    group.className = 'tool-group running';
    const head = document.createElement('div');
    head.className = 'tool-group-head';
    head.innerHTML =
        '<span class="chevron">▾</span>' +
        '<span class="tool-group-title"></span>' +
        '<span class="tool-group-count"></span>' +
        '<span class="tool-group-status"><span class="activity-spinner"></span></span>';
    head.addEventListener('click', function () { group.classList.toggle('collapsed'); });
    const body = document.createElement('div');
    body.className = 'tool-group-body';
    group.appendChild(head);
    group.appendChild(body);
    ctx.els.chat.appendChild(group);
    currentGroup = group;
    currentGroupNames = [];
    return group;
}

function updateToolGroupHeader(): void {
    if (!currentGroup) { return; }
    const title = currentGroup.querySelector('.tool-group-title') as HTMLElement | null;
    const count = currentGroup.querySelector('.tool-group-count') as HTMLElement | null;
    if (title) { title.textContent = currentGroupNames.join(', '); }
    if (count) { count.textContent = String(currentGroupNames.length); }
}

function toolGroupBody(): HTMLElement {
    return ensureToolGroup().querySelector('.tool-group-body') as HTMLElement;
}

/** Close the current tool group: unwrap a lone tool, otherwise finish it (stays expanded by default). */
export function endToolGroup(): void {
    const group = currentGroup;
    if (!group) { return; }
    currentGroup = null;
    currentGroupNames = [];
    const body = group.querySelector('.tool-group-body') as HTMLElement;
    const cards = Array.from(body.children) as HTMLElement[];
    group.classList.remove('running');
    if (cards.length <= 1) {
        // A lone tool isn't worth a wrapper: move it back into the chat stream
        for (const card of cards) { group.parentElement?.insertBefore(card, group); }
        group.remove();
        return;
    }
    group.classList.add('done');
    const status = group.querySelector('.tool-group-status');
    if (status) { status.textContent = group.classList.contains('has-error') ? '✗' : '✓'; }
    // Stay expanded by default (each card is one line); the user can fold it via the header
}

/** Drop the current tool group reference (clear / new turn) */
export function resetToolGroup(): void {
    currentGroup = null;
    currentGroupNames = [];
}

export function addTool(tool: string, detail?: string, toolCallId?: string, toolArgs?: string): void {
    ctx.els.welcome.style.display = 'none';
    activityBegin();
    hideThinking();
    // Group cap: close the old group and start a new one once reached
    if (currentGroup && currentGroupNames.length >= MAX_TOOLS_PER_GROUP) {
        endToolGroup();
    }
    const group = ensureToolGroup();
    currentGroupNames.push(capitalize(tool));
    updateToolGroupHeader();
    const el = document.createElement('div');
    // Cards inside a group are collapsed by default: one line each keeps the transcript clean
    el.className = 'activity running collapsed';
    const head = document.createElement('div');
    head.className = 'activity-head';
    head.innerHTML =
        '<span class="activity-caret">▾</span>' +
        '<span class="activity-name">' + escapeHtml(capitalize(tool)) + '</span>' +
        (detail ? '<span class="activity-detail">' + escapeHtml(detail) + '</span>' : '') +
        '<span class="activity-status"><span class="activity-spinner"></span></span>';
    const body = document.createElement('div');
    body.className = 'activity-body';
    if (toolArgs) {
        // Full arguments (long commands, edit old/new text, ...): the title is a summary, the full text goes in the body
        const argsPre = document.createElement('pre');
        argsPre.className = 'activity-args';
        argsPre.textContent = toolArgs;
        body.appendChild(argsPre);
    }
    head.addEventListener('click', function () { el.classList.toggle('collapsed'); });
    el.appendChild(head);
    el.appendChild(body);
    const stick = isNearBottom(ctx.els.chat);
    toolGroupBody().appendChild(el);
    if (toolCallId) { ctx.runningTools[toolCallId] = { el: el, head: head, body: body }; }
    if (stick) { scrollToBottom(ctx.els.chat); }
}

/**
 * pi truncated the output: say so and offer a way to open the full output file,
 * so "content was truncated" never becomes a silent loss.
 */
export function appendTruncationNote(body: HTMLElement, fullOutputPath?: string): void {
    const note = document.createElement('div');
    note.className = 'activity-truncated';
    const label = document.createElement('span');
    label.textContent = ctx.S.outputTruncated;
    note.appendChild(label);
    if (fullOutputPath) {
        const btn = document.createElement('button');
        btn.className = 'activity-open-output';
        btn.dataset.path = fullOutputPath;
        btn.textContent = ctx.S.openFullOutput;
        note.appendChild(btn);
    }
    body.appendChild(note);
}

export function setToolOutput(toolCallId: string | undefined, text: string): void {
    const t = toolCallId ? ctx.runningTools[toolCallId] : null;
    if (!t) { return; }
    const stick = isNearBottom(ctx.els.chat);
    let pre = t.body.querySelector('.activity-output') as HTMLElement | null;
    let preStick = true;
    if (pre) {
        preStick = (pre.scrollHeight - pre.scrollTop - pre.clientHeight) < 40;
    } else {
        pre = document.createElement('pre');
        pre.className = 'activity-output';
        t.body.appendChild(pre);
    }
    pre.textContent = text;
    if (preStick) { pre.scrollTop = pre.scrollHeight; }
    if (stick) { scrollToBottom(ctx.els.chat); }
}

export function renderDiff(body: HTMLElement, diff: string): void {
    const box = document.createElement('div');
    box.className = 'activity-diff';
    diff.split('\n').forEach(function (line) {
        const span = document.createElement('span');
        let cls = 'diff-line';
        if (/^(diff |index |--- |\+\+\+ )/.test(line)) { cls += ' diff-meta'; }
        else if (line.indexOf('@@') === 0) { cls += ' diff-hunk'; }
        else if (line.charAt(0) === '+') { cls += ' diff-add'; }
        else if (line.charAt(0) === '-') { cls += ' diff-del'; }
        span.className = cls;
        span.textContent = line || ' ';
        box.appendChild(span);
    });
    body.appendChild(box);
}

export function endTool(toolCallId: string | undefined, data: { isError?: boolean; durationMs?: number; diff?: string; output?: string; truncated?: boolean; fullOutputPath?: string }): void {
    const t = toolCallId ? ctx.runningTools[toolCallId] : null;
    if (toolCallId) {
        // Already ended / never rendered: return idempotently so the running count isn't decremented twice
        if (!t) { return; }
        delete ctx.runningTools[toolCallId];
    }
    const stick = isNearBottom(ctx.els.chat);
    activityEnd();
    if (!t) { return; }
    t.el.classList.remove('running');
    t.el.classList.add(data.isError ? 'failed' : 'done');
    if (data.isError) {
        // Mark the enclosing group as failed so it isn't auto-collapsed on close (easier to spot)
        const group = t.el.closest('.tool-group');
        if (group) { group.classList.add('has-error'); }
        t.el.classList.remove('collapsed');
    }
    const status = t.head.querySelector('.activity-status');
    if (status) {
        status.textContent = (data.isError ? '✗' : '✓') + (data.durationMs ? '  ' + formatDuration(data.durationMs) : '');
    }
    if (data.diff) {
        renderDiff(t.body, data.diff);
        // Expand when there's a diff: collapsing would hide it and make changes silent
        t.el.classList.remove('collapsed');
    } else if (data.output) {
        let pre = t.body.querySelector('.activity-output') as HTMLElement | null;
        if (!pre) { pre = document.createElement('pre'); pre.className = 'activity-output'; t.body.appendChild(pre); }
        pre.textContent = data.output;
        if (data.isError) { pre.classList.add('error'); }
    }
    if (data.truncated || data.fullOutputPath) { appendTruncationNote(t.body, data.fullOutputPath); }
    if (stick) { scrollToBottom(ctx.els.chat); }
}

export function addBashRunning(id: string, command: string): void {
    activityBegin();
    ctx.els.welcome.style.display = 'none';
    const el = document.createElement('div');
    el.className = 'activity bash running';
    el.dataset.bashId = id;
    const head = document.createElement('div');
    head.className = 'activity-head';
    head.innerHTML =
        '<span class="activity-caret">▾</span>' +
        '<span class="activity-name">$</span>' +
        '<span class="activity-detail">' + escapeHtml(command) + '</span>' +
        '<span class="activity-status"><span class="activity-spinner"></span></span>';
    const body = document.createElement('div');
    body.className = 'activity-body';
    head.addEventListener('click', function () { el.classList.toggle('collapsed'); });
    el.appendChild(head);
    el.appendChild(body);
    const stick = isNearBottom(ctx.els.chat);
    ctx.els.chat.appendChild(el);
    if (stick) { scrollToBottom(ctx.els.chat); }
}

/**
 * End-of-turn safety net: close any card still "running" so nothing spins
 * forever. Only the status marker changes; card content is kept as-is.
 */
export function settleTools(only?: ReadonlySet<string>): void {
    const ids = Object.keys(ctx.runningTools);
    for (const id of ids) {
        // A replay settles only the cards it rendered itself, so a tool that is
        // genuinely still running elsewhere is not closed prematurely
        if (only && !only.has(id)) { continue; }
        const t = ctx.runningTools[id];
        delete ctx.runningTools[id];
        t.el.classList.remove('running');
        t.el.classList.add('done');
        const status = t.head.querySelector('.activity-status');
        if (status) { status.textContent = '⏹'; }
        activityEnd();
    }
}

export function finishBash(m: { id: string; isError?: boolean; cancelled?: boolean; exitCode?: number; output?: string; truncated?: boolean; fullOutputPath?: string }): void {
    const stick = isNearBottom(ctx.els.chat);
    const el = ctx.els.chat.querySelector('.activity.bash[data-bash-id="' + m.id + '"]') as HTMLElement | null;
    activityEnd();
    if (!el) { return; }
    el.classList.remove('running');
    el.classList.add(m.isError ? 'failed' : 'done');
    const status = el.querySelector('.activity-status');
    if (status) {
        const mark = m.cancelled ? '⏹' : (m.isError ? '✗' : '✓');
        const code = (m.exitCode !== undefined && !m.cancelled) ? '  exit ' + m.exitCode : '';
        status.textContent = mark + code;
    }
    const body = el.querySelector('.activity-body') as HTMLElement;
    const pre = document.createElement('pre');
    pre.className = 'activity-output' + (m.isError ? ' error' : '');
    pre.textContent = m.output || '';
    body.appendChild(pre);
    if (m.truncated) {
        appendTruncationNote(body, m.fullOutputPath);
    }
    if (stick) { scrollToBottom(ctx.els.chat); }
}
