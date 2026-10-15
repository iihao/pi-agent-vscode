// ---------------------------------------------------------------------------
// Clearing the transcript
//
// Regression test: `clear` removed a fixed list of classes, so the tool-group
// wrapper survived — after "New chat" the previous session's collapsed
// "Bash, Read …" box was still there, expandable but empty.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { clearTranscript } from '../webview/modules/transcript';

interface FakeChild { id: string; className: string; remove(): void }

/** Minimal stand-in for #chat: only `children` / `id` / `remove()` are used */
function fakeChat(classes: string[]): { chat: HTMLElement; removed: string[] } {
    const removed: string[] = [];
    const children: FakeChild[] = [
        { id: 'welcome', className: 'welcome', remove: () => { removed.push('welcome'); } },
        ...classes.map((cls) => ({
            id: '',
            className: cls,
            remove: () => { removed.push(cls); },
        })),
    ];
    return { chat: { children } as unknown as HTMLElement, removed };
}

describe('clearing the transcript', () => {
    it('keeps the empty state and removes everything else', () => {
        const { chat, removed } = fakeChat([
            'message', 'status-line', 'activity', 'tool-group',
            'compaction-marker', 'collapsible', 'history-divider', 'turn-changes',
        ]);
        clearTranscript(chat);
        expect(removed).not.toContain('welcome');
        expect(removed).toHaveLength(8);
        expect(removed).toContain('tool-group');
    });

    it('removes containers it has never heard of, so a new renderer cannot leak into the next session', () => {
        const { chat, removed } = fakeChat(['some-future-card']);
        clearTranscript(chat);
        expect(removed).toEqual(['some-future-card']);
    });

    it('is a no-op on an already empty transcript', () => {
        const { chat, removed } = fakeChat([]);
        clearTranscript(chat);
        expect(removed).toEqual([]);
    });
});
