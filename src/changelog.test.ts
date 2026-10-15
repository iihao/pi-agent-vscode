// ---------------------------------------------------------------------------
// CHANGELOG structure
//
// Regression guard for a mistake made twice in this repo: new entries were
// prepended under the newest "### Fixed" heading, which after a release belongs
// to a *shipped* version — so 0.1.5's section ended up documenting changes that
// landed afterwards, while `[Unreleased]` stayed empty. Comparing the released
// sections against the tag that published them makes that impossible to miss.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

function git(args: string[]): string | undefined {
    try {
        return execFileSync('git', args, { encoding: 'utf8', cwd: repoRoot });
    } catch {
        return undefined;   // shallow clone, or git unavailable
    }
}

/**
 * The released part of a CHANGELOG: every section from `version` down to the
 * trailing link-reference list (which legitimately changes with each release).
 */
function releasedSections(md: string, version: string): string | undefined {
    const start = md.indexOf(`## [${version}]`);
    if (start < 0) { return undefined; }
    const rest = md.slice(start);
    const refs = rest.search(/\n\[[^\]]+\]:/);
    return (refs < 0 ? rest : rest.slice(0, refs)).trimEnd();
}

describe('CHANGELOG', () => {
    it('keeps released sections exactly as their tag published them', () => {
        const tag = git(['describe', '--tags', '--abbrev=0', '--match', 'v*'])?.trim();
        if (!tag) { return; }                       // no tags reachable: nothing to compare
        const releasedFile = git(['show', `${tag}:CHANGELOG.md`]);
        if (!releasedFile) { return; }
        const version = tag.replace(/^v/, '');

        const current = readFileSync(fileURLToPath(new URL('../CHANGELOG.md', import.meta.url)), 'utf8');
        expect(current).toContain(`## [${version}]`);
        // Adding an entry to a shipped version (instead of to [Unreleased]) shows up
        // here as a diff against what that tag actually published
        expect(releasedSections(current, version)).toBe(releasedSections(releasedFile, version));
    });
});
