// ---------------------------------------------------------------------------
// 所有 DOM 事件绑定
// ---------------------------------------------------------------------------

import type { WebviewContext } from '../types';
import { getMessageText } from '../utils';
import { closePopovers, togglePopover } from './panels';
import { jumpToUserMessage, navigateUserMessage, updateRailActive, renderOutline } from './navigator';
import { searchMessages, goToMatch, clearSearch } from './search';
import { updateSuggest, renderSuggest, acceptSuggest, closeSuggest, suggestOpen, setSuggestIndex } from './slashCommands';
import { exportConversation } from './exporter';
import { readImage, renderImages } from './imagePaste';
import { send, navigateHistory, autoResizeInput, copyMessage, editMessage, deleteMessage } from './inputHandling';

let ctx: WebviewContext;

export function initEventBindings(c: WebviewContext): void {
    ctx = c;
    bindNavigatorEvents();
    bindToolbarEvents();
    bindSearchEvents();
    bindInputEvents();
    bindPanelEvents();
    bindChatEvents();
}

function bindNavigatorEvents(): void {
    const els = ctx.els;
    els.qCounter.addEventListener('click', function (e) {
        e.stopPropagation();
        const willShow = els.outlinePanel.classList.contains('hidden');
        closePopovers();
        if (willShow) { renderOutline(); els.outlinePanel.classList.remove('hidden'); }
    });
    els.outlinePanel.addEventListener('click', function (e) {
        const it = (e.target as HTMLElement).closest('.outline-item') as HTMLElement | null;
        if (!it) { return; }
        jumpToUserMessage(Number(it.dataset.i));
        els.outlinePanel.classList.add('hidden');
    });
    els.msgRail.addEventListener('click', function (e) {
        const dot = (e.target as HTMLElement).closest('.rail-dot') as HTMLElement | null;
        if (dot) { jumpToUserMessage(Number(dot.dataset.i)); }
    });
    els.qPrev.addEventListener('click', function () { navigateUserMessage(-1); });
    els.qNext.addEventListener('click', function () { navigateUserMessage(1); });
    let railRaf = 0;
    els.chat.addEventListener('scroll', function () {
        if (railRaf) { return; }
        railRaf = requestAnimationFrame(function () { railRaf = 0; updateRailActive(); });
    });
}

function bindToolbarEvents(): void {
    const els = ctx.els;
    els.searchBtn.addEventListener('click', function () {
        els.searchBar.classList.toggle('visible');
        if (els.searchBar.classList.contains('visible')) {
            els.searchInput.focus();
        } else {
            clearSearch();
        }
    });
    els.exportBtn.addEventListener('click', () => exportConversation());
    els.newChatBtn.addEventListener('click', function () {
        ctx.vscode.postMessage({ type: 'newSession' });
    });
}

function bindSearchEvents(): void {
    const els = ctx.els;
    els.searchInput.addEventListener('input', function () {
        searchMessages(els.searchInput.value);
    });
    els.searchPrev.addEventListener('click', function () { goToMatch(-1); });
    els.searchNext.addEventListener('click', function () { goToMatch(1); });
    els.searchClose.addEventListener('click', function () {
        els.searchBar.classList.remove('visible');
        clearSearch();
    });
    els.searchInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            goToMatch(e.shiftKey ? -1 : 1);
        } else if (e.key === 'Escape') {
            els.searchBar.classList.remove('visible');
            clearSearch();
        }
    });
}

