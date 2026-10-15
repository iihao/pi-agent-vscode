// ---------------------------------------------------------------------------
// Boot state
//
// Being useful before the session is known is impossible: pi has to be started
// and its transcript read from disk first (~1s). What the panel shows in the
// meantime must not contradict what comes next, so while the transcript state is
// unknown the empty state shows only its identity — the logo and title, placed
// exactly where they end up. The quick actions and shortcut hints are revealed
// once we know the session is empty; a session that has history simply replaces
// the (barely-there) identity with its transcript, instead of flashing a full
// welcome screen first.
// ---------------------------------------------------------------------------

/** Mark the transcript state as unknown (view opened, transcript cleared/rebuilt) */
export function enterBoot(): void {
    document.body.classList.add('booting');
}

/** Mark the transcript state as known (dropped the boot class; safe to call repeatedly) */
export function settleBoot(): void {
    document.body.classList.remove('booting');
}
