// ---------------------------------------------------------------------------
// Popover hit testing
//
// Regression test: the document-level click handler closed every popover for any
// click at all, including clicks inside one — so the session panel's search input
// could not be clicked (the panel shut as soon as it was), and the refresh
// button's result was dismissed before it could be read.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { clickedInsidePopover } from '../webview/modules/popovers';

/** Minimal EventTarget stand-in: only `closest` is consulted */
function target(closestMatch: string | null): EventTarget {
    return { closest: (selector: string) => (selector === closestMatch ? { tag: 'fake' } : null) } as unknown as EventTarget;
}

describe('popover hit testing', () => {
    it('reports a click on the search input inside the session panel', () => {
        expect(clickedInsidePopover(target('.popover'))).toBe(true);
    });

    it('reports a click outside any popover', () => {
        expect(clickedInsidePopover(target(null))).toBe(false);
    });

    it('tolerates a target that cannot be matched (window, document)', () => {
        expect(clickedInsidePopover(null)).toBe(false);
        expect(clickedInsidePopover({} as unknown as EventTarget)).toBe(false);
    });
});
