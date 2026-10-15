import { describe, it, expect } from 'vitest';
import { formatUsage, validateMessage, summarizeToolArgs, extractToolOutput } from './formatters';
import { MAX_MESSAGE_CHARS } from '../chatPanel/sharedTypes';

describe('formatUsage', () => {
    it('formats input / output / cache read', () => {
        expect(formatUsage({ input: 1500, output: 200, cacheRead: 1000 }))
            .toBe('Input 1,500 / Output 200 / Cache hit 1,000');
    });

    it('omits zero/undefined fields', () => {
        expect(formatUsage({})).toBe('');
        expect(formatUsage({ output: 5 })).toBe('Output 5');
    });
});

describe('validateMessage', () => {
    it('rejects empty or whitespace', () => {
        expect(validateMessage('').valid).toBe(false);
        expect(validateMessage('   ').valid).toBe(false);
    });

    it('rejects overly long messages', () => {
        expect(validateMessage('x'.repeat(MAX_MESSAGE_CHARS + 1)).valid).toBe(false);
        // boundary is the shared constant the webview pre-check also uses — one number, both sides
        expect(validateMessage('x'.repeat(MAX_MESSAGE_CHARS)).valid).toBe(true);
    });

    it('accepts normal messages', () => {
        expect(validateMessage('hello').valid).toBe(true);
    });
});

describe('summarizeToolArgs', () => {
    it('prefers a path argument', () => {
        expect(summarizeToolArgs({ path: 'a/b.ts' })).toBe('a/b.ts');
    });

    it('truncates long commands', () => {
        const out = summarizeToolArgs({ command: 'x'.repeat(200) });
        expect(out.length).toBeLessThanOrEqual(91);
        expect(out.endsWith('…')).toBe(true);
    });

    it('handles non-object input', () => {
        expect(summarizeToolArgs(undefined)).toBe('');
    });
});

describe('extractToolOutput', () => {
    it('joins text blocks', () => {
        expect(extractToolOutput({ content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }))
            .toBe('a\nb');
    });

    it('handles string content', () => {
        expect(extractToolOutput({ content: 'raw output' })).toBe('raw output');
    });

    it('returns empty for missing result', () => {
        expect(extractToolOutput(undefined)).toBe('');
    });

    it('truncates output with a notice when it exceeds the cap', () => {
        // Pass the cap explicitly to verify "truncate only when actually over the cap, and always say so"
        const out = extractToolOutput({ content: [{ type: 'text', text: 'x'.repeat(2500) }] }, 1000);
        expect(out).toContain('output truncated');
        expect(out.length).toBeLessThan(1100);
    });

    it('keeps realistically long tool output intact (no second truncation)', () => {
        // The longest tool output is ~50k chars: the extension must not truncate again and lose content
        const text = 'x'.repeat(60000);
        expect(extractToolOutput({ content: [{ type: 'text', text }] })).toBe(text);
    });
});
