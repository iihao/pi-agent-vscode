// ---------------------------------------------------------------------------
// Composer submission routing
//
// Regression test: `send()` dropped the message being edited (and everything
// after it) before it checked whether the text was a local slash command — so
// editing a message and typing `/model` silently deleted the rest of the
// transcript while nothing was resent.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { send, initInputHandling } from '../webview/modules/inputHandling';
import { initPanels } from '../webview/modules/panels';
import { initNavigator } from '../webview/modules/navigator';
import { initImagePaste } from '../webview/modules/imagePaste';
import { initToolRenderer } from '../webview/modules/toolRenderer';
import { initMessageRenderer } from '../webview/modules/messageRenderer';
import type { WebviewContext } from '../webview/types';

interface Posted { type: string; [k: string]: unknown }

/** Minimal element stand-in: the DOM is not what this test is about */
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
        nextElementSibling: null,
        parentElement: null,
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener() { /* noop */ },
        appendChild() { /* noop */ },
        insertBefore() { /* noop */ },
        remove() { (el.removed as number); el.removed = ((el.removed as number) || 0) + 1; },
        removed: 0,
    };
    return el;
}

describe('composer submission routing', () => {
    let posted: Posted[];
    let ctx: WebviewContext & Record<string, unknown>;
    let edited: Record<string, unknown>;
    const realDocument = (globalThis as { document?: unknown }).document;

    beforeEach(() => {
        posted = [];
        // The `!` shell route builds its activity card through document.createElement
        (globalThis as { document?: unknown }).document = {
            createElement: () => fakeEl(),
            querySelector: () => null,
            querySelectorAll: () => [],
            body: fakeEl(),
            addEventListener() { /* noop */ },
        };
        const input = fakeEl();
        edited = fakeEl();
        ctx = {
            els: {
                input,
                welcome: fakeEl(),
                imageRow: fakeEl(),
                messageCount: fakeEl(),
                msgRail: fakeEl(),
                msgNav: fakeEl(),
                chat: fakeEl(),
                modelPanel: fakeEl(),
                thinkingPanel: fakeEl(),
                sessionPanel: fakeEl(),
                permPanel: fakeEl(),
                attachPanel: fakeEl(),
                outlinePanel: fakeEl(),
            },
            S: { messages: 'messages', remove: 'Remove' },
            vscode: { postMessage: (m: Posted) => { posted.push(m); } },
            pendingImages: [],
            messageHistory: [],
            historyIndex: -1,
            editingMessageEl: null,
            busy: false,
            sendMode: 'queue',
            railCount: 0,
        } as unknown as WebviewContext & Record<string, unknown>;
        initInputHandling(ctx);
        // `send()` reaches into these while it routes the submission
        initPanels(ctx);
        initNavigator(ctx);
        initImagePaste(ctx);
        initToolRenderer(ctx);
        initMessageRenderer(ctx);
    });

    afterEach(() => {
        (globalThis as { document?: unknown }).document = realDocument;
    });

    it('leaves the transcript alone when a local command is sent while editing', () => {
        (ctx as unknown as { editingMessageEl: unknown }).editingMessageEl = edited;
        (ctx.els.input as unknown as { value: string }).value = '/model';

        send();

        // `/model` only opens the picker: nothing is resent, so nothing may be dropped
        expect(posted).toEqual([]);
        expect(edited.removed).toBe(0);
        expect((ctx as unknown as { editingMessageEl: unknown }).editingMessageEl).toBe(edited);
        expect((ctx.els.input as unknown as { value: string }).value).toBe('');
    });

    it('leaves the transcript alone when a shell command is sent while editing', () => {
        (ctx as unknown as { editingMessageEl: unknown }).editingMessageEl = edited;
        (ctx.els.input as unknown as { value: string }).value = '!ls';

        send();

        expect(posted.map((m) => m.type)).toEqual(['runBash']);
        expect(edited.removed).toBe(0);
    });

    it('still drops the message being edited when a real prompt is sent', () => {
        (ctx as unknown as { editingMessageEl: unknown }).editingMessageEl = edited;
        (ctx.els.input as unknown as { value: string }).value = 'fixed version';

        send();

        expect(edited.removed).toBe(1);
        expect((ctx as unknown as { editingMessageEl: unknown }).editingMessageEl).toBeNull();
        expect(posted).toEqual([{ type: 'sendMessage', text: 'fixed version', mode: undefined, images: undefined }]);
    });
});
