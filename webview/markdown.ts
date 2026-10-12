// ---------------------------------------------------------------------------
// Markdown 渲染引擎（markdown-it + highlight.js + KaTeX + Mermaid）
// ---------------------------------------------------------------------------

import MarkdownIt from 'markdown-it';
import type { Token } from 'markdown-it';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import shell from 'highlight.js/lib/languages/shell';
import python from 'highlight.js/lib/languages/python';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import java from 'highlight.js/lib/languages/java';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import markdown from 'highlight.js/lib/languages/markdown';
import sql from 'highlight.js/lib/languages/sql';
import diff from 'highlight.js/lib/languages/diff';
import katexPlugin from '@vscode/markdown-it-katex';
import 'katex/dist/katex.min.css';
import { escapeHtml } from './utils';
import type { UiStrings } from './types';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sh', shell);
hljs.registerLanguage('shell', shell);
hljs.registerLanguage('zsh', shell);
hljs.registerLanguage('python', python);
hljs.registerLanguage('py', python);
hljs.registerLanguage('go', go);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('java', java);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('c', cpp);
hljs.registerLanguage('csharp', csharp);
hljs.registerLanguage('cs', csharp);
hljs.registerLanguage('css', css);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('yml', yaml);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('md', markdown);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('diff', diff);

function renderFence(token: { info?: string; content?: string }, S: UiStrings): string {
    const info = token.info ? token.info.trim() : '';
    const lang = info.split(/\s+/)[0] || 'code';
    const code = (token.content || '').replace(/\n$/, '');
    if (lang === 'mermaid') {
        return '<div class="mermaid">' + escapeHtml(code) + '</div>';
    }
    let codeHtml: string;
    if (lang && hljs.getLanguage(lang)) {
        try { codeHtml = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value; }
        catch (e) { codeHtml = escapeHtml(code); }
    } else {
        codeHtml = escapeHtml(code);
    }
    const lines = code.split('\n');
    let lineNumbers = '';
    for (let i = 0; i < lines.length; i++) {
        lineNumbers += '<span class="line-number">' + (i + 1) + '</span>';
    }
    const applyIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 12.5 9.5 18 20 6"></polyline></svg>';
    const copyIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2.5"></rect><path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5V4.5A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5"></path></svg>';
    const actions = '<div class="code-actions">' +
        '<button data-act="apply" title="' + escapeHtml((S as Record<string, string>).codeApply || 'Apply') + '" aria-label="' + escapeHtml((S as Record<string, string>).codeApply || 'Apply') + '">' + applyIcon + '</button>' +
        '<button data-act="copy" title="' + escapeHtml((S as Record<string, string>).codeCopy || 'Copy') + '" aria-label="' + escapeHtml((S as Record<string, string>).codeCopy || 'Copy') + '">' + copyIcon + '</button>' +
        '</div>';
    return '<div class="code-block"><div class="code-block-header"><span>' + escapeHtml(lang) + '</span>' + actions + '</div><pre><div class="code-with-lines"><div class="line-numbers">' + lineNumbers + '</div><code class="hljs">' + codeHtml + '</code></div></pre></div>';
}

export function setupMarkdown(S: UiStrings): MarkdownIt {
    const md = new MarkdownIt({ html: false, linkify: true, breaks: true });
    md.use(katexPlugin);
    md.renderer.rules.fence = function (tokens, idx) { return renderFence(tokens[idx], S); };
    md.renderer.rules.code_block = function (tokens, idx) { return renderFence(tokens[idx], S); };
    md.renderer.rules.link_open = function (tokens, idx, _options, _env, self) {
        tokens[idx].attrSet('target', '_blank');
        tokens[idx].attrSet('rel', 'noopener noreferrer');
        return self.renderToken(tokens, idx, self);
    };
    md.renderer.rules.image = function (tokens, idx, _options, _env, self) {
        const token = tokens[idx];
        const src = token.attrGet('src') || '';
        if (/^https?:\/\//i.test(src)) {
            const alt = self.renderInlineAsText((token.children || []) as Token[]) || src;
            return '<a href="' + escapeHtml(src) + '" target="_blank" rel="noopener noreferrer">🖼 ' + escapeHtml(alt) + '</a>';
        }
        return self.renderToken(tokens, idx, self);
    };
    return md;
}

export function renderMarkdown(md: MarkdownIt, src: string): string {
    return md.render(src || '');
}

/** Mermaid 按需懒加载（大库，仅在出现图时拉取） */
export function renderMermaid(chat: HTMLElement): Promise<void> {
    const nodes = Array.prototype.slice.call(chat.querySelectorAll('.mermaid:not([data-processed])'));
    if (!nodes.length) { return Promise.resolve(); }
    nodes.forEach(function (n) { n.setAttribute('data-processed', '1'); });
    return import('mermaid').then(function (mod) {
        const lib = mod.default || mod;
        lib.initialize({
            startOnLoad: false,
            securityLevel: 'strict',
            theme: document.body.classList.contains('vscode-light') ? 'default' : 'dark',
        });
        return lib.run({ nodes: nodes, suppressErrors: true }).catch(function () {});
    }).catch(function () { return; });
}
