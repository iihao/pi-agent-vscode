// ---------------------------------------------------------------------------
// Copy shortcut fallback
//
// Selecting text in the transcript and pressing Ctrl/Cmd+C did nothing in the
// VS Code webview: the native edit command never reached the embedded document,
// so no clipboard write happened — and with no focused element left, focus fell
// back into the composer, which looked like a shortcut conflict. (Nothing in the
// extension binds copy; the webview's other keydown handlers only touch
// Arrow/Enter/Tab/Escape/F.)
//
// The extension already has a working clipboard path — the code-block and
// message copy buttons post `copyCode` to the host, which writes through
// `vscode.env.clipboard`. This module routes the *shortcut* through the same
// channel when the selection is outside an editable field, so copying does not
// depend on the webview's native keyboard handling at all.
//
// Text inside an input/textarea is deliberately left alone: there the native
// behavior works and a round-trip would only add latency.
// ---------------------------------------------------------------------------

import type { WebviewContext } from '../types';

let ctx: WebviewContext;

export function initCopyShortcut(c: WebviewContext): void {
    ctx = c;
}

/** Whether the event target is a place where typing/copying is native (composer, search) */
export function isEditableTarget(target: EventTarget | null): boolean {
    const el = target as { closest?: (sel: string) => unknown } | null;
    if (!el || typeof el.closest !== 'function') { return false; }
    return Boolean(el.closest('input, textarea, [contenteditable="true"]'));
}

/**
 * The text a Ctrl/Cmd+C press should copy, or null when the press must be left
 * to the browser (no selection, collapsed selection, or focus in an input).
 */
export function copyShortcutText(
    target: EventTarget | null,
    selection: { text: string; isCollapsed: boolean } | null,
): string | null {
    if (!selection || selection.isCollapsed) { return null; }
    const text = selection.text;
    if (!text) { return null; }
    if (isEditableTarget(target)) { return null; }
    return text;
}

/** Bind the document-level fallback (idempotent per webview) */
export function bindCopyShortcut(): void {
    const doc = (globalThis as { document?: Document }).document;
    if (!doc || typeof doc.addEventListener !== 'function') { return; }
    doc.addEventListener('keydown', (e: KeyboardEvent) => {
        const isCopy = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === 'c' || e.key === 'C');
        if (!isCopy) { return; }
        const getSelection = (globalThis as { getSelection?: () => Selection | null }).getSelection;
        const sel = typeof getSelection === 'function' ? getSelection.call(globalThis) : null;
        const text = copyShortcutText(e.target, sel ? { text: String(sel), isCollapsed: sel.isCollapsed } : null);
        if (text === null) { return; }
        // Take over: the host's clipboard write is the one that actually lands,
        // and preventing the default also keeps focus where the selection is
        e.preventDefault();
        ctx.vscode.postMessage({ type: 'copyText', text });
    });
}
