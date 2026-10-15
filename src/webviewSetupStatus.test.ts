// ---------------------------------------------------------------------------
// First-run checklist visibility
//
// Regression test: the checklist keyed off `connected`/`authReady` directly, so
// while those were merely unknown (still connecting, credentials not checked
// yet) it rendered its "connecting / checking" rows and then removed itself once
// the detection passed. On a healthy setup that is every start, and it showed up
// as the first screen flickering.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { needsSetupAttention } from '../webview/modules/setupStatus';
import type { SetupStatus } from './chatPanel/sharedTypes';

const healthy: SetupStatus = {
    connecting: false,
    connected: true,
    piFound: true,
    hasModels: true,
    workspaceTrusted: true,
    authReady: true,
};

describe('first-run checklist visibility', () => {
    it('stays hidden on a healthy setup', () => {
        expect(needsSetupAttention(healthy)).toBe(false);
    });

    it('stays hidden while connecting (the startup flicker)', () => {
        expect(needsSetupAttention({ ...healthy, connected: false, connecting: true, authReady: undefined })).toBe(false);
    });

    it('stays hidden while the credential check is still running', () => {
        expect(needsSetupAttention({ ...healthy, authReady: undefined })).toBe(false);
    });

    it('stays hidden when there is no status yet', () => {
        expect(needsSetupAttention(undefined)).toBe(false);
    });

    it('shows when the workspace is not trusted', () => {
        expect(needsSetupAttention({ ...healthy, workspaceTrusted: false })).toBe(true);
    });

    it('shows when pi is not installed', () => {
        expect(needsSetupAttention({ ...healthy, connected: false, piFound: false })).toBe(true);
    });

    it('shows when a connection attempt finished and failed', () => {
        expect(needsSetupAttention({ ...healthy, connected: false, connecting: false })).toBe(true);
    });

    it('shows when the provider is known to have no credentials', () => {
        expect(needsSetupAttention({ ...healthy, authReady: false, authReason: 'credentials_not_configured' })).toBe(true);
    });
});
