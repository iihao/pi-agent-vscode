import { describe, it, expect } from 'vitest';
import { parseEdits, isRevertible, revertEdits, revertEditsDetailed, editsToDiff, lineDiff } from './chatPanel/turnChanges';
import { buildNamePrompt, buildCommitPrompt, buildPrPrompt } from './chatPanel/prompts';

describe('revertEdits', () => {
    it('reverses non-overlapping edits back to the original', () => {
        const original = 'const a = 1;\nconst b = 2;\n';
        const edits = [
            { oldText: 'const a = 1;', newText: 'const a = 10;' },
            { oldText: 'const b = 2;', newText: 'const b = 20;' },
        ];
        const after = 'const a = 10;\nconst b = 20;\n';
        expect(revertEdits(after, edits)).toBe(original);
    });

    it('returns null when the edited text is no longer present', () => {
        expect(revertEdits('nothing here', [{ oldText: 'x', newText: 'y' }])).toBeNull();
        expect(revertEditsDetailed('nothing here', [{ oldText: 'x', newText: 'y' }]))
            .toEqual({ ok: false, reason: 'missing' });
    });

    it('refuses instead of guessing when the replaced text occurs in several places', () => {
        // The edit produced line 2; line 1 already held the same text before the
        // turn. A first-occurrence guess would rewrite line 1 — the wrong place —
        // and the file would look "reverted" while still containing the change.
        const content = 'let y = 42; // pre-existing\nlet y = 42; // from the edit\n';
        const edits = [{ oldText: 'let x = seed;', newText: 'let y = 42;' }];

        expect(revertEdits(content, edits)).toBeNull();
        expect(revertEditsDetailed(content, edits)).toEqual({ ok: false, reason: 'ambiguous' });
    });

    it('refuses an empty newText instead of prepending oldText', () => {
        // indexOf('') is 0: the old implementation prepended oldText and
        // duplicated the whole file (isRevertible keeps this out of the button,
        // but the helper is exported and was silently wrong on its own)
        expect(revertEdits('abc', [{ oldText: 'x', newText: '' }])).toBeNull();
        expect(revertEditsDetailed('abc', [{ oldText: 'x', newText: '' }]))
            .toEqual({ ok: false, reason: 'missing' });
    });

    it('stays inside its search budget when the text is duplicated everywhere', () => {
        const content = 'hit\n'.repeat(60);
        const edits = [1, 2, 3, 4].map((n) => ({ oldText: 'A' + n, newText: 'hit' }));
        // 60^4 combinations: must come back as "ambiguous", promptly, not explore
        expect(revertEditsDetailed(content, edits)).toEqual({ ok: false, reason: 'ambiguous' });
    });
});

describe('isRevertible', () => {
    it('is true for files created this turn', () => {
        expect(isRevertible({ rel: 'a.ts', existed: false, edits: [] })).toBe(true);
    });

    it('is false for overwritten files (write) without a snapshot', () => {
        expect(isRevertible({ rel: 'a.ts', existed: true, edits: null })).toBe(false);
    });

    it('is true for overwritten files when we have a pre-turn snapshot', () => {
        expect(isRevertible({ rel: 'a.ts', existed: true, edits: null, before: 'old' })).toBe(true);
    });

    it('is false when an edit removes text (empty newText)', () => {
        expect(isRevertible({ rel: 'a.ts', existed: true, edits: [{ oldText: 'x', newText: '' }] })).toBe(false);
    });

    it('is true for pure edits', () => {
        expect(isRevertible({ rel: 'a.ts', existed: true, edits: [{ oldText: 'x', newText: 'y' }] })).toBe(true);
    });
});

describe('parseEdits', () => {
    it('keeps valid pairs and ignores malformed entries', () => {
        expect(parseEdits({ edits: [{ oldText: 'a', newText: 'b' }, { oldText: 1 }, null, 'x'] }))
            .toEqual([{ oldText: 'a', newText: 'b' }]);
    });

    it('returns [] for missing or non-array edits', () => {
        expect(parseEdits(undefined)).toEqual([]);
        expect(parseEdits({ edits: 'nope' })).toEqual([]);
    });
});

describe('editsToDiff', () => {
    it('renders old lines as - and new lines as +', () => {
        expect(editsToDiff([{ oldText: 'a\nb', newText: 'c' }])).toBe('-a\n-b\n+c');
    });

    it('truncates very long diffs with a marker', () => {
        const big = [{ oldText: 'x\n'.repeat(80), newText: 'y' }];
        const out = editsToDiff(big, 10);
        expect(out.split('\n').length).toBe(11);
        expect(out).toContain('more lines');
    });
});

describe('lineDiff', () => {
    it('keeps common lines as context and marks the change', () => {
        const out = lineDiff('a\nb\nc', 'a\nB\nc');
        expect(out).toBe(' a\n-b\n+B\n c');
    });

    it('treats an empty before as all additions (new file)', () => {
        expect(lineDiff('', 'x\ny')).toBe('+x\n+y');
    });

    it('truncates very long diffs', () => {
        const out = lineDiff('', Array.from({ length: 300 }, (_, i) => 'l' + i).join('\n'), 20);
        expect(out.split('\n').length).toBe(21);
        expect(out).toContain('more lines');
    });
});

describe('prompt builders', () => {
    it('buildNamePrompt asks for a short title and includes the request', () => {
        const p = buildNamePrompt('fix the parser please');
        expect(p).toContain('fix the parser please');
        expect(p.toLowerCase()).toContain('title');
    });

    it('buildCommitPrompt includes the branch, diff and Conventional Commits hint', () => {
        const p = buildCommitPrompt('--- a\n+++ b\n', 'main');
        expect(p).toContain('main');
        expect(p).toContain('Conventional Commits');
        expect(p).toContain('```diff');
    });

    it('buildPrPrompt includes the commit log', () => {
        expect(buildPrPrompt('feat/x', '- add thing')).toContain('- add thing');
    });
});
