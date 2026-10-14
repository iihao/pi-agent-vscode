import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// l10n regression: every `vscode.l10n.t('...')` literal in the source must exist in
// both l10n/bundle.l10n.json (English baseline) and l10n/bundle.l10n.zh-cn.json
// (Chinese), otherwise the Chinese UI leaks English. This test catches new strings
// that were added without a translation.

function decode(raw: string): string {
    return raw
        .replace(/\\u([0-9a-fA-F]{4})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)))
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\'/g, "'")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
}

function collectSources(dir: string, acc: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { collectSources(full, acc); }
        else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) { acc.push(full); }
    }
    return acc;
}

function extractTStrings(root: string): Set<string> {
    const out = new Set<string>();
    const re = /\bt\(\s*'((?:[^'\\]|\\.)*)'/g;
    for (const file of collectSources(path.join(root, 'src'))) {
        const src = fs.readFileSync(file, 'utf8');
        let m: RegExpExecArray | null;
        while ((m = re.exec(src)) !== null) { out.add(decode(m[1])); }
    }
    return out;
}

function loadBundle(rel: string): Record<string, string> {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), rel), 'utf8')) as Record<string, string>;
}

describe('l10n bundles', () => {
    const strings = [...extractTStrings(process.cwd())].sort();
    const base = loadBundle('l10n/bundle.l10n.json');
    const zh = loadBundle('l10n/bundle.l10n.zh-cn.json');

    it('finds a meaningful number of translatable strings', () => {
        expect(strings.length).toBeGreaterThan(100);
    });

    it('every source string exists in the English bundle', () => {
        const missing = strings.filter((s) => !(s in base));
        expect(missing).toEqual([]);
    });

    it('every source string exists in the zh-cn bundle', () => {
        const missing = strings.filter((s) => !(s in zh));
        expect(missing).toEqual([]);
    });
});
