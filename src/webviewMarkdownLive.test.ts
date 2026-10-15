// ---------------------------------------------------------------------------
// Live typewriter render vs the final render
//
// A reveal frame re-renders the whole already-revealed prefix. Running
// highlight.js over every code block in it — up to sixty times a second — is
// what made long answers stutter, so streaming frames only escape the code and
// the stream-end render applies the real formatting.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { setupMarkdown, renderMarkdown, setLiveRender } from '../webview/markdown';

const SRC = '```js\nconst answer = 42;\n```\n';

describe('live vs final markdown render', () => {
    it('live frames skip highlight.js, the final render applies it', () => {
        const md = setupMarkdown({} as never);

        setLiveRender(md, true);
        const live = renderMarkdown(md, SRC);
        expect(live).not.toContain('hljs-keyword');
        // the code is still there, escaped
        expect(live).toContain('const answer = 42;');

        setLiveRender(md, false);
        const full = renderMarkdown(md, SRC);
        expect(full).toContain('hljs-keyword');
    });

    it('live frames keep line numbers so the block does not shift at the end', () => {
        const md = setupMarkdown({} as never);
        setLiveRender(md, true);
        const live = renderMarkdown(md, SRC);
        setLiveRender(md, false);
        const full = renderMarkdown(md, SRC);
        expect(live).toContain('<span class="line-number">1</span>');
        expect(full).toContain('<span class="line-number">1</span>');
    });

    it('non-code markdown is untouched by the live mode', () => {
        const md = setupMarkdown({} as never);
        setLiveRender(md, true);
        const live = renderMarkdown(md, '# Title\n\n- one\n- two\n');
        setLiveRender(md, false);
        const full = renderMarkdown(md, '# Title\n\n- one\n- two\n');
        expect(live).toBe(full);
    });
});
