// ---------------------------------------------------------------------------
// Slash commands / @ file mentions
// ---------------------------------------------------------------------------

import type { WebviewContext, SuggestToken, SuggestItem } from '../types';
import { escapeHtml } from '../utils';
import { autoResizeInput } from './inputHandling';

let ctx: WebviewContext;

export function initSlashCommands(c: WebviewContext): void {
    ctx = c;
}

export function detectSuggestToken(): SuggestToken | null {
    const input = ctx.els.input;
    const pos = input.selectionStart;
    const before = input.value.slice(0, pos);
    const slash = /^\/([^\s]*)$/.exec(before);
    if (slash) { return { mode: 'slash', start: 0, end: pos, filter: slash[1] }; }
    const at = /(^|\s)@([^\s@]*)$/.exec(before);
    if (at) { return { mode: 'file', start: pos - at[2].length - 1, end: pos, filter: at[2] }; }
    return null;
}

export function updateSuggest(): void {
    const token = detectSuggestToken();
    if (!token) { closeSuggest(); return; }
    ctx.suggestMode = token.mode;
    ctx.suggestStart = token.start;
    ctx.suggestEnd = token.end;
    const f = token.filter.toLowerCase();
    if (token.mode === 'slash') {
        // Merge pi SDK commands with built-ins
        const allCommands = BUILTIN_COMMANDS.concat(ctx.slashCommands.map(function (c) {
            return { name: c.name, description: c.description || '' };
        }));
        ctx.suggestItems = allCommands.filter(function (c) {
            return c.name.toLowerCase().indexOf(f) !== -1 || (c.description || '').toLowerCase().indexOf(f) !== -1;
        }).slice(0, 50).map(function (c) {
            return { label: '/' + c.name, detail: c.description || '', source: '', insert: '/' + c.name + ' ' };
        });
    } else {
        if (ctx.filesList === null) { ctx.vscode.postMessage({ type: 'requestFiles' }); }
        const list = ctx.filesList || [];
        const matched: string[] = [];
        for (let i = 0; i < list.length && matched.length < 50; i++) {
            if (list[i].toLowerCase().indexOf(f) !== -1) { matched.push(list[i]); }
        }
        ctx.suggestItems = matched.map(function (p) {
            return { label: '@' + p, detail: '', source: '', insert: '@' + p + ' ' };
        });
    }
    ctx.suggestIndex = 0;
    renderSuggest();
}

export function renderSuggest(): void {
    const suggest = ctx.els.suggest;
    if (!ctx.suggestItems.length) { closeSuggest(); return; }
    if (ctx.suggestIndex >= ctx.suggestItems.length) { ctx.suggestIndex = 0; }
    let html = '';
    ctx.suggestItems.forEach(function (it, i) {
        html += '<div class="suggest-item' + (i === ctx.suggestIndex ? ' active' : '') + '" data-i="' + i + '">' +
            '<span class="suggest-label">' + escapeHtml(it.label) + '</span>' +
            (it.detail ? '<span class="suggest-detail">' + escapeHtml(it.detail) + '</span>' : '') +
            (it.source ? '<span class="suggest-source">' + escapeHtml(it.source) + '</span>' : '') +
            '</div>';
    });
    suggest.innerHTML = html;
    suggest.classList.remove('hidden');
}

export function closeSuggest(): void {
    ctx.suggestMode = null;
    ctx.suggestItems = [];
    ctx.suggestIndex = 0;
    ctx.els.suggest.classList.add('hidden');
    ctx.els.suggest.innerHTML = '';
}

export function acceptSuggest(): void {
    const input = ctx.els.input;
    if (!ctx.suggestMode || !ctx.suggestItems.length) { return; }
    const item = ctx.suggestItems[ctx.suggestIndex];
    input.value = input.value.slice(0, ctx.suggestStart) + item.insert + input.value.slice(ctx.suggestEnd);
    const caret = ctx.suggestStart + item.insert.length;
    input.selectionStart = input.selectionEnd = caret;
    closeSuggest();
    input.focus();
    autoResizeInput();
}

export function suggestOpen(): boolean {
    return !ctx.els.suggest.classList.contains('hidden') && ctx.suggestItems.length > 0;
}

export function setSuggestIndex(i: number): void {
    ctx.suggestIndex = i;
}

/** Built-in slash commands (shown in the suggest list) */
export interface BuiltinCommand {
    name: string;
    description: string;
}

export const BUILTIN_COMMANDS: BuiltinCommand[] = [
    { name: 'compact', description: 'Compact session (summarize older turns)' },
    { name: 'clear', description: 'Clear the conversation' },
    { name: 'new', description: 'Start a new session' },
    { name: 'clone', description: 'Clone the current session' },
    { name: 'model', description: 'Switch model' },
    { name: 'thinking', description: 'Set thinking level' },
    { name: 'permission', description: 'Set permission mode' },
    { name: 'sessions', description: 'Switch session' },
    { name: 'export', description: 'Export conversation as Markdown' },
    { name: 'search', description: 'Search messages (Ctrl+F)' },
    { name: 'help', description: 'Show available commands' },
];

/** Suggest items for the built-in commands */
export function builtinSuggestItems(): SuggestItem[] {
    return BUILTIN_COMMANDS.map(function (c) {
        return { label: '/' + c.name, detail: c.description, source: '', insert: '/' + c.name + ' ' };
    });
}
