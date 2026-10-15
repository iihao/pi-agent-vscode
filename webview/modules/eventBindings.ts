// ---------------------------------------------------------------------------
// All DOM event bindings
// ---------------------------------------------------------------------------

import type { WebviewContext } from '../types';
import { getMessageText } from '../utils';
import { closePopovers, togglePopover, renderSessionPanel } from './panels';
import { clickedInsidePopover } from './popovers';
import { jumpToUserMessage, navigateUserMessage, updateRailActive, renderOutline } from './navigator';
import { searchMessages, goToMatch, clearSearch } from './search';
import { updateSuggest, renderSuggest, acceptSuggest, closeSuggest, suggestOpen, setSuggestIndex } from './slashCommands';
import { exportConversation } from './exporter';
import { readImage, renderImages } from './imagePaste';
import { send, navigateHistory, autoResizeInput, copyMessage, editMessage, deleteMessage } from './inputHandling';
import { updateSendAffordances } from './messageRenderer';

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
        // One button, two roles: send when idle, stop while a turn is running.
        // Sending while busy is done with Enter (queue / steer per the toggle).
        if (ctx.busy) { ctx.vscode.postMessage({ type: 'abort' }); } else { send(); }
    });
    els.modeBtn.addEventListener('click', function () {
        ctx.sendMode = ctx.sendMode === 'queue' ? 'steer' : 'queue';
        updateSendAffordances();
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
        // Alt+Up/Down is handled at the document level for question jumping, not input history
        if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { return; }
        // Let the suggest menu handle arrows / Enter / Tab / Esc first
        if (suggestOpen()) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSuggestIndex((ctx.suggestIndex + 1) % ctx.suggestItems.length); renderSuggest(); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSuggestIndex((ctx.suggestIndex - 1 + ctx.suggestItems.length) % ctx.suggestItems.length); renderSuggest(); return; }
            if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); acceptSuggest(); return; }
            if (e.key === 'Escape') { e.preventDefault(); closeSuggest(); return; }
        }
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            // Ctrl/Cmd+Enter forces steer; otherwise use the current mode
            send(e.ctrlKey || e.metaKey ? 'steer' : (ctx.busy ? ctx.sendMode : undefined));
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
    // A click *inside* a popover must not close it. The session panel holds a search
    // input, so typing in it used to shut the panel immediately, and the refresh
    // button's result was dismissed before it could be read. Rows that switch or
    // rename a session close the panel themselves.
    document.addEventListener('click', function (e) {
        if (clickedInsidePopover(e.target)) { return; }
        closePopovers();
    });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { closePopovers(); return; }
        // Handled here, not on the textarea: the shortcut is advertised as Ctrl+F and
        // the button is always visible, so it has to work whatever has focus.
        if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
            e.preventDefault();
            els.searchBar.classList.add('visible');
            els.searchInput.focus();
            return;
        }
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
    els.sessionPanel.addEventListener('input', function (e) {
        // Session search: refresh only the list so the input keeps focus
        const input = (e.target as HTMLElement).closest('.session-search') as HTMLInputElement | null;
        if (!input) { return; }
        ctx.sessionQuery = input.value;
        renderSessionPanel();
    });
    els.sessionPanel.addEventListener('click', function (e) {
        // Re-read the session directory (another pi process may have changed it)
        const reload = (e.target as HTMLElement).closest('.session-reload') as HTMLElement | null;
        if (reload) {
            ctx.vscode.postMessage({ type: 'refreshSessions' });
            return;
        }
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

        // One-click actions on the setup checklist (install pi / sign in / retry / trust / logs)
        const setupBtn = target.closest('.setup-action, .setup-logs, .setup-manage') as HTMLButtonElement | null;
        if (setupBtn && setupBtn.dataset.action) {
            ctx.vscode.postMessage({ type: 'setupAction', action: setupBtn.dataset.action });
            return;
        }

        // Action buttons on an error bubble
        const errBtn = target.closest('.error-action') as HTMLButtonElement | null;
        if (errBtn) {
            const action = errBtn.dataset.action;
            // "Switch model" opens the model picker locally; the rest go to the host
            if (action === 'model') { togglePopover(ctx.els.modelPanel); }
            else if (action) { ctx.vscode.postMessage({ type: 'errorAction', action }); }
            return;
        }

        // Revert a single file
        const fileRevertBtn = target.closest('.turn-file-revert') as HTMLButtonElement | null;
        if (fileRevertBtn) {
            const row = fileRevertBtn.closest('.turn-file-row') as HTMLElement | null;
            const path = row?.dataset.path;
            if (path) {
                fileRevertBtn.classList.add('busy');
                ctx.vscode.postMessage({ type: 'revertTurnFile', path });
            }
            return;
        }

        // Expand / collapse a file's inline diff
        const diffToggle = target.closest('.turn-file-diff-toggle') as HTMLButtonElement | null;
        if (diffToggle) {
            const row = diffToggle.closest('.turn-file-row') as HTMLElement | null;
            const path = row?.dataset.path;
            if (path) {
                const block = ctx.els.chat.querySelector('.turn-file-diff[data-path="' + CSS.escape(path) + '"]') as HTMLElement | null;
                block?.classList.toggle('hidden');
                diffToggle.classList.toggle('active', Boolean(block && !block.classList.contains('hidden')));
            }
            return;
        }

        // Revert all
        const revertBtn = target.closest('.turn-changes-revert') as HTMLButtonElement | null;
        if (revertBtn) {
            revertBtn.classList.add('busy');
            revertBtn.disabled = true;
            // Show a busy state on every revertible row
            const card = revertBtn.closest('.turn-changes') as HTMLElement | null;
            card?.querySelectorAll('.turn-file-revert').forEach(function (b) { (b as HTMLButtonElement).disabled = true; });
            ctx.vscode.postMessage({ type: 'revertTurn' });
            return;
        }

        // Undo the revert
        const undoBtn = target.closest('.turn-changes-undo') as HTMLButtonElement | null;
        if (undoBtn) {
            undoBtn.classList.add('busy');
            undoBtn.disabled = true;
            ctx.vscode.postMessage({ type: 'undoRevert' });
            return;
        }

        // Open the tool's full output file
        const fullOutputBtn = target.closest('.activity-open-output') as HTMLElement | null;
        const fullOutputPath = fullOutputBtn?.dataset.path;
        if (fullOutputPath) { ctx.vscode.postMessage({ type: 'openFile', path: fullOutputPath }); return; }

        // Click a file row -> open the file
        const turnFile = target.closest('.turn-file-row') as HTMLElement | null;
        const path = turnFile?.dataset.path;
        if (path) { ctx.vscode.postMessage({ type: 'openFile', path }); return; }
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
                else if (msgBtn.dataset.action === 'edit') { editMessage(text); }
                else if (msgBtn.dataset.action === 'delete') { deleteMessage(msgEl); }
            }
        }
    });
}
