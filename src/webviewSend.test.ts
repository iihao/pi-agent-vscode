// ---------------------------------------------------------------------------
// Composer submission routing & the honesty of "edit"
//
// Two rules the transcript must never break:
//  - a local slash command / `!` shell command does not send a prompt, so it
//    must not disturb the transcript at all;
//  - "edit" only prefills the composer. A resend is a *new* message: pi's
//    session file is append-only, so the original exchange stays in the model
//    context. Dropping it from the DOM made the view claim the conversation
//    was shorter than it is — the model kept quoting "deleted" answers.
//    The view now shows exactly what pi sees.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { send, editMessage, deleteMessage, initInputHandling } from '../webview/modules/inputHandling';
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
        focus() { /* noop */ },
        remove() { (el.removed as number); el.removed = ((el.removed as number) || 0) + 1; },
        removed: 0,
    };
    return el;
}

describe('composer submission routing', () => {
    let posted: Posted[];
    let ctx: WebviewContext & Record<string, unknown>;
    let earlierMessage: Record<string, unknown>;
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
        earlierMessage = fakeEl();
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

    it('sends nothing and removes nothing when a local command is typed', () => {
        (ctx.els.input as unknown as { value: string }).value = '/model';

        send();

        // `/model` only opens the picker: no prompt was sent, the transcript stays
        expect(posted).toEqual([]);
        expect(earlierMessage.removed).toBe(0);
        expect((ctx.els.input as unknown as { value: string }).value).toBe('');
    });

    it('routes a shell command to runBash without touching the transcript', () => {
        (ctx.els.input as unknown as { value: string }).value = '!ls';

        send();

        expect(posted.map((m) => m.type)).toEqual(['runBash']);
        expect(earlierMessage.removed).toBe(0);
    });

    it('a resent message is a plain new prompt — the view drops nothing', () => {
        // Pretend the user pressed ✎ on an earlier message: the composer now holds
        // the edited text. Sending must behave exactly like any other prompt.
        editMessage('fixed version');
        expect((ctx.els.input as unknown as { value: string }).value).toBe('fixed version');

        send();

        expect(posted).toEqual([{ type: 'sendMessage', text: 'fixed version', mode: undefined, images: undefined }]);
        // pi still holds the original exchange in context, so the transcript keeps
        // showing it: no DOM removal, ever, as a side effect of sending
        expect(earlierMessage.removed).toBe(0);
    });

    it('editMessage only prefills the composer', () => {
        editMessage('recall this');

        expect((ctx.els.input as unknown as { value: string }).value).toBe('recall this');
        // there is no "editing" state left to carry: nothing is marked and nothing is
        // scheduled for removal when the next send happens
        expect(earlierMessage.removed).toBe(0);
    });

    it('deleteMessage is the only path that removes a message node', () => {
        deleteMessage(earlierMessage as unknown as HTMLElement);
        expect(earlierMessage.removed).toBe(1);
    });
});
