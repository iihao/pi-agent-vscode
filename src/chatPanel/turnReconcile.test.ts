import { describe, it, expect } from 'vitest';
import { missingSuffix, planAssistantCompletion, planToolResultCompletion } from './turnReconcile';
import { PiRawMessage, extractMessageParts, extractToolResult } from '../sdk/piTypes';

const assistant = (content: unknown, extra: Partial<PiRawMessage> = {}): PiRawMessage =>
    ({ role: 'assistant', content, ...extra });

describe('missingSuffix', () => {
    it('returns the whole text when nothing was streamed', () => {
        expect(missingSuffix('hello', '')).toEqual({ suffix: 'hello', mismatch: false });
    });

    it('returns only the missing tail for a partial stream', () => {
        expect(missingSuffix('hello world', 'hello ')).toEqual({ suffix: 'world', mismatch: false });
    });

    it('returns nothing when the stream already covered the text', () => {
        expect(missingSuffix('hello', 'hello')).toEqual({ suffix: '', mismatch: false });
        expect(missingSuffix('', '')).toEqual({ suffix: '', mismatch: false });
    });

    it('falls back to the authoritative text when the stream does not match', () => {
        // Deltas lost / rewritten: duplicating is better than missing
        expect(missingSuffix('hello', 'HEL')).toEqual({ suffix: 'hello', mismatch: true });
    });
});

describe('extractMessageParts', () => {
    it('concatenates text/thinking blocks verbatim and collects tool calls', () => {
        const parts = extractMessageParts(assistant([
            { type: 'thinking', thinking: 'aaa' },
            { type: 'text', text: 'bbb' },
            { type: 'toolCall', id: 'c1', name: 'bash', arguments: { command: 'ls' } },
            { type: 'text', text: 'ccc' },
        ]));
        expect(parts.text).toBe('bbbccc');
        expect(parts.thinking).toBe('aaa');
        expect(parts.toolCalls).toEqual([{ id: 'c1', name: 'bash', arguments: { command: 'ls' } }]);
    });

    it('tolerates a plain string body', () => {
        expect(extractMessageParts({ role: 'assistant', content: 'hi' }).text).toBe('hi');
    });
});

describe('planAssistantCompletion', () => {
    it('sends everything that was never streamed', () => {
        const plan = planAssistantCompletion(
            assistant([
                { type: 'thinking', thinking: 'hmm' },
                { type: 'text', text: 'answer' },
                { type: 'toolCall', id: 'c1', name: 'bash', arguments: { command: 'ls' } },
            ]),
            { text: '', thinking: '' },
            new Set(),
        );
        expect(plan.textSuffix).toBe('answer');
        expect(plan.thinkingSuffix).toBe('hmm');
        expect(plan.toolCalls).toEqual([{ id: 'c1', name: 'bash', arguments: { command: 'ls' } }]);
        expect(plan.error).toBeUndefined();
    });

    it('does not re-send content that already reached the webview', () => {
        const plan = planAssistantCompletion(
            assistant([{ type: 'text', text: 'hello world' }]),
            { text: 'hello ', thinking: '' },
            new Set(),
        );
        expect(plan.textSuffix).toBe('world');
        expect(plan.textMismatch).toBe(false);
    });

    it('skips tool calls that already have a card', () => {
        const plan = planAssistantCompletion(
            assistant([{ type: 'toolCall', id: 'c1', name: 'bash' }]),
            { text: '', thinking: '' },
            new Set(['c1']),
        );
        expect(plan.toolCalls).toEqual([]);
    });

    it('surfaces the failure message pi uses for failed turns', () => {
        // A failed pi turn is an empty assistant message + errorMessage
        const plan = planAssistantCompletion(
            assistant([{ type: 'text', text: '' }], { stopReason: 'error', errorMessage: 'Request timed out.' }),
            { text: '', thinking: '' },
            new Set(),
        );
        expect(plan.textSuffix).toBe('');
        expect(plan.error).toBe('Request timed out.');
        expect(plan.aborted).toBe(false);
    });

    it('marks a user-stopped turn as aborted, not as an error', () => {
        // User pressed stop: pi carries an errorMessage but stopReason is aborted,
        // so it must not be treated as a failure with retry / switch model / logs
        const plan = planAssistantCompletion(
            assistant([{ type: 'text', text: '' }], { stopReason: 'aborted', errorMessage: 'Request aborted' }),
            { text: '', thinking: '' },
            new Set(),
        );
        expect(plan.aborted).toBe(true);
    });
});

describe('planToolResultCompletion', () => {
    const toolResult: PiRawMessage = {
        role: 'toolResult',
        toolCallId: 'c1',
        toolName: 'edit',
        isError: false,
        durationMs: 12,
        content: [{ type: 'text', text: 'ok' }],
        details: { diff: '-a\n+b' },
    };

    it('asks for a card when the tool call was never streamed', () => {
        const plan = planToolResultCompletion(toolResult, new Set());
        expect(plan?.needCard).toBe(true);
        expect(plan?.toolCallId).toBe('c1');
    });

    it('reuses the existing card when the call was streamed', () => {
        expect(planToolResultCompletion(toolResult, new Set(['c1']))?.needCard).toBe(false);
    });

    it('carries the diff, error flag and duration through', () => {
        const plan = planToolResultCompletion({ ...toolResult, isError: true }, new Set());
        expect(plan?.isError).toBe(true);
        expect(plan?.durationMs).toBe(12);
        expect(plan?.details?.diff).toBe('-a\n+b');
    });

    it('ignores non toolResult messages', () => {
        expect(planToolResultCompletion(assistant([{ type: 'text', text: 'x' }]), new Set())).toBeNull();
    });
});

describe('extractToolResult', () => {
    it('returns null without a toolCallId', () => {
        expect(extractToolResult({ role: 'toolResult', toolName: 'bash' })).toBeNull();
    });
});
