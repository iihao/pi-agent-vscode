// ---------------------------------------------------------------------------
// Search extraction cache
//
// Matching every message on every keystroke used to clone the whole transcript
// into the document and read innerText — a forced layout pass per letter typed.
// Finished messages are rendered once and never change, so their lowercased
// text is cached per body node (a WeakMap drops it with the DOM); only the
// still-growing live bubble is re-extracted.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initSearch, searchMessages, messageSearchText } from '../webview/modules/search';

let cloneCount = 0;

function fakeBody(text: string, streaming: boolean): Record<string, unknown> {
    return {
        classList: { contains: (c: string) => streaming && c === 'stream-cursor' },
        cloneNode: () => {
            cloneCount++;
            return {
                querySelectorAll: () => [],
                style: {},
                innerText: text,
                remove() { /* noop */ },
            };
        },
    };
}

function fakeMessage(text: string, opts: { user?: boolean; streaming?: boolean } = {}): Record<string, unknown> {
    const body = fakeBody(text, Boolean(opts.streaming));
    return {
        style: {},
        classList: { contains: (c: string) => c === 'user' ? Boolean(opts.user) : false },
        querySelector: (sel: string) => (sel === '.message-body' ? body : null),
        scrollIntoView() { /* noop */ },
    };
}

describe('search text cache', () => {
    const realDocument = (globalThis as { document?: unknown }).document;
    let messages: Record<string, unknown>[];
    let ctx: Record<string, unknown>;

    beforeEach(() => {
        cloneCount = 0;
        (globalThis as { document?: unknown }).document = {
            body: { appendChild() { /* noop */ } },
        };
        messages = [
            fakeMessage('Hello from the user', { user: true }),
            fakeMessage('world of the assistant'),
            fakeMessage('a live hello keeps growing', { streaming: true }),
        ];
        ctx = {
            S: { noResults: 'no results' },
            els: {
                chat: {
                    scrollHeight: 100, scrollTop: 0, clientHeight: 100,
                    querySelectorAll: (sel: string) => (sel === '.message' ? messages : []),
                },
                searchResults: { textContent: '' },
            },
            searchQuery: '',
            searchMatches: [],
            searchIndex: 0,
        };
        initSearch(ctx as never);
    });

    afterEach(() => {
        (globalThis as { document?: unknown }).document = realDocument;
    });

    it('extracts each finished message once, the live one on every pass', () => {
        searchMessages('hello');
        expect((ctx.searchMatches as unknown[]).length).toBe(2);
        // two finished messages + one live bubble = 3 extractions
        expect(cloneCount).toBe(3);

        searchMessages('hello');
        // finished messages hit the cache; only the growing bubble is re-read
        expect(cloneCount).toBe(4);
        expect((ctx.searchMatches as unknown[]).length).toBe(2);
    });

    it('matches case-insensitively from cached lowercase text', () => {
        searchMessages('WORLD');
        const matches = ctx.searchMatches as Array<{ role: string }>;
        expect(matches.length).toBe(1);
        expect(matches[0].role).toBe('assistant');
    });

    it('messageSearchText returns the lowercased body text', () => {
        expect(messageSearchText(messages[0] as never)).toBe('hello from the user');
    });
});
