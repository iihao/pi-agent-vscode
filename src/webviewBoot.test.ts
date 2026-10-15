// ---------------------------------------------------------------------------
// Boot state
//
// While the transcript state is unknown (the view just opened, or the transcript
// is being rebuilt from disk) the empty state must show only its identity. If
// that is not the case the first paint is the full welcome screen, which is then
// replaced by the transcript a moment later — the flash this state exists to
// avoid. The checklist is the exception: it only appears when the user has
// something to act on, which is worth interrupting the boot for.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const css = read('../webview/styles.css');
const shell = read('../src/views/webviewTemplate.ts');

/** Body of the `body.booting …` rules as one string */
function bootRule(): string {
    const match = css.match(/body\.booting[^{]*\{[^}]*\}/g);
    return (match || []).join('\n');
}

describe('boot state', () => {
    it('starts in the boot state, so the first paint is not a full welcome screen', () => {
        expect(shell).toMatch(/<body[^>]*class="booting"/);
    });

    it('hides the empty state beyond the logo and title while booting', () => {
        const rule = bootRule();
        expect(rule).toContain('.quick-actions');
        expect(rule).toContain('.welcome-shortcuts');
    });

    it('keeps the setup checklist visible while booting', () => {
        // It only shows when the user must act (see setupStatus.ts); hiding it here
        // would leave a booting panel with no way to fix what is broken.
        expect(bootRule()).not.toContain('.welcome-setup');
    });
});
