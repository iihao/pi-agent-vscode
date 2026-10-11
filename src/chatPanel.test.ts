import { describe, it, expect } from 'vitest';
import { parseEdits, isRevertible, revertEdits, buildNamePrompt, buildCommitPrompt, buildPrPrompt } from './chatPanel';

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
    });
});

describe('isRevertible', () => {
    it('is true for files created this turn', () => {
        expect(isRevertible({ rel: 'a.ts', existed: false, edits: [] })).toBe(true);
    });

    it('is false for overwritten files (write)', () => {
        expect(isRevertible({ rel: 'a.ts', existed: true, edits: null })).toBe(false);
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
