// ---------------------------------------------------------------------------
// Replaying a transcript that ends mid-tool
//
// Regression test: a session whose turn was stopped (or whose process died) can
// end in a tool call with no result. The replay rendered the card but never
// settled it, so it spun forever and kept the activity counter raised, which
// threw off the "working" indicator for the rest of the session.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHistory, initHistoryRenderer } from '../webview/modules/historyRenderer';
import { initToolRenderer } from '../webview/modules/toolRenderer';
import { initMessageRenderer } from '../webview/modules/messageRenderer';
import { initPanels } from '../webview/modules/panels';
import { initNavigator } from '../webview/modules/navigator';
import type { WebviewContext, HistoryItem } from '../webview/types';

function fakeEl(): Record<string, unknown> {
    const el: Record<string, unknown> = {
        classList: { add() { /* noop */ }, remove() { /* noop */ }, toggle() { /* noop */ }, contains: () => false },
        style: {},
        dataset: {},
        className: '',
        textContent: '',
        innerHTML: '',
        children: [],
        scrollTop: 0,
        scrollHeight: 0,
        clientHeight: 0,
        parentElement: null,
        querySelector: () => fakeEl(),
        querySelectorAll: () => [],
        addEventListener() { /* noop */ },
        appendChild() { /* noop */ },
        insertBefore() { /* noop */ },
        insertAdjacentHTML() { /* noop */ },
        remove() { /* noop */ },
    };
    return el;
}

describe('transcript replay with an unfinished tool', () => {
    let ctx: WebviewContext & Record<string, unknown>;
    const realDocument = (globalThis as { document?: unknown }).document;

    beforeEach(() => {
        // settleBoot() and the renderers touch document
        (globalThis as { document?: unknown }).document = {
            createElement: () => fakeEl(),
            querySelector: () => null,
            querySelectorAll: () => [],
            body: { classList: { add() { /* noop */ }, remove() { /* noop */ }, contains: () => false } },
            addEventListener() { /* noop */ },
        };
        ctx = {
            els: {
                chat: fakeEl(),
                welcome: fakeEl(),
                messageCount: fakeEl(),
                msgRail: fakeEl(),
                msgNav: fakeEl(),
                imageRow: fakeEl(),
            },
            S: { messages: 'messages', historyDivider: 'History above', compactedHere: 'Compacted', historyTrimmed: '{0} hidden' },
            runningTools: {},
            contextPercent: null,
            busy: false,
            thinkingLine: null,
            railCount: 0,
        } as unknown as WebviewContext & Record<string, unknown>;
        initToolRenderer(ctx);
        initMessageRenderer(ctx);
        initPanels(ctx);
        initNavigator(ctx);
        initHistoryRenderer(ctx);
    });

    afterEach(() => {
        (globalThis as { document?: unknown }).document = realDocument;
    });

    function running(): Record<string, unknown> {
        return (ctx as unknown as { runningTools: Record<string, unknown> }).runningTools;
    }

    it('settles the cards it rendered and leaves a live tool alone', () => {
        // A tool that is genuinely running while the transcript is replayed
        running().live = { el: fakeEl(), head: fakeEl(), body: fakeEl() };

        const items: HistoryItem[] = [
            { kind: 'user', text: 'hi' },
            { kind: 'tool', tool: 'bash', toolCallId: 'finished', detail: 'ls' },
            { kind: 'toolResult', toolCallId: 'finished', output: 'ok' },
            { kind: 'tool', tool: 'bash', toolCallId: 'dead', detail: 'sleep 999' },
        ];
        renderHistory(items);

        // `finished` got its result, `dead` never did: neither may keep spinning
        expect(running()).not.toHaveProperty('finished');
        expect(running()).not.toHaveProperty('dead');
        // …and a tool the replay never rendered is not closed behind its back
        expect(running()).toHaveProperty('live');
    });
});