function bindInputEvents(): void {
    const els = ctx.els;
    els.sendBtn.addEventListener('click', function () {
        if (ctx.busy) { ctx.vscode.postMessage({ type: 'abort' }); } else { send(); }
    });
    els.input.addEventListener('input', function () { autoResizeInput(); updateSuggest(); });
    els.input.addEventListener('click', function () { updateSuggest(); });
    els.input.addEventListener('paste', function (e) {
        const items = (e as ClipboardEvent).clipboardData && (e as ClipboardEvent).clipboardData!.items;
        if (!items) { return; }
        let handled = false;
        for (let i = 0; i < items.length; i++) {
            const it = items[i];
            if (it.kind === 'file' && it.type && it.type.indexOf('image/') === 0) {
                const file = it.getAsFile();
                if (file) { readImage(file); handled = true; }
            }
        }
        if (handled) { e.preventDefault(); }
    });
    els.imageRow.addEventListener('click', function (e) {
        const btn = (e.target as HTMLElement).closest('button[data-i]') as HTMLElement | null;
        if (btn) { ctx.pendingImages.splice(Number(btn.dataset.i), 1); renderImages(); }
    });
    els.input.addEventListener('keyup', function (e) {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') { updateSuggest(); }
    });
    ['dragenter', 'dragover'].forEach(function (ev) {
        els.input.addEventListener(ev, function (e) { e.preventDefault(); });
    });
    els.input.addEventListener('drop', function (e) {
        e.preventDefault();
        const dt = (e as DragEvent).dataTransfer;
        if (!dt) { return; }
        let raw = '';
        try { raw = dt.getData('text/uri-list') || dt.getData('text/plain') || ''; } catch (err) { raw = ''; }
        const paths = raw.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(function (s) { return s && s.charAt(0) !== '#'; });
        if (paths.length) { ctx.vscode.postMessage({ type: 'dropFiles', paths: paths }); }
    });
    els.suggest.addEventListener('mousedown', function (e) {
        const it = (e.target as HTMLElement).closest('.suggest-item') as HTMLElement | null;
        if (!it) { return; }
        e.preventDefault();
        setSuggestIndex(Number(it.dataset.i));
        acceptSuggest();
    });
    els.input.addEventListener('keydown', function (e) {
        // Alt+↑/↓ 交给文档级处理器做问题跳转，不当作输入历史
        if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { return; }
        // 补全菜单优先响应方向键 / 回车 / Tab / Esc
        if (suggestOpen()) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSuggestIndex((ctx.suggestIndex + 1) % ctx.suggestItems.length); renderSuggest(); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSuggestIndex((ctx.suggestIndex - 1 + ctx.suggestItems.length) % ctx.suggestItems.length); renderSuggest(); return; }
            if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); acceptSuggest(); return; }
            if (e.key === 'Escape') { e.preventDefault(); closeSuggest(); return; }
        }
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            send(e.ctrlKey || e.metaKey ? 'steer' : undefined);
        } else if (e.key === 'f' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            els.searchBar.classList.add('visible');
            els.searchInput.focus();
        } else if (e.key === 'ArrowUp' && !ctx.busy && els.input.selectionStart === 0) {
            e.preventDefault();
            navigateHistory(-1);
        } else if (e.key === 'ArrowDown' && !ctx.busy && els.input.selectionStart === els.input.value.length) {
            e.preventDefault();
            navigateHistory(1);
        }
    });
    document.querySelectorAll('.quick-action').forEach(function (btn) {
        btn.addEventListener('click', function () {
            ctx.vscode.postMessage({ type: 'sendMessage', text: (btn as HTMLElement).dataset.q, mode: ctx.busy ? 'queue' : undefined });
        });
    });
}

