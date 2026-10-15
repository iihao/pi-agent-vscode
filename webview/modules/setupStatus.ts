// ---------------------------------------------------------------------------
// First-run checklist visibility
// ---------------------------------------------------------------------------

import type { SetupStatus } from '../types';

/**
 * Whether the first-run checklist is worth showing.
 *
 * Only when something is actually wrong *and* the user can act on it. While the
 * status is merely unknown — still connecting, credentials not checked yet —
 * `connected` is false and `authReady` is undefined, and a checklist that keys
 * off those would appear and remove itself a moment later. That happens on every
 * start of a healthy setup (the common case), so the first screen flickered on
 * open: the checklist appeared with "connecting / checking" rows and vanished
 * once the detection passed.
 *
 * "Unknown" must therefore stay hidden. The connection state is already
 * communicated by the header dot, and a failure shows up as an actionable row
 * (Retry / Connect) rather than as a progress placeholder.
 */
export function needsSetupAttention(status: SetupStatus | undefined): boolean {
    if (!status) { return false; }
    if (!status.workspaceTrusted) { return true; }                 // the user can trust the workspace
    if (!status.piFound) { return true; }                          // the user can install pi
    if (!status.connected && !status.connecting) { return true; }  // an attempt finished and failed: Retry
    return status.authReady === false;                             // provider is known to have no credentials
}
