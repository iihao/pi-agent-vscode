// ---------------------------------------------------------------------------
// Input handling: send, edit/delete/copy messages, input history
// ---------------------------------------------------------------------------

import type { WebviewContext } from '../types';
import { MAX_MESSAGE_CHARS } from '../../src/chatPanel/sharedTypes';
import { updateMessageCount, togglePopover } from './panels';
import { renderRail } from './navigator';
import { renderImages } from './imagePaste';
import { addBashRunning } from './toolRenderer';
import { addNotice } from './messageRenderer';
import { bashId, escapeHtml } from '../utils';
import { getAllMessages } from './search';

let ctx: WebviewContext;

export function initInputHandling(c: WebviewContext): void {
    ctx = c;
}

export function autoResizeInput(): void {
    const input = ctx.els.input;
    input.style.height = 'auto';
    const newHeight = Math.min(Math.max(36, input.scrollHeight), 200);
    input.style.height = newHeight + 'px';
}

export function send(mode?: string): void {
    const input = ctx.els.input;
    const text = input.value.trim();
    const images = ctx.pendingImages.map(function (i) { return { type: 'image', data: i.data, mimeType: i.mimeType }; });
    if (!text && !images.length) { return; }
    // The host would refuse this after the composer is already cleared — checking
    // the shared limit here keeps the text where the user can still reach it
    if (text.length > MAX_MESSAGE_CHARS) {
        addNotice(ctx.S.messageTooLong.replace('{0}', String(MAX_MESSAGE_CHARS)));
        return;
    }
    // Save to input history
    if (text && (ctx.messageHistory.length === 0 || ctx.messageHistory[ctx.messageHistory.length - 1] !== text)) {
        ctx.messageHistory.push(text);
        if (ctx.messageHistory.length > 50) { ctx.messageHistory.shift(); }
    }
    ctx.historyIndex = -1;
    // Intercept slash commands / `!` shell: these do not send a prompt to pi
    if (text.charAt(0) === '/') {
        const cmd = text.split(/\s/)[0];
        if (cmd === '/compact') {
            ctx.vscode.postMessage({ type: 'compact' });
            input.value = '';
            autoResizeInput();
            return;
        }
        if (cmd === '/clear') {
            ctx.vscode.postMessage({ type: 'clear' });
            input.value = '';
            autoResizeInput();
            return;
        }
        if (cmd === '/new') {
            ctx.vscode.postMessage({ type: 'newSession' });
            input.value = '';
            autoResizeInput();
            return;
        }
        if (cmd === '/clone') {
            ctx.vscode.postMessage({ type: 'cloneSession' });
            input.value = '';
            autoResizeInput();
            return;
        }
        if (cmd === '/model') {
            togglePopover(ctx.els.modelPanel);
            input.value = '';
            autoResizeInput();
            return;
        }
        if (cmd === '/thinking') {
            togglePopover(ctx.els.thinkingPanel);
            input.value = '';
            autoResizeInput();
            return;
        }
        if (cmd === '/permission') {
            togglePopover(ctx.els.permPanel);
            input.value = '';
            autoResizeInput();
            return;
        }
        if (cmd === '/sessions') {
            togglePopover(ctx.els.sessionPanel);
            input.value = '';
            autoResizeInput();
            return;
        }
        if (cmd === '/export') {
            const messages = getAllMessages();
            if (messages.length === 0) {
                ctx.vscode.postMessage({ type: 'notify', text: ctx.S.exportEmpty });
            } else {
                let markdown = ctx.S.exportHeader + '\n\n';
                markdown += ctx.S.exportTime + new Date().toLocaleString() + '\n\n---\n\n';
                messages.forEach(function (m) {
                    const role = m.role === 'user' ? '**' + ctx.S.you + '**' : '**Pi**';
                    markdown += '### ' + role + '\n\n' + m.text + '\n\n---\n\n';
                });
                ctx.vscode.postMessage({ type: 'exportConversation', markdown: markdown });
            }
            input.value = '';
            autoResizeInput();
            return;
        }
        if (cmd === '/search') {
            ctx.vscode.postMessage({ type: 'focusSearch' });
            input.value = '';
            autoResizeInput();
            return;
        }
        if (cmd === '/help') {
            ctx.vscode.postMessage({ type: 'showHelp' });
            input.value = '';
            autoResizeInput();
            return;
        }
    }
    // `!` prefix: run a shell command directly, without a model turn
    if (text.charAt(0) === '!') {
        const command = text.slice(1).trim();
        if (command) {
            const id = bashId();
            addBashRunning(id, command);
            ctx.vscode.postMessage({ type: 'runBash', text: command, id: id });
        }
        input.value = '';
        autoResizeInput();
        return;
    }
    // While busy: send using the current mode (queue / steer); a modifier forces steer.
    // "Edit" only prefills the composer: the send lands as a fresh message at the end
    // of the conversation, which is exactly what pi receives — the transcript never
    // pretends the original exchange disappeared (a session file is append-only;
    // silently dropping the DOM tail made the view lie about the model's context).
    ctx.vscode.postMessage({ type: 'sendMessage', text: text, mode: ctx.busy ? (mode ?? ctx.sendMode) : undefined, images: images.length ? images : undefined });
    input.value = '';
    ctx.pendingImages = [];
    renderImages();
    autoResizeInput();
}

export function navigateHistory(direction: number): void {
    const input = ctx.els.input;
    if (ctx.messageHistory.length === 0) { return; }
    if (ctx.historyIndex === -1) {
        ctx.historyIndex = ctx.messageHistory.length + direction;
    } else {
        ctx.historyIndex += direction;
    }
    if (ctx.historyIndex < 0) { ctx.historyIndex = 0; }
    if (ctx.historyIndex >= ctx.messageHistory.length) {
        ctx.historyIndex = -1;
        input.value = '';
        return;
    }
    input.value = ctx.messageHistory[ctx.historyIndex];
    input.selectionStart = input.selectionEnd = input.value.length;
}

export function copyMessage(btn: HTMLElement, text: string): void {
    ctx.vscode.postMessage({ type: 'copyCode', code: text });
    const original = btn.innerHTML;
    btn.textContent = 'OK';
    setTimeout(function () { btn.innerHTML = original; }, 1000);
}

/**
 * Reuse a message: put its text back into the composer for editing and
 * resending. Nothing is removed anywhere — the resend is a new turn and pi
 * still sees the original exchange, so the view must show it too.
 *
 * Whatever was being typed is not thrown away: it goes into the input history
 * (↑ brings it back) and says so, since the composer is about to show different
 * text.
 */
export function editMessage(text: string): void {
    const input = ctx.els.input;
    const draft = input.value.trim();
    if (draft && draft !== text) {
        ctx.messageHistory.push(draft);
        if (ctx.messageHistory.length > 50) { ctx.messageHistory.shift(); }
        ctx.historyIndex = -1;
        addNotice(ctx.S.draftKept);
    }
    input.value = text;
    input.focus();
    // Select it: the swap is visible, and typing replaces it (that is the "reuse" flow)
    input.selectionStart = 0;
    input.selectionEnd = text.length;
    autoResizeInput();
}

/** Hide a message from the transcript. Presentation only: pi's context and
 *  the session file keep it; the button's tooltip says so. */
export function deleteMessage(msgEl: HTMLElement): void {
    msgEl.remove();
    updateMessageCount();
    renderRail();
}
