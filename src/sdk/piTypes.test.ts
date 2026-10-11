import { describe, it, expect } from 'vitest';
import { extractMessageImages } from './piTypes';

describe('extractMessageImages', () => {
    it('returns image blocks from array content', () => {
        expect(extractMessageImages({
            role: 'user',
            content: [
                { type: 'text', text: 'look at this' },
                { type: 'image', data: 'AAA', mimeType: 'image/png' },
            ],
        })).toEqual([{ data: 'AAA', mimeType: 'image/png' }]);
    });

    it('ignores non-image blocks and string content', () => {
        expect(extractMessageImages({ role: 'user', content: 'plain' })).toEqual([]);
        expect(extractMessageImages({ role: 'assistant', content: [{ type: 'text', text: 'x' }] })).toEqual([]);
    });

    it('drops image blocks without data', () => {
        expect(extractMessageImages({ content: [{ type: 'image', mimeType: 'image/png' }] })).toEqual([]);
    });
});
