// ---------------------------------------------------------------------------
// Queue / steer badges
// ---------------------------------------------------------------------------

import type { WebviewContext } from '../types';
// The host builds the context block, so it owns how to strip it again. Its module is
// dependency-free on purpose, so the webview can share the one implementation
// instead of keeping a copy of the marker strings in step by hand.
import { stripContextBlock } from '../../src/utils/context';

let ctx: WebviewContext;

export function initQueue(c: WebviewContext): void {
    ctx = c;
}

/**
 * Which pending messages pi still holds in its queue.
 *
 * Matched by text in order, each queue entry counting once — a message that is
 * images only has no text to match on, so it takes the next unconsumed entry
 * rather than keeping every pending badge alive as soon as anything is queued.
 */
export function pendingStillQueued(pendingTexts: string[], queued: string[]): boolean[] {
    const used = queued.map(() => false);
    const stillQueued = pendingTexts.map(() => false);
    // Text matches first. They are unambiguous, and a text-less (images-only) bubble
    // taking the front of the queue would steal the slot a named message needs.
    pendingTexts.forEach(function (text, i) {
        if (!text) { return; }
        const index = queued.findIndex((q, j) => !used[j] && q === text);
        if (index >= 0) { used[index] = true; stillQueued[i] = true; }
    });
    // Whatever is left over belongs to the text-less bubbles, in order
    pendingTexts.forEach(function (text, i) {
        if (text || stillQueued[i]) { return; }
        const index = used.findIndex((u) => !u);
        if (index >= 0) { used[index] = true; stillQueued[i] = true; }
    });
    return stillQueued;
}

export function clearPending(el: HTMLElement): void {
    el.removeAttribute('data-pending');
    el.removeAttribute('data-pending-text');
    const badge = el.querySelector('.pending-badge');
    if (badge) { badge.remove(); }
}

export function updateQueueBadges(steering?: string[], followUp?: string[]): void {
    const queued = (steering || []).concat(followUp || []).map(stripContextBlock);
    const pending = Array.from(ctx.els.chat.querySelectorAll('.message.user[data-pending]')) as HTMLElement[];
    const stillQueued = pendingStillQueued(
        pending.map((el) => el.dataset.pendingText || ''),
        queued,
    );
    pending.forEach(function (el, i) {
        if (!stillQueued[i]) { clearPending(el); }
    });
}
