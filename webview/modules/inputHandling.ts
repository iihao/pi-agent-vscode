// ---------------------------------------------------------------------------
// Input handling: send, edit/delete/copy messages, input history
// ---------------------------------------------------------------------------

import type { WebviewContext } from '../types';
import { updateMessageCount, togglePopover } from './panels';
import { renderRail } from './navigator';
import { renderImages } from './imagePaste';
import { addBashRunning } from './toolRenderer';
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

export function removeMessagesFrom(el: HTMLElement): void {
    let current: HTMLElement | null = el;
    while (current) {
        const next = current.nextElementSibling;
        current.remove();
        current = next as HTMLElement | null;
    }
    updateMessageCount();
    renderRail();
}

export function send(mode?: string): void {
    const input = ctx.els.input;
    const text = input.value.trim();
    const images = ctx.pendingImages.map(function (i) { return { type: 'image', data: i.data, mimeType: i.mimeType }; });
    if (!text && !images.length) { return; }
    // Edit & resend: drop the original message and everything after it
    if (ctx.editingMessageEl) {
        removeMessagesFrom(ctx.editingMessageEl);
        ctx.editingMessageEl.classList.remove('editing');
        ctx.editingMessageEl = null;
    }
    // Save to input history
    if (text && (ctx.messageHistory.length === 0 || ctx.messageHistory[ctx.messageHistory.length - 1] !== text)) {
        ctx.messageHistory.push(text);
        if (ctx.messageHistory.length > 50) { ctx.messageHistory.shift(); }
    }
    ctx.historyIndex = -1;
    // Intercept slash commands
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
    // While busy: send using the current mode (queue / steer); a modifier forces steer
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

export function editMessage(text: string, msgEl: HTMLElement | null): void {
    if (ctx.editingMessageEl) {
        ctx.editingMessageEl.classList.remove('editing');
    }
    ctx.editingMessageEl = msgEl || null;
    if (ctx.editingMessageEl) {
        ctx.editingMessageEl.classList.add('editing');
    }
    ctx.els.input.value = text;
    ctx.els.input.focus();
    autoResizeInput();
}

export function deleteMessage(msgEl: HTMLElement): void {
    msgEl.remove();
    updateMessageCount();
    renderRail();
}
