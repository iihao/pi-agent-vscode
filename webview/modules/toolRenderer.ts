// ---------------------------------------------------------------------------
// 工具调用 / bash 活动卡片
// ---------------------------------------------------------------------------

import type { WebviewContext } from '../types';
import { escapeHtml, capitalize, formatDuration, scrollToBottom, isNearBottom, bashId } from '../utils';
import { hideThinking, activityBegin, activityEnd } from './messageRenderer';

let ctx: WebviewContext;

/** 单个工具分组最多容纳的工具数；超出则收尾并开新组，避免一个组里堆太多 */
export const MAX_TOOLS_PER_GROUP = 5;

/** 当前正在累积的工具分组（连续的 tool 调用合并为一个可折叠组） */
let currentGroup: HTMLElement | null = null;
let currentGroupNames: string[] = [];

export function initToolRenderer(c: WebviewContext): void {
    ctx = c;
}

/** 取得（必要时创建）当前工具分组容器 */
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

/** 收尾当前工具分组：单个工具时拆掉外壳，多个工具时收尾并默认折叠。 */
export function endToolGroup(): void {
    const group = currentGroup;
    if (!group) { return; }
    currentGroup = null;
    currentGroupNames = [];
    const body = group.querySelector('.tool-group-body') as HTMLElement;
    const cards = Array.from(body.children) as HTMLElement[];
    group.classList.remove('running');
    if (cards.length <= 1) {
        // 单工具不值得包一层：拆回聊天流
        for (const card of cards) { group.parentElement?.insertBefore(card, group); }
        group.remove();
        return;
    }
    group.classList.add('done');
    const status = group.querySelector('.tool-group-status');
    if (status) { status.textContent = group.classList.contains('has-error') ? '✗' : '✓'; }
    // 默认保持展开：组内卡片本身仍是一行，用户可点组头手动折叠
}

/** 丢弃当前工具分组引用（清空 / 新回合） */
export function resetToolGroup(): void {
    currentGroup = null;
    currentGroupNames = [];
}

export function addTool(tool: string, detail?: string, toolCallId?: string, toolArgs?: string): void {
    ctx.els.welcome.style.display = 'none';
    activityBegin();
    hideThinking();
    // 分组上限：已达到上限就收尾旧组、开新组
    if (currentGroup && currentGroupNames.length >= MAX_TOOLS_PER_GROUP) {
        endToolGroup();
    }
    const group = ensureToolGroup();
    currentGroupNames.push(capitalize(tool));
    updateToolGroupHeader();
    const el = document.createElement('div');
    // 组内卡片一律默认折叠：只留一行，正文与环境更清爽
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
        // 完整参数（长命令、edit 的新旧文本等）：标题里只有摘要，全文放正文
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
 * pi 截断了输出：明确告知，并给出完整输出文件的入口，
 * 避免「内容被截断」变成静默丢失。
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
        // 已经结束过 / 从未渲染过：幂等返回，避免重复扣减运行计数
        if (!t) { return; }
        delete ctx.runningTools[toolCallId];
    }
    const stick = isNearBottom(ctx.els.chat);
    activityEnd();
    if (!t) { return; }
    t.el.classList.remove('running');
    t.el.classList.add(data.isError ? 'failed' : 'done');
    if (data.isError) {
        // 标记所在分组失败，收尾时不自动折叠，便于定位
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
        // 有 diff 就展开：默认折叠会把它藏起来，改动静不悄悄
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
 * 回合结束兜底：把仍停在「运行中」的卡片收尾，避免永久转圈。
 * 只改状态标记，卡片内容原样保留。
 */
export function settleTools(): void {
    const ids = Object.keys(ctx.runningTools);
    for (const id of ids) {
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
