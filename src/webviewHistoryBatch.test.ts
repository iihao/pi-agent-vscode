// ---------------------------------------------------------------------------
// Replay batching
//
// A replay appends hundreds or thousands of transcript items. Per item, the
// renderers used to force a scroll-to-bottom (a layout read AND write), sweep
// every `.message` for the header count, and rebuild the rail — O(n²) work for
// content nobody can see until the loop finishes. The whole replay now renders
// as one batch with a single refresh pass at the end.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHistory, initHistoryRenderer } from '../webview/modules/historyRenderer';
import { initMessageRenderer } from '../webview/modules/messageRenderer';
import { initPanels } from '../webview/modules/panels';
import { initNavigator } from '../webview/modules/navigator';
import { initToolRenderer } from '../webview/modules/toolRenderer';
import type { HistoryItem } from '../webview/types';

function fakeNode(): Record<string, unknown> {
    const node: Record<string, unknown> = {
        className: '', innerHTML: '', textContent: '',
        style: {}, dataset: {}, disabled: false, title: '',
        children: [],
        appendChild() { /* noop */ }, insertAdjacentHTML() { /* noop */ }, insertAdjacentElement() { /* noop */ },
        addEventListener() { /* noop */ }, remove() { /* noop */ },
        querySelector: () => fakeNode(), querySelectorAll: () => [],
        closest: () => null, scrollIntoView() { /* noop */ },
        getBoundingClientRect: () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }),
        classList: { add() { /* noop */ }, remove() { /* noop */ }, toggle() { /* noop */ }, contains: () => false },
    };
    return node;
}

/** A rendered message the rail/count can see: preview is pre-cached, no extraction */
function fakeRenderedMessage(preview?: string): Record<string, unknown> {
    const el = fakeNode();
    (el as { dataset: Record<string, string> }).dataset = preview !== undefined ? { preview } : {};
    return el;
}

describe('replay batching', () => {
    let scrollTopWrites: number;
    let ctx: Record<string, unknown>;
    let els: Record<string, unknown>;

    beforeEach(() => {
        scrollTopWrites = 0;
        const renderedMessages = [fakeRenderedMessage('q one'), fakeRenderedMessage('q two'), fakeRenderedMessage()];
        const chat = fakeNode();
        Object.defineProperty(chat, 'scrollTop', { get: () => 0, set: () => { scrollTopWrites++; } });
        (chat as { scrollHeight: number }).scrollHeight = 5000;
        (chat as { clientHeight: number }).clientHeight = 400; // far from bottom: a live scroll would show up
        (chat as { querySelectorAll: (s: string) => unknown[] }).querySelectorAll = (sel: string) => {
            if (sel === '.message') { return renderedMessages; }
            if (sel === '.message.user') { return renderedMessages.slice(0, 2); }
            return [];
        };

        (globalThis as { document?: unknown }).document = {
            createElement: () => fakeNode(),
            body: fakeNode(),
            querySelector: () => null,
            querySelectorAll: () => [],
            classList: { add() { /* noop */ }, remove() { /* noop */ } },
        };

        els = {
            chat,
            welcome: fakeNode(),
            messageCount: fakeNode(),
            msgNav: fakeNode(),
            msgRail: fakeNode(),
            qPrev: fakeNode(),
            qNext: fakeNode(),
            qCounter: fakeNode(),
            qCount: fakeNode(),
            qCurrent: fakeNode(),
            input: fakeNode(),
        };
        ctx = {
            els,
            S: {
                messages: 'messages', copyMsg: 'c', editMsg: 'e', deleteMsg: 'd',
                historyDivider: 'history above', historyTrimmed: 'trimmed {0}',
                thinking: 'thinking', outlineTitle: 'outline',
            },
            vscode: { postMessage() { /* noop */ } },
            busy: false,
            railCount: -1,
            runningTools: {},
            thinkingLine: null,
            thinkingContent: '',
            currentBody: null,
            currentBuffer: '',
            contexts: [],
            pendingImages: [],
        };
        initPanels(ctx as never);
        initNavigator(ctx as never);
        initToolRenderer(ctx as never);
        initMessageRenderer(ctx as never);
        initHistoryRenderer(ctx as never);
    });

    it('renders the whole replay with one scroll and one count/rail refresh', () => {
        const items: HistoryItem[] = [
            { kind: 'user', text: 'q one' },
            { kind: 'tool', tool: 'read', toolCallId: 'c1', detail: 'a.ts' },
            { kind: 'toolResult', toolCallId: 'c1', isError: false, durationMs: 5, output: 'ok' },
            { kind: 'user', text: 'q two' },
            { kind: 'assistant', text: 'a2' },
        ];

        renderHistory(items);

        // Without the batch this is one write per appended message *plus* the end
        // pass; with it, the end pass is the only scroll of the whole replay
        expect(scrollTopWrites).toBe(1);
        expect(String(els.messageCount.textContent)).toBe('3 messages');
        expect(String(els.msgRail.innerHTML)).toContain('rail-dot');
    });

    it('settles a replayed tool that never got a result', () => {
        const items: HistoryItem[] = [
            { kind: 'user', text: 'q one' },
            { kind: 'tool', tool: 'bash', toolCallId: 'hang' , detail: 'sleep 999' },
        ];

        renderHistory(items);

        // the dangling card must be removed from the running set (no spinner left
        // behind) — this also keeps the activity counter balanced for later turns
        expect((ctx.runningTools as Record<string, unknown>).hang).toBeUndefined();
    });
});
