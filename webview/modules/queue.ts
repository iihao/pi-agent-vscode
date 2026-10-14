// ---------------------------------------------------------------------------
// Queue / steer badges
// ---------------------------------------------------------------------------

import type { WebviewContext } from '../types';

let ctx: WebviewContext;

export function initQueue(c: WebviewContext): void {
    ctx = c;
}

export function clearPending(el: HTMLElement): void {
    el.removeAttribute('data-pending');
    el.removeAttribute('data-pending-text');
    const badge = el.querySelector('.pending-badge');
    if (badge) { badge.remove(); }
}

export function stripContextBlock(text: string): string {
    const marker = '--- pi-extension-context:end ---';
    const end = text.indexOf(marker);
    if (end !== -1) {
        return text.slice(end + marker.length).trimStart();
    }
    return text;
}

export function updateQueueBadges(steering?: string[], followUp?: string[]): void {
    const all = (steering || []).concat(followUp || []).map(stripContextBlock);
    ctx.els.chat.querySelectorAll('.message.user[data-pending]').forEach(function (el) {
        const raw = (el as HTMLElement).dataset.pendingText || '';
        const stillQueued = raw
            ? all.some(function (q) { return q === raw; })
            : all.length > 0;
        if (!stillQueued) { clearPending(el as HTMLElement); }
    });
}
