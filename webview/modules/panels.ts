// ---------------------------------------------------------------------------
// Panel rendering: model / thinking / permission / session / context chips / attach menu / status bar
// ---------------------------------------------------------------------------

import type { WebviewContext, PermissionOption, SetupStatus, SessionInfo } from '../types';
import { escapeHtml, escapeAttr, formatTokens, sessionDisplayName } from '../utils';
import { needsSetupAttention } from './setupStatus';
import { settleBoot } from './boot';

let ctx: WebviewContext;

export function initPanels(c: WebviewContext): void {
    ctx = c;
}

/** Last checklist markup, so an unchanged status doesn't repaint the block */
let renderedSetupHtml = '';

function permissionOptions(): PermissionOption[] {
    const S = ctx.S;
    return [
        { id: 'ask', label: S.permissionOptions.ask, desc: S.permissionDescs.ask },
        { id: 'autoConfirm', label: S.permissionOptions.autoConfirm, desc: S.permissionDescs.autoConfirm },
        { id: 'restricted', label: S.permissionOptions.restricted, desc: S.permissionDescs.restricted },
    ];
}

export function closePopovers(): void {
    const els = ctx.els;
    els.modelPanel.classList.add('hidden');
    els.thinkingPanel.classList.add('hidden');
    els.sessionPanel.classList.add('hidden');
    els.permPanel.classList.add('hidden');
    els.attachPanel.classList.add('hidden');
    els.outlinePanel.classList.add('hidden');
}

export function togglePopover(panel: HTMLElement): void {
    const willShow = panel.classList.contains('hidden');
    closePopovers();
    if (willShow) { panel.classList.remove('hidden'); }
}

export function renderModelPanel(): void {
    const els = ctx.els;
    const S = ctx.S;
    if (!ctx.modelsList.length) {
        els.modelLabel.textContent = S.notConnected;
        els.modelPanel.innerHTML = '<div class="popover-empty">' + S.noModels + '</div>';
        return;
    }
    if (ctx.currentModel) {
        els.modelLabel.textContent = ctx.currentModel.id || S.modelTitle;
        els.modelLabel.title = ctx.currentModel.provider + ' / ' + ctx.currentModel.id;
    }
    let html = '';
    ctx.modelsList.forEach(function (mo) {
        const active = ctx.currentModel && ctx.currentModel.provider === mo.provider && ctx.currentModel.id === mo.id;
        html += '<button class="popover-item' + (active ? ' active' : '') + '" data-provider="' + escapeHtml(mo.provider) + '" data-model="' + escapeHtml(mo.id) + '">' +
            '<span class="popover-item-main">' + escapeHtml(mo.id) + '</span>' +
            '<span class="popover-item-meta">' + escapeHtml(mo.provider) + '</span></button>';
    });
    els.modelPanel.innerHTML = html;
}

export function renderThinkingPanel(): void {
    const els = ctx.els;
    const S = ctx.S;
    const labels = S.thinkingLevels;
    const cur = ctx.currentThinking || 'medium';
    els.thinkingLabel.textContent = S.thinking + ' · ' + (labels[cur] || cur);
    if (!ctx.thinkingLevels.length) {
        els.thinkingPanel.innerHTML = '<div class="popover-empty">' + S.noThinking + '</div>';
        return;
    }
    let html = '';
    ctx.thinkingLevels.forEach(function (lv) {
        const active = lv === ctx.currentThinking;
        html += '<button class="popover-item' + (active ? ' active' : '') + '" data-level="' + escapeHtml(lv) + '">' +
            '<span class="popover-item-main">' + escapeHtml(labels[lv] || lv) + '</span>' +
            '<span class="popover-item-meta">' + escapeHtml(lv) + '</span></button>';
    });
    els.thinkingPanel.innerHTML = html;
}

export function renderChips(): void {
    const els = ctx.els;
    const S = ctx.S;
    if (!ctx.contexts.length) { els.chipRow.classList.add('hidden'); els.chipRow.innerHTML = ''; return; }
    els.chipRow.classList.remove('hidden');
    let html = '';
    ctx.contexts.forEach(function (c) {
        const label = c.type === 'selection'
            ? (c.path + (c.lineRange ? ':' + c.lineRange : ''))
            : c.path;
        html += '<span class="chip' + (c.auto ? ' auto' : '') + '"><span class="chip-label" title="' + escapeHtml(label) + '">' + escapeHtml(label) + '</span>' +
            '<button class="chip-remove" data-id="' + escapeHtml(c.id) + '" title="' + S.remove + '">✕</button></span>';
    });
    els.chipRow.innerHTML = html;
}

