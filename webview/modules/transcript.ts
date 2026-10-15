// ---------------------------------------------------------------------------
// Transcript DOM
// ---------------------------------------------------------------------------

/**
 * Remove everything the transcript rendered, keeping the empty state.
 *
 * Deliberately sweeps the container's children instead of listing classes to
 * remove: the old selector list missed the tool-group wrapper, so its (now
 * empty) "Bash, Read …" box was carried over into the next session — visible,
 * expandable, and useless. A class list also has to be updated by hand for
 * every new renderer, which is exactly how that happened.
 */
export function clearTranscript(container: HTMLElement): void {
    for (const child of Array.from(container.children)) {
        if (child.id !== 'welcome') { child.remove(); }
    }
}
