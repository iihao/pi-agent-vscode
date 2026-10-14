// ---------------------------------------------------------------------------
// Context-usage indicator (SVG ring + quick compact)
// ---------------------------------------------------------------------------

import type { WebviewContext } from '../types';
import { formatTokens, escapeHtml } from '../utils';

const RING_R = 15.5;
const RING_C = 2 * Math.PI * RING_R;

let ctx: WebviewContext;
let tip: HTMLElement;

export function initContextUsage(c: WebviewContext): void {
    ctx = c;
    // Structured tooltip (lays out better than a plain text attr)
    tip = document.createElement('div');
    tip.className = 'ctx-usage-tip';
    tip.setAttribute('role', 'tooltip');
    ctx.els.ctxUsage.appendChild(tip);

    ctx.els.ctxUsage.addEventListener('click', function () {
        // The tooltip already says "Click to compact", so compact directly:
        // no inserting a command into the composer and picking it from the suggest menu.
        ctx.vscode.postMessage({ type: 'compact' });
    });
}

export function updateContextUsage(stats: { contextPercent?: number | null; contextWindow?: number; autoCompact?: boolean } | null | undefined): void {
    if (!stats) { ctx.els.ctxUsage.classList.add('hidden'); return; }
    const pct = (stats.contextPercent === null || stats.contextPercent === undefined) ? null : stats.contextPercent;
    if (pct === null) { ctx.els.ctxUsage.classList.add('hidden'); return; }

    const clamped = Math.max(0, Math.min(100, pct));
    ctx.els.ctxUsage.classList.remove('hidden');
    ctx.els.ctxUsagePct.textContent = String(Math.round(clamped));

    // Update the SVG ring
    const ring = ctx.els.ctxUsageRing;
    ring.style.strokeDasharray = RING_C.toFixed(2);
    ring.style.strokeDashoffset = (RING_C * (1 - clamped / 100)).toFixed(2);
    // Color: muted by default, red above 90%
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