function bindPanelEvents(): void {
    const els = ctx.els;
    els.modelBtn.addEventListener('click', function (e) { e.stopPropagation(); togglePopover(els.modelPanel); });
    els.thinkingBtn.addEventListener('click', function (e) { e.stopPropagation(); togglePopover(els.thinkingPanel); });
    els.permBtn.addEventListener('click', function (e) { e.stopPropagation(); togglePopover(els.permPanel); });
    els.permPanel.addEventListener('click', function (e) {
        const item = (e.target as HTMLElement).closest('.popover-item') as HTMLElement | null;
        if (!item || !item.dataset.mode) { return; }
        ctx.vscode.postMessage({ type: 'setPermission', mode: item.dataset.mode });
        closePopovers();
    });
    els.modelPanel.addEventListener('click', function (e) {
        const item = (e.target as HTMLElement).closest('.popover-item') as HTMLElement | null;
        if (!item || !item.dataset.model) { return; }
        ctx.vscode.postMessage({ type: 'setModel', provider: item.dataset.provider, modelId: item.dataset.model });
        closePopovers();
    });
    els.thinkingPanel.addEventListener('click', function (e) {
        const item = (e.target as HTMLElement).closest('.popover-item') as HTMLElement | null;
        if (!item || !item.dataset.level) { return; }
        ctx.vscode.postMessage({ type: 'setThinking', level: item.dataset.level });
        closePopovers();
    });
    document.addEventListener('click', function () { closePopovers(); });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { closePopovers(); return; }
        if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
            e.preventDefault();
            navigateUserMessage(e.key === 'ArrowDown' ? 1 : -1);
        }
    });
    els.attachBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        const willShow = els.attachPanel.classList.contains('hidden');
        closePopovers();
        if (willShow) { ctx.attachPending = true; ctx.vscode.postMessage({ type: 'requestAttachMenu' }); }
        else { ctx.attachPending = false; }
    });
    els.attachPanel.addEventListener('click', function (e) {
        const item = (e.target as HTMLElement).closest('.popover-item') as HTMLElement | null;
        if (!item) { return; }
        const action = item.dataset.action;
        if (action === 'workspace') { ctx.vscode.postMessage({ type: 'attachWorkspace' }); }
        else if (action === 'path') {
            ctx.vscode.postMessage({ type: 'attachPath', path: item.dataset.path, range: item.dataset.range || undefined });
        }
        closePopovers();
    });
    els.chipRow.addEventListener('click', function (e) {
        const btn = (e.target as HTMLElement).closest('.chip-remove') as HTMLElement | null;
        if (btn) { ctx.vscode.postMessage({ type: 'removeContext', id: btn.dataset.id }); }
    });
    els.sessionBtn.addEventListener('click', function (e) { e.stopPropagation(); togglePopover(els.sessionPanel); });
    els.sessionPanel.addEventListener('click', function (e) {
        const act = (e.target as HTMLElement).closest('.session-row-act') as HTMLElement | null;
        if (act) {
            const row = act.closest('.session-row') as HTMLElement | null;
            if (!row) { return; }
            if (act.dataset.act === 'rename') {
                ctx.vscode.postMessage({ type: 'renameSession', sessionId: row.dataset.id, currentName: row.dataset.name || '' });
                closePopovers();
            }
            return;
        }
        const main = (e.target as HTMLElement).closest('.session-row-main') as HTMLElement | null;
        if (main) {
            const row = main.closest('.session-row') as HTMLElement | null;
            if (row) { ctx.vscode.postMessage({ type: 'switchSession', sessionId: row.dataset.id }); closePopovers(); }
        }
    });
}

function bindChatEvents(): void {
    const els = ctx.els;
    els.chat.addEventListener('click', function (e) {
        const target = e.target as HTMLElement;
        const turnFile = target.closest('.turn-file') as HTMLElement | null;
        if (turnFile) { ctx.vscode.postMessage({ type: 'openFile', path: turnFile.dataset.path }); return; }
        const revertBtn = target.closest('.turn-changes-revert');
        if (revertBtn) { ctx.vscode.postMessage({ type: 'revertTurn' }); return; }
        const link = target.closest('a[href]') as HTMLAnchorElement | null;
        if (link) {
            e.preventDefault();
            ctx.vscode.postMessage({ type: 'openLink', href: link.getAttribute('href') });
            return;
        }
        const codeBtn = target.closest('button[data-act]') as HTMLElement | null;
        if (codeBtn) {
            const block = codeBtn.closest('.code-block');
            const codeEl = block ? block.querySelector('pre code') : null;
            if (codeEl) {
                const code = codeEl.textContent;
                if (codeBtn.dataset.act === 'apply') { ctx.vscode.postMessage({ type: 'applyCode', code: code }); }
                else if (codeBtn.dataset.act === 'copy') { ctx.vscode.postMessage({ type: 'copyCode', code: code }); }
            }
            return;
        }
        const msgBtn = target.closest('.msg-action-btn') as HTMLElement | null;
        if (msgBtn) {
            const msgEl = msgBtn.closest('.message') as HTMLElement | null;
            if (msgEl) {
                const body = msgEl.querySelector('.message-body') as HTMLElement | null;
                const text = getMessageText(body);
                if (msgBtn.dataset.action === 'copy') { copyMessage(msgBtn, text); }
                else if (msgBtn.dataset.action === 'edit') { editMessage(text, msgEl); }
                else if (msgBtn.dataset.action === 'delete') { deleteMessage(msgEl); }
            }
        }
    });
}
