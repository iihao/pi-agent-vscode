// ---------------------------------------------------------------------------
// Message times in the transcript
//
// A replayed history used to be stamped with the moment it was rendered, so the
// whole conversation (days apart) looked like it happened just now. pi records a
// timestamp per entry, the host passes it through, and the view shows it — plus a
// divider whenever the calendar day changes.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { formatMessageTime, formatMessageDay, messageDay } from '../webview/utils';
import { addMessage, initMessageRenderer, resetDates } from '../webview/modules/messageRenderer';
import { initPanels } from '../webview/modules/panels';
import { initNavigator } from '../webview/modules/navigator';
import type { WebviewContext } from '../webview/types';

function fakeEl(): Record<string, unknown> {
    const el: Record<string, unknown> = {
        classList: { add() { /* noop */ }, remove() { /* noop */ }, toggle() { /* noop */ }, contains: () => false },
        style: {},
        dataset: {},
        className: '',
        textContent: '',
        innerHTML: '',
        scrollTop: 0,
        scrollHeight: 0,
        clientHeight: 0,
        querySelector: () => fakeEl(),
        querySelectorAll: () => [],
        appendChild() { /* noop */ },
        insertAdjacentHTML() { /* noop */ },
        remove() { /* noop */ },
    };
    return el;
}

const clock = (iso: string): string => {
    const d = new Date(iso);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
};

describe('message times', () => {
    it('uses the message\'s own timestamp, not the current clock', () => {
        const iso = '2026-10-15T06:44:56.000Z';
        expect(formatMessageTime(iso)).toBe(clock(iso));
    });

    it('falls back to now when pi did not record a time', () => {
        expect(formatMessageTime(undefined)).toMatch(/^\d{2}:\d{2}$/);
        expect(formatMessageTime('not a date')).toMatch(/^\d{2}:\d{2}$/);
    });

    it('groups timestamps by their local calendar day', () => {
        // Same instant, written differently: one local day
        expect(messageDay('2026-10-15T02:00:00.000Z')).toBe(messageDay('2026-10-15T02:00:00Z'));
        // 48 hours apart: never the same local day, whatever the offset
        expect(messageDay('2026-10-15T02:00:00.000Z')).not.toBe(messageDay('2026-10-17T02:00:00.000Z'));
        expect(formatMessageDay('2026-10-15T02:00:00.000Z')).toContain('2026');
    });
});

describe('date dividers', () => {
    let appended: Record<string, unknown>[];
    let ctx: WebviewContext & Record<string, unknown>;
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
            els: { chat, welcome: fakeEl(), messageCount: fakeEl(), msgRail: fakeEl(), msgNav: fakeEl() },
            S: { messages: 'messages', draftKept: 'draft kept' },
            railCount: 0,
            busy: false,
        } as unknown as WebviewContext & Record<string, unknown>;
        initMessageRenderer(ctx);
        initPanels(ctx);
        initNavigator(ctx);
        resetDates();
    });

    afterEach(() => {
        resetDates();
        (globalThis as { document?: unknown }).document = realDocument;
    });

    const dividers = () => appended.filter((el) => el.className === 'date-divider');

    it('opens a divider when the day changes and shows each message\'s own time', () => {
        const day1 = '2026-10-15T06:44:56.000Z';
        const day3 = '2026-10-17T06:44:56.000Z';

        addMessage('user', 'first', false, undefined, undefined, undefined, day1);
        addMessage('assistant', 'answer', false, undefined, undefined, undefined, day1);
        addMessage('user', 'later', false, undefined, undefined, undefined, day3);

        // One divider per day, not per message
        expect(dividers()).toHaveLength(2);
        expect(dividers()[0].textContent).toBe(formatMessageDay(day1));
        expect(dividers()[1].textContent).toBe(formatMessageDay(day3));
        // …and the bubbles carry the recorded time rather than "now"
        const bubbles = appended.filter((el) => el.className !== 'date-divider');
        expect(String(bubbles[0].innerHTML)).toContain(clock(day1));
        expect(String(bubbles[2].innerHTML)).toContain(clock(day3));
    });

    it('does not open a divider for a live message that has no timestamp', () => {
        addMessage('assistant', 'streamed now');
        expect(dividers()).toHaveLength(0);
    });

    it('starts fresh after a clear, so the next replay opens its own divider', () => {
        addMessage('user', 'a', false, undefined, undefined, undefined, '2026-10-15T06:44:56.000Z');
        expect(dividers()).toHaveLength(1);

        // clear() resets the transcript and the divider state with it
        resetDates();
        addMessage('user', 'b', false, undefined, undefined, undefined, '2026-10-15T07:00:00.000Z');
        expect(dividers()).toHaveLength(2);
    });
});
