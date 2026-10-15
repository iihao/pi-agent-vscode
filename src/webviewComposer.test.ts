// ---------------------------------------------------------------------------
// Reusing a message ("✎" on a bubble)
//
// Regression: the button puts an old message back into the composer, which used to
// throw away whatever was being typed — no notice, no way back. The draft is kept
// in the input history (↑) now, and the swap is visible because the text is
// selected.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { editMessage, initInputHandling } from '../webview/modules/inputHandling';
import { initPanels } from '../webview/modules/panels';
import { initNavigator } from '../webview/modules/navigator';
import { initImagePaste } from '../webview/modules/imagePaste';
import { initMessageRenderer } from '../webview/modules/messageRenderer';
import { initToolRenderer } from '../webview/modules/toolRenderer';
import type { WebviewContext } from '../webview/types';

function fakeEl(): Record<string, unknown> {
    const el: Record<string, unknown> = {
        classList: { add() { /* noop */ }, remove() { /* noop */ }, toggle() { /* noop */ }, contains: () => false },
        style: {},
        dataset: {},
        className: '',
        value: '',
        textContent: '',
        innerHTML: '',
        scrollHeight: 0,
        selectionStart: 0,
        selectionEnd: 0,
        querySelector: () => null,
        querySelectorAll: () => [],
        appendChild() { /* noop */ },
        remove() { /* noop */ },
        focus() { /* noop */ },
    };
    return el;
}

describe('reusing a message', () => {
    let ctx: WebviewContext & Record<string, unknown>;
    let appended: Record<string, unknown>[];
    const realDocument = (globalThis as { document?: unknown }).document;

    beforeEach(() => {
        (globalThis as { document?: unknown }).document = {
            createElement: () => fakeEl(),
            querySelector: () => null,
            querySelectorAll: () => [],
            body: fakeEl(),
            addEventListener() { /* noop */ },
        };
        appended = [];
        const chat = fakeEl();
        chat.appendChild = (el: unknown) => { appended.push(el as Record<string, unknown>); };
        ctx = {
            els: {
                input: fakeEl(),
                chat,
                welcome: fakeEl(),
                imageRow: fakeEl(),
                messageCount: fakeEl(),
                msgRail: fakeEl(),
                msgNav: fakeEl(),
                modelPanel: fakeEl(),
                thinkingPanel: fakeEl(),
                sessionPanel: fakeEl(),
                permPanel: fakeEl(),
                attachPanel: fakeEl(),
                outlinePanel: fakeEl(),
            },
            S: { messages: 'messages', draftKept: 'draft kept' },
            vscode: { postMessage: () => { /* noop */ } },
            pendingImages: [],
            messageHistory: [],
            historyIndex: -1,
            busy: false,
            railCount: 0,
        } as unknown as WebviewContext & Record<string, unknown>;
        initInputHandling(ctx);
        initPanels(ctx);
        initNavigator(ctx);
        initImagePaste(ctx);
        initMessageRenderer(ctx);
        initToolRenderer(ctx);
    });

    afterEach(() => {
        (globalThis as { document?: unknown }).document = realDocument;
    });

    const input = () => ctx.els.input as unknown as { value: string; selectionStart: number; selectionEnd: number };
    const history = () => (ctx as unknown as { messageHistory: string[] }).messageHistory;

    it('keeps the draft in the input history instead of overwriting it silently', () => {
        input().value = 'half-typed idea';

        editMessage('the old message');

        expect(input().value).toBe('the old message');
        // ↑ in the composer gets the draft back
        expect(history()).toContain('half-typed idea');
        // …and the swap is visible: the reused text is selected
        expect(input().selectionStart).toBe(0);
        expect(input().selectionEnd).toBe('the old message'.length);
        // The user is told where the draft went
        const notices = appended.filter((el) => el.className === 'status-line notice');
        expect(notices.map((el) => el.textContent)).toContain('draft kept');
    });

    it('says nothing when there was no draft to keep', () => {
        editMessage('the old message');

        expect(history()).toEqual([]);
        expect(appended.filter((el) => el.className === 'status-line notice')).toEqual([]);
    });

    it('does not duplicate the history entry when the draft is the reused text', () => {
        input().value = 'same text';

        editMessage('same text');

        expect(history()).toEqual([]);
    });
});
