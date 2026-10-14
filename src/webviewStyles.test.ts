import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const stylesPath = fileURLToPath(new URL('../webview/styles.css', import.meta.url));

describe('webview styles', () => {
    // Regression guard: components used to declare `.foo.hidden` individually, so a
    // new Undo button missed the rule and showed before anything was reverted —
    // clicking it only reported "Nothing to restore". This asserts a single global
    // `.hidden` utility exists so any component can reuse it.
    it('defines a global .hidden utility (not only per-component rules)', () => {
        const css = readFileSync(stylesPath, 'utf8');
        // A bare .hidden rule at line start (or after } / whitespace), excluding compound selectors like `.popover.hidden`
        const globalHidden = /(^|\n)\s*\.hidden\s*\{[^}]*display:\s*none/i;
        expect(css).toMatch(globalHidden);
    });
});
