import { describe, it, expect } from 'vitest';
import { buildParticipantPrompt } from './chatParticipant';

function req(partial: { prompt?: string; command?: string; references?: unknown[] }) {
    return {
        prompt: partial.prompt ?? '',
        command: partial.command,
        references: partial.references ?? [],
    } as unknown as import('vscode').ChatRequest;
}

describe('buildParticipantPrompt', () => {
    it('returns the prompt unchanged for a plain request', () => {
        expect(buildParticipantPrompt(req({ prompt: 'hello' }))).toBe('hello');
    });

    it('prefixes the /explain command', () => {
        expect(buildParticipantPrompt(req({ prompt: 'function f() {}', command: 'explain' })))
            .toContain('Explain the following');
    });

    it('uses a default prompt for an empty /explain request', () => {
        expect(buildParticipantPrompt(req({ prompt: '', command: 'explain' })))
            .toBe('Explain the selected code.');
    });

    it('puts string references before the prompt', () => {
        const p = buildParticipantPrompt(req({ prompt: 'Q', references: [{ id: '1', name: 'f', value: 'REF' }] }));
        expect(p).toBe('REF\n\nQ');
    });

    it('renders Uri references as @relative paths', () => {
        const p = buildParticipantPrompt(req({ prompt: 'Q', references: [{ id: '1', name: 'f', value: { fsPath: '/a/b.ts' } }] }));
        expect(p).toBe('@/a/b.ts\n\nQ');
    });

    it('ignores references without a usable value', () => {
        const p = buildParticipantPrompt(req({ prompt: 'Q', references: [{ id: '1', name: 'f', value: 42 }] }));
        expect(p).toBe('Q');
    });
});