export function renderStats(s: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; contextPercent?: number | null; contextWindow?: number; autoCompact?: boolean } | null | undefined): void {
    const els = ctx.els;
    const S = ctx.S;
    if (!s) { els.ctxStats.classList.add('hidden'); return; }
    const pct = (s.contextPercent === null || s.contextPercent === undefined) ? null : s.contextPercent;
    els.ctxStats.textContent = (pct === null ? '?' : pct.toFixed(1) + '%') + (s.autoCompact ? ' auto' : '');
    els.ctxStats.classList.toggle('danger', pct !== null && pct > 90);
    const parts: string[] = [];
    if (s.input) { parts.push('↑' + formatTokens(s.input)); }
    if (s.output) { parts.push('↓' + formatTokens(s.output)); }
    if (s.cacheRead) { parts.push('R' + formatTokens(s.cacheRead)); }
    if (s.cacheWrite) { parts.push('W' + formatTokens(s.cacheWrite)); }
    els.ctxStats.title = S.context + ' ' + (pct === null ? '?' : pct.toFixed(1) + '%') + ' / ' + formatTokens(s.contextWindow || 0) +
        (s.autoCompact ? ' (' + S.autoCompact + ')' : '') +
        (parts.length ? '\n' + S.cumulative + ' ' + parts.join('  ') : '');
    els.ctxStats.classList.remove('hidden');
}

export function renderAttachPanel(): void {
    const els = ctx.els;
    const S = ctx.S;
    let html = '<button class="popover-item" data-action="workspace">' +
        '<span class="popover-item-main">' + escapeHtml(S.attachFilesFolders) + '</span></button>';
    if (ctx.attachOpenEditors.length) {
        html += '<div class="popover-label">' + escapeHtml(S.attachOpenEditors) + '</div>';
        ctx.attachOpenEditors.forEach(function (f) {
            html += '<button class="popover-item" data-action="path" data-path="' + escapeAttr(f.path) + '"' +
                (f.range ? ' data-range="' + escapeAttr(f.range) + '"' : '') + '>' +
                '<span class="popover-item-main">' + escapeHtml(f.label) + '</span>' +
                (f.range ? '<span class="popover-item-meta">' + escapeHtml(f.range) + '</span>' : '') + '</button>';
        });
    }
    if (ctx.attachRecent.length) {
        html += '<div class="popover-label">' + escapeHtml(S.attachRecent) + '</div>';
        ctx.attachRecent.forEach(function (f) {
            html += '<button class="popover-item" data-action="path" data-path="' + escapeAttr(f.path) + '">' +
                '<span class="popover-item-main">' + escapeHtml(f.label) + '</span></button>';
        });
    }
    els.attachPanel.innerHTML = html;
}

export function renderPermissionPanel(): void {
    const els = ctx.els;
    const S = ctx.S;
    const options = permissionOptions();
    const cur = options.find(function (o) { return o.id === ctx.permissionMode; });
    els.permLabel.textContent = cur ? cur.label : S.permission;
    let html = '';
    options.forEach(function (o) {
        const active = o.id === ctx.permissionMode;
        html += '<button class="popover-item' + (active ? ' active' : '') + '" data-mode="' + o.id + '">' +
            '<span class="popover-item-main">' + escapeHtml(o.label) + '</span>' +
            '<span class="popover-item-meta">' + escapeHtml(o.desc) + '</span></button>';
    });
    els.permPanel.innerHTML = html;
}

function filteredSessions(): SessionInfo[] {
    const q = ctx.sessionQuery.trim().toLowerCase();
    if (!q) { return ctx.sessionsList; }
    return ctx.sessionsList.filter(function (s) {
        return (s.name || '').toLowerCase().indexOf(q) !== -1
            || (s.preview || '').toLowerCase().indexOf(q) !== -1
            || s.id.toLowerCase().indexOf(q) !== -1;
    });
}

function sessionRowHtml(s: SessionInfo): string {
    const S = ctx.S;
    const date = new Date(s.createdAt);
    const dateStr = (date.getMonth() + 1) + '/' + date.getDate() + ' ' + date.getHours() + ':' + String(date.getMinutes()).padStart(2, '0');
    const active = s.id === ctx.currentSessionId;
    const label = sessionDisplayName(s);
    return '<div class="session-row' + (active ? ' active' : '') + '" data-id="' + escapeHtml(s.id) + '" data-name="' + escapeHtml(s.name || '') + '">' +
        '<button class="session-row-main">' +
            '<span class="session-row-title" title="' + escapeHtml(label) + '">' + escapeHtml(label) + '</span>' +
            '<span class="session-row-meta">' + dateStr + '</span>' +
        '</button>' +
        '<button class="session-row-act" data-act="rename" title="' + S.rename + '">✎</button>' +
    '</div>';
}

