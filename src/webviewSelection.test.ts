// ---------------------------------------------------------------------------
// Copying text out of a live message
//
// The typewriter re-renders the streaming bubble's innerHTML every ~50ms. That
// destroyed any DOM selection inside it — so selecting part of an answer and
// pressing Ctrl/Cmd+C copied nothing, and losing the focused text node dropped
// focus back to the page (which in the webview lands on the composer). Renders
// now wait for the selection to be released, and so does the final formatted
// pass at the end of the stream.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { hasSelectionInside, flushDeferredFinals } from '../webview/modules/messageRenderer';
import { initMessageRenderer, startAssistantStream, appendAssistantChunk, endAssistantStream } from '../webview/modules/messageRenderer';
import { initPanels } from '../webview/modules/panels';
import { initNavigator } from '../webview/modules/navigator';

interface FakeSel {
    rangeCount: number;
    isCollapsed: boolean;
    toString(): string;
    getRangeAt(i: number): { commonAncestorContainer: unknown };
}

function installSelection(sel: FakeSel | undefined): void {
    (globalThis as { getSelection?: () => FakeSel | undefined }).getSelection = () => sel;
}

function fakeBody() {
    const body: Record<string, unknown> & { innerHTML: string } = {
        innerHTML: '',
        classList: { add() { /* noop */ }, remove() { /* noop */ }, contains: () => true },
        isConnected: true,
        contains: (node: unknown) => node === inside,
    };
    return body;
}

const inside = { id: 'inside' };
const outside = { id: 'outside' };

describe('selection-aware rendering', () => {
    let body: ReturnType<typeof fakeBody>;
    let ctx: Record<string, unknown>;
    const realDoc = (globalThis as { document?: unknown }).document;
    const realGetSelection = (globalThis as { getSelection?: unknown }).getSelection;
    const realRaf = (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame;

    beforeEach(() => {
        // No frame is ever run: this test is about the end-of-stream path
        (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = () => 1;
        (globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = () => { /* noop */ };
        body = fakeBody();
        (globalThis as { document?: unknown }).document = {
            addEventListener() { /* noop */ },
            removeEventListener() { /* noop */ },
            contains: () => true,
            createElement: () => ({ classList: { add() { /* noop */ }, remove() { /* noop */ } }, dataset: {}, style: {}, appendChild() { /* noop */ }, querySelector: () => null, querySelectorAll: () => [] }),
        };
        ctx = {
            els: {
                chat: {
                    appendChild() { /* noop */ },
                    scrollHeight: 100, scrollTop: 0, clientHeight: 100,
                    querySelector: () => null,
                    querySelectorAll: () => [],
                },
                welcome: { style: {} },
                messageCount: { textContent: '' },
                msgRail: { innerHTML: '', classList: { add() { /* noop */ }, remove() { /* noop */ }, toggle() { /* noop */ }, contains: () => false } },
                qPrev: { disabled: false },
                qNext: { disabled: false },
                qCount: { textContent: '' },
                qCurrent: { textContent: '' },
                qCounter: { title: '' },
                msgNav: { classList: { toggle() { /* noop */ }, add() { /* noop */ }, remove() { /* noop */ } } },
            },
            S: { copyMsg: 'c', editMsg: 'e', deleteMsg: 'd', messages: 'messages', thinking: 't' },
            busy: false,
            railCount: -1,
        };
        initMessageRenderer(ctx as never);
        // addMessage refreshes the header count and the question rail
        initPanels(ctx as never);
        initNavigator(ctx as never);
    });

    afterEach(() => {
        (globalThis as { document?: unknown }).document = realDoc;
        if (realGetSelection === undefined) { delete (globalThis as { getSelection?: unknown }).getSelection; }
        else { (globalThis as { getSelection?: unknown }).getSelection = realGetSelection; }
        if (realRaf === undefined) { delete (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame; }
        else { (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = realRaf; }
    });

    it('detects a non-empty selection inside the element', () => {
        installSelection({ rangeCount: 1, isCollapsed: false, toString: () => 'copied text', getRangeAt: () => ({ commonAncestorContainer: inside }) });
        expect(hasSelectionInside(body as unknown as HTMLElement)).toBe(true);

        installSelection({ rangeCount: 1, isCollapsed: false, toString: () => 'other', getRangeAt: () => ({ commonAncestorContainer: outside }) });
        expect(hasSelectionInside(body as unknown as HTMLElement)).toBe(false);
    });

    it('treats a collapsed or empty selection as free', () => {
        installSelection({ rangeCount: 1, isCollapsed: true, toString: () => '', getRangeAt: () => ({ commonAncestorContainer: inside }) });
        expect(hasSelectionInside(body as unknown as HTMLElement)).toBe(false);
        installSelection({ rangeCount: 0, isCollapsed: false, toString: () => '', getRangeAt: () => ({ commonAncestorContainer: inside }) });
        expect(hasSelectionInside(body as unknown as HTMLElement)).toBe(false);
        installSelection(undefined);
        expect(hasSelectionInside(body as unknown as HTMLElement)).toBe(false);
    });

    it('defers the final formatted render while text inside the bubble is selected', () => {
        // The live bubble is the one addMessage created in the fake chat
        const classes = new Set<string>();
        const live = {
            innerHTML: '',
            classList: {
                add: (c: string) => { classes.add(c); },
                remove: (c: string) => { classes.delete(c); },
                contains: (c: string) => classes.has(c),
            },
            contains: (n: unknown) => n === inside,
            // addMessage() returns el.querySelector('.message-body'); returning the
            // same node keeps the assertions on the bubble itself
            querySelector: () => live,
            querySelectorAll: () => [],
            appendChild() { /* noop */ },
            insertAdjacentHTML() { /* noop */ },
        };
        (ctx.els.chat as { appendChild: (n: unknown) => void }).appendChild = (node: unknown) => { (ctx as { appended?: unknown }).appended = node; };
        (globalThis as { document?: { createElement: () => unknown } }).document = Object.assign(
            (globalThis as { document: { createElement: () => unknown } }).document,
            { createElement: () => live },
        );

        startAssistantStream();
        appendAssistantChunk('hello world');
        const before = live.innerHTML;

        installSelection({ rangeCount: 1, isCollapsed: false, toString: () => 'hello', getRangeAt: () => ({ commonAncestorContainer: inside }) });
        endAssistantStream();

        // Still the streamed content: the highlighted re-render waits for the copy
        expect(live.innerHTML).toBe(before);
        expect(live.innerHTML).not.toContain('hello world');
        expect(live.classList.contains('stream-cursor')).toBe(true);

        // Selection released -> the pending final render lands
        installSelection({ rangeCount: 1, isCollapsed: true, toString: () => '', getRangeAt: () => ({ commonAncestorContainer: inside }) });
        flushDeferredFinals();
        expect(live.innerHTML).toContain('hello world');
        expect(live.classList.contains('stream-cursor')).toBe(false);
    });
});
