import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { extractMessageImages, resolvePi } from './piTypes';

describe('resolvePi', () => {
    it('finds pi on PATH (symlinked global install)', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-resolve-'));
        const pkg = path.join(root, 'pkg');
        fs.mkdirSync(path.join(pkg, 'dist'), { recursive: true });
        fs.writeFileSync(path.join(pkg, 'package.json'), '{}');
        fs.writeFileSync(path.join(pkg, 'dist', 'cli.js'), '');
        fs.writeFileSync(path.join(pkg, 'dist', 'index.js'), '');
        const binDir = path.join(root, 'bin');
        fs.mkdirSync(binDir, { recursive: true });
        fs.symlinkSync(path.join(pkg, 'dist', 'cli.js'), path.join(binDir, 'pi'));

        const original = process.env.PATH;
        process.env.PATH = binDir + path.delimiter + (original || '');
        try {
            const resolved = resolvePi(path.join(root, 'ext'));
            expect(resolved).toBeTruthy();
            expect(resolved?.cliPath.endsWith(path.join('dist', 'cli.js'))).toBe(true);
            expect(resolved?.sdkEntry.endsWith(path.join('dist', 'index.js'))).toBe(true);
            expect(fs.existsSync(resolved?.cliPath ?? '')).toBe(true);
        } finally {
            process.env.PATH = original;
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});

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
