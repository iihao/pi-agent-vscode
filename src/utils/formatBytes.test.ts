import { describe, it, expect } from 'vitest';
import { formatBytes } from './formatBytes';

describe('formatBytes', () => {
    it('keeps values under 1024 as plain bytes', () => {
        expect(formatBytes(512)).toBe('512 B');
    });

    it('steps up to KB (1024-based)', () => {
        expect(formatBytes(1536)).toBe('1.5 KB');
    });

    it('steps up to MB', () => {
        expect(formatBytes(1572864)).toBe('1.5 MB');
    });
});
