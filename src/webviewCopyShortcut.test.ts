// ---------------------------------------------------------------------------
// Ctrl/Cmd+C fallback
//
// Native copy does not reach the VS Code webview's document, so selecting text
// in a transcript and pressing the copy shortcut did nothing (and focus fell
// back into the composer). Copying is routed through the extension's own
// clipboard channel — the same one the copy buttons use — but only for
// selections outside editable fields and only when something is selected.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { copyShortcutText, isEditableTarget, initCopyShortcut, bindCopyShortcut } from '../webview/modules/copyShortcut';

function target(sel: string | null): EventTarget {
    return { closest: (q: string) => (sel && q.includes(sel) ? {} : null) } as unknown as EventTarget;
}

describe('copy shortcut fallback', () => {
    it('copies a non-empty selection outside inputs', () => {
        expect(copyShortcutText(target('div'), { text: 'hello', isCollapsed: false })).toBe('hello');
    });

    it('leaves the composer and search boxes to native copy', () => {
        expect(copyShortcutText(target('textarea'), { text: 'draft', isCollapsed: false })).toBeNull();
        expect(copyShortcutText(target('input'), { text: 'query', isCollapsed: false })).toBeNull();
        expect(copyShortcutText(target('[contenteditable="true"]'), { text: 'x', isCollapsed: false })).toBeNull();
        expect(isEditableTarget(target('textarea'))).toBe(true);
        expect(isEditableTarget(target('div'))).toBe(false);
    });

    it('does nothing without a selection', () => {
        expect(copyShortcutText(target('div'), null)).toBeNull();
        expect(copyShortcutText(target('div'), { text: '', isCollapsed: false })).toBeNull();
        expect(copyShortcutText(target('div'), { text: 'x', isCollapsed: true })).toBeNull();
    });

    describe('bound to the document', () => {
        const realDoc = (globalThis as { document?: unknown }).document;
        const realGetSelection = (globalThis as { getSelection?: unknown }).getSelection;
        let posted: Array<{ type: string; text?: string }>;
        let listeners: Array<(e: unknown) => void>;

        beforeEach(() => {
            posted = [];
            listeners = [];
            (globalThis as { document?: unknown }).document = {
                addEventListener: (_t: string, cb: (e: unknown) => void) => { listeners.push(cb); },
            };
            (globalThis as { getSelection?: unknown }).getSelection = () => ({
                isCollapsed: false,
                toString: () => 'selected answer',
            });
            initCopyShortcut({ vscode: { postMessage: (m: { type: string; text?: string }) => { posted.push(m); } } } as never);
            bindCopyShortcut();
        });

        afterEach(() => {
            (globalThis as { document?: unknown }).document = realDoc;
            if (realGetSelection === undefined) { delete (globalThis as { getSelection?: unknown }).getSelection; }
            else { (globalThis as { getSelection?: unknown }).getSelection = realGetSelection; }
            vi.useRealTimers();
        });

        function press(init: Record<string, unknown>): { prevented: boolean } {
            const e = {
                key: 'c', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
                target: target('div'),
                preventDefault: () => { e.__prevented = true; },
                __prevented: false,
                ...init,
            };
            listeners.forEach((cb) => cb(e));
            return { prevented: Boolean(e.__prevented) };
        }

        it('hands the selection to the host clipboard on Cmd+C', () => {
            const { prevented } = press({ metaKey: true });
            expect(prevented).toBe(true);
            expect(posted).toEqual([{ type: 'copyText', text: 'selected answer' }]);
        });

        it('works with Ctrl+C as well', () => {
            press({ ctrlKey: true });
            expect(posted).toEqual([{ type: 'copyText', text: 'selected answer' }]);
        });

        it('ignores other chords and editable fields', () => {
            press({ metaKey: true, shiftKey: true });   // Cmd+Shift+C
            press({ metaKey: true, key: 'v' });         // Cmd+V
            press({ metaKey: true, target: target('textarea') });
            expect(posted).toEqual([]);
        });
    });
});
