import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const stylesPath = fileURLToPath(new URL('../webview/styles.css', import.meta.url));

describe('webview styles', () => {
    // 回归守卫：曾经因为只在每个组件上写 `.foo.hidden`，新增的撤销按钮漏写规则，
    // 导致「未撤销时 Undo 按钮就可见、点了只报 Nothing to restore」。
    // 这里确保存在一份「全局 .hidden 工具类」，任何组件都能直接复用。
    it('defines a global .hidden utility (not only per-component rules)', () => {
        const css = readFileSync(stylesPath, 'utf8');
        // 行首（或前面是 } / 空白）的裸 .hidden 规则，排除 `.popover.hidden` 这类组合选择器
        const globalHidden = /(^|\n)\s*\.hidden\s*\{[^}]*display:\s*none/i;
        expect(css).toMatch(globalHidden);
    });
});
