import { describe, it, expect } from 'vitest';
import { buildContextBlock, contextRef, stripContextBlock, parseContextRefs } from './context';

describe('contextRef', () => {
    it('renders a file as @path', () => {
        expect(contextRef({ type: 'file', path: 'src/cart.ts' })).toBe('@src/cart.ts');
    });

    it('renders a selection with its line range', () => {
        expect(contextRef({ type: 'selection', path: 'src/cart.ts', lineRange: '12-30' })).toBe('@src/cart.ts:12-30');
    });

    it('falls back to a plain path when a selection has no range', () => {
        expect(contextRef({ type: 'selection', path: 'src/cart.ts' })).toBe('@src/cart.ts');
    });
});

describe('buildContextBlock', () => {
    it('returns the text unchanged when there is no context', () => {
        expect(buildContextBlock([], 'hello')).toBe('hello');
    });

    it('wraps references in a marked block before the text', () => {
        const out = buildContextBlock(
            [{ type: 'file', path: 'src/a.ts' }, { type: 'selection', path: 'src/b.ts', lineRange: '3-9' }],
            'Why?'
        );
        expect(out).toContain('--- pi-extension-context:start ---');
        expect(out).toContain('<file-context>\n@src/a.ts\n@src/b.ts:3-9\n</file-context>');
        expect(out.endsWith('--- pi-extension-context:end ---\n\nWhy?')).toBe(true);
    });

    it('includes extra blocks (auto context) even without file refs', () => {
        const out = buildContextBlock([], 'Do it', ['<git-context>\nBranch: main\n</git-context>']);
        expect(out).toContain('<git-context>\nBranch: main\n</git-context>');
        expect(out.endsWith('--- pi-extension-context:end ---\n\nDo it')).toBe(true);
    });
});

describe('stripContextBlock', () => {
    it('removes the context block and keeps the user text', () => {
        const wrapped = buildContextBlock([{ type: 'file', path: 'src/a.ts' }], 'Why does it fail?');
        expect(stripContextBlock(wrapped)).toBe('Why does it fail?');
    });

    it('leaves plain text untouched', () => {
        expect(stripContextBlock('plain')).toBe('plain');
    });
});

describe('parseContextRefs', () => {
    it('parses file and selection refs back out of a context block', () => {
        const wrapped = buildContextBlock(
            [{ type: 'file', path: 'src/a.ts' }, { type: 'selection', path: 'src/b.ts', lineRange: '3-9' }],
            'Why?'
        );
        expect(parseContextRefs(wrapped)).toEqual([
            { type: 'file', path: 'src/a.ts' },
            { type: 'selection', path: 'src/b.ts', lineRange: '3-9' },
        ]);
    });

    it('treats a trailing single line number as a selection', () => {
        const wrapped = buildContextBlock([{ type: 'selection', path: 'src/a.ts', lineRange: '7' }], 'x');
        expect(parseContextRefs(wrapped)).toEqual([{ type: 'selection', path: 'src/a.ts', lineRange: '7' }]);
    });

    it('returns [] when there is no context block', () => {
        expect(parseContextRefs('plain text')).toEqual([]);
    });

    it('ignores a context block with no file refs', () => {
        expect(parseContextRefs(buildContextBlock([], 'x', ['<git-context>\nBranch: main\n</git-context>']))).toEqual([]);
    });

    it('de-duplicates repeated refs', () => {
        const text = '--- pi-extension-context:start ---\n<file-context>\n@src/a.ts\n@src/a.ts\n</file-context>\n--- pi-extension-context:end ---\n\nx';
        expect(parseContextRefs(text)).toEqual([{ type: 'file', path: 'src/a.ts' }]);
    });
});
