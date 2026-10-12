// ---------------------------------------------------------------------------
// 上下文占用指示器（SVG 圆圈 + 快捷 compact）
// ---------------------------------------------------------------------------

import type { WebviewContext } from '../types';
import { formatTokens, escapeHtml } from '../utils';
import { openCustomSuggest, compactSuggestItems } from './slashCommands';

const RING_R = 15.5;
const RING_C = 2 * Math.PI * RING_R;

let ctx: WebviewContext;
let tip: HTMLElement;

export function initContextUsage(c: WebviewContext): void {
    ctx = c;
    // 结构化 tooltip（比纯文本 attr 更好排版）
    tip = document.createElement('div');
    tip.className = 'ctx-usage-tip';
    tip.setAttribute('role', 'tooltip');
    ctx.els.ctxUsage.appendChild(tip);

    ctx.els.ctxUsage.addEventListener('click', function () {
        const input = ctx.els.input;
        const prefix = '/compact ';
        input.value = prefix + input.value;
        const caretPos = prefix.length;
        input.selectionStart = input.selectionEnd = caretPos;
        input.focus();
        openCustomSuggest(compactSuggestItems(), 'slash', 0, prefix.length);
    });
}

export function updateContextUsage(stats: { contextPercent?: number | null; contextWindow?: number; autoCompact?: boolean } | null | undefined): void {
    if (!stats) { ctx.els.ctxUsage.classList.add('hidden'); return; }
    const pct = (stats.contextPercent === null || stats.contextPercent === undefined) ? null : stats.contextPercent;
    if (pct === null) { ctx.els.ctxUsage.classList.add('hidden'); return; }

    const clamped = Math.max(0, Math.min(100, pct));
    ctx.els.ctxUsage.classList.remove('hidden');
    ctx.els.ctxUsagePct.textContent = String(Math.round(clamped));

    // 更新 SVG 圆环
    const ring = ctx.els.ctxUsageRing;
    ring.style.strokeDasharray = RING_C.toFixed(2);
    ring.style.strokeDashoffset = (RING_C * (1 - clamped / 100)).toFixed(2);
    // 颜色：默认淡化，>90% 时显示红色
    ring.style.stroke = clamped > 90 ? 'var(--vscode-errorForeground, #f85149)' : '';

    renderTip(clamped, stats);
}

function tipRow(label: string, value: string): string {
    return '<div class="ctx-usage-tip-row"><span class="k">' + escapeHtml(label) + '</span>' +
        '<span class="v">' + escapeHtml(value) + '</span></div>';
}

function renderTip(pct: number, stats: { contextWindow?: number; autoCompact?: boolean }): void {
    const S = ctx.S;
    const rows: string[] = [tipRow(S.context, pct.toFixed(1) + '%')];
    if (stats.contextWindow) { rows.push(tipRow(S.ctxUsageWindow, formatTokens(stats.contextWindow))); }
    if (stats.autoCompact) { rows.push(tipRow(S.autoCompact, '✓')); }
    rows.push('<div class="ctx-usage-tip-hint">' + escapeHtml(S.ctxUsageHint) + '</div>');
    tip.innerHTML = rows.join('');
}

export function resetContextUsage(): void {
    ctx.els.ctxUsage.classList.add('hidden');
}
