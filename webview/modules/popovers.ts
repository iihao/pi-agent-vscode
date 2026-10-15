// ---------------------------------------------------------------------------
// Popover hit testing
// ---------------------------------------------------------------------------

/** The little of `Element` this needs, so it can be exercised without a DOM */
interface ClosestLike {
    closest(selector: string): unknown;
}

/**
 * Whether a click landed inside an open popover.
 *
 * A document-level click closes every popover, which is what makes clicking
 * outside dismiss them — but it must not fire for clicks *inside* one. The
 * session panel contains a search input (clicking it used to close the panel, so
 * it could never be typed in) and a refresh button whose refreshed list was
 * dismissed before it could be read.
 */
export function clickedInsidePopover(target: EventTarget | null): boolean {
    const el = target as ClosestLike | null;
    if (!el || typeof el.closest !== 'function') { return false; }
    return Boolean(el.closest('.popover'));
}
