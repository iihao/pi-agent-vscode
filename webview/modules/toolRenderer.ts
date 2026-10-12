// ---------------------------------------------------------------------------
// 工具调用 / bash 活动卡片
// ---------------------------------------------------------------------------

import type { WebviewContext } from '../types';
import { escapeHtml, capitalize, formatDuration, scrollToBottom, isNearBottom, bashId } from '../utils';
import { hideThinking, activityBegin, activityEnd } from './messageRenderer';

let ctx: WebviewContext;

export function initToolRenderer(c: WebviewContext): void {
    ctx = c;
}

export function addTool(tool: string, detail?: string, toolCallId?: string): void {
    ctx.els.welcome.style.display = 'none';
    activityBegin();
    hideThinking();
    const isBash = /bash|shell|powershell|cmd/i.test(tool);
    const el = document.createElement('div');
    el.className = 'activity' + (isBash ? ' bash' : '') + ' running' + (isBash ? '' : ' collapsed');
    const head = document.createElement('div');
    head.className = 'activity-head';
    head.innerHTML =
        '<span class="activity-caret">▾</span>' +
        '<span class="activity-name">' + escapeHtml(capitalize(tool)) + '</span>' +
        (detail ? '<span class="activity-detail">' + escapeHtml(detail) + '</span>' : '') +
        '<span class="activity-status"><span class="activity-spinner"></span></span>';
    const body = document.createElement('div');
    body.className = 'activity-body';
    head.addEventListener('click', function () { el.classList.toggle('collapsed'); });
    el.appendChild(head);
    el.appendChild(body);
    const stick = isNearBottom(ctx.els.chat);
    ctx.els.chat.appendChild(el);
    if (toolCallId) { ctx.runningTools[toolCallId] = { el: el, head: head, body: body }; }
    if (stick) { scrollToBottom(ctx.els.chat); }
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

export function endTool(toolCallId: string | undefined, data: { isError?: boolean; durationMs?: number; diff?: string; output?: string }): void {
    const stick = isNearBottom(ctx.els.chat);
    const t = toolCallId ? ctx.runningTools[toolCallId] : null;
    if (toolCallId) { delete ctx.runningTools[toolCallId]; }
    activityEnd();
    if (!t) { return; }
    t.el.classList.remove('running');
    t.el.classList.add(data.isError ? 'failed' : 'done');
    const status = t.head.querySelector('.activity-status');
    if (status) {
        status.textContent = (data.isError ? '✗' : '✓') + (data.durationMs ? '  ' + formatDuration(data.durationMs) : '');
    }
    if (data.diff) {
        renderDiff(t.body, data.diff);
        t.el.classList.remove('collapsed');
    } else if (data.output) {
        let pre = t.body.querySelector('.activity-output') as HTMLElement | null;
        if (!pre) { pre = document.createElement('pre'); pre.className = 'activity-output'; t.body.appendChild(pre); }
        pre.textContent = data.output;
        if (data.isError) { pre.classList.add('error'); }
    }
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

export function finishBash(m: { id: string; isError?: boolean; cancelled?: boolean; exitCode?: number; output?: string; truncated?: boolean }): void {
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
        const note = document.createElement('div');
        note.className = 'status-line notice';
        note.textContent = ctx.S.bashTruncated;
        body.appendChild(note);
    }
    if (stick) { scrollToBottom(ctx.els.chat); }
}