export function renderSessionPanel(): void {
    const els = ctx.els;
    const S = ctx.S;
    if (!ctx.sessionsList.length) {
        els.sessionLabel.textContent = S.currentSession;
        els.sessionPanel.innerHTML = '<div class="popover-empty">' + S.noSessions + '</div>';
        return;
    }
    const cur = ctx.sessionsList.find(function (s) { return s.id === ctx.currentSessionId; });
    els.sessionLabel.textContent = cur ? sessionDisplayName(cur) : S.currentSession;

    // Build the structure once so typing/refreshing never loses the search box focus or value
    if (!els.sessionPanel.querySelector('.session-search')) {
        els.sessionPanel.innerHTML =
            '<div class="session-head">' +
                '<input type="text" class="session-search" placeholder="' + escapeHtml(S.sessionSearch) + '">' +
                '<button type="button" class="session-reload" title="' + escapeHtml(S.sessionReload) + '" aria-label="' + escapeHtml(S.sessionReload) + '">⟳</button>' +
            '</div>' +
            '<div class="session-list"></div>';
        (els.sessionPanel.querySelector('.session-search') as HTMLInputElement).value = ctx.sessionQuery;
    }
    const list = els.sessionPanel.querySelector('.session-list') as HTMLElement;
    if (!list) { return; }
    const items = filteredSessions();
    list.innerHTML = items.length
        ? items.map(sessionRowHtml).join('')
        : '<div class="popover-empty">' + escapeHtml(S.noResults) + '</div>';
}

export function updateConnectionStatus(status: string): void {
    ctx.els.connectionStatus.className = 'connection-status ' + status;
}

/**
 * First-run setup checklist (shown in the empty state): workspace trust /
 * pi installed / connected / provider ready. It hides itself once everything
 * is ready, and every unfinished row offers a one-click action.
 */
export function renderSetup(status: SetupStatus | undefined): void {
    const S = ctx.S;
    const el = ctx.els.welcomeSetup;
    // Hidden unless the user can actually do something about it (see setupStatus.ts)
    if (!status || !needsSetupAttention(status)) {
        el.classList.add('hidden');
        el.innerHTML = '';
        renderedSetupHtml = '';
        return;
    }
    el.classList.remove('hidden');
    // There is something to act on: no reason to stay in the bare boot state
    settleBoot();
    interface Row { label: string; ok: boolean; pending?: boolean; action?: string; actionLabel?: string }
    const providerSuffix = status.provider ? ' · ' + status.provider : '';
    const rows: Row[] = [
        { label: S.setupTrust, ok: status.workspaceTrusted, action: status.workspaceTrusted ? undefined : 'trust', actionLabel: S.setupTrustAction },
        { label: S.setupPi, ok: status.piFound, action: status.piFound ? undefined : 'install', actionLabel: S.setupPiAction },
        {
            label: S.setupConnect, ok: status.connected, pending: status.connecting && !status.connected,
            action: (!status.connected && status.piFound) ? 'retry' : undefined, actionLabel: S.setupConnectAction,
        },
        {
            label: S.setupProvider + providerSuffix,
            ok: status.authReady === true,
            pending: status.connected && status.authReady === undefined,
            action: (status.connected && status.authReady === false) ? 'connect' : undefined,
            actionLabel: S.setupProviderAction,
        },
    ];
    let html = '<div class="setup-head">' + escapeHtml(S.setupTitle) + '</div>';
    rows.forEach(function (r) {
        const cls = r.ok ? 'ok' : (r.pending ? 'pending' : 'todo');
        html += '<div class="setup-row ' + cls + '">' +
            '<span class="setup-dot" aria-hidden="true"></span>' +
            '<span class="setup-label">' + escapeHtml(r.label) + '</span>' +
            (r.action ? '<button type="button" class="setup-action" data-action="' + r.action + '">' + escapeHtml(r.actionLabel || '') + '</button>' : '') +
            '</div>';
    });
    html += '<div class="setup-foot">' +
        '<button type="button" class="setup-manage" data-action="manage">' + escapeHtml(S.setupManage) + '</button>' +
        '<button type="button" class="setup-logs" data-action="logs">' + escapeHtml(S.setupLogs) + '</button>' +
        '</div>';
    // Re-rendering identical markup would drop the hover/focus of a button the
    // user is already reaching for, and repaint the block for nothing
    if (html === renderedSetupHtml) { return; }
    renderedSetupHtml = html;
    el.innerHTML = html;
}

export function updateMessageCount(): void {
    const count = ctx.els.chat.querySelectorAll('.message').length;
    ctx.els.messageCount.textContent = count + ' ' + ctx.S.messages;
}
