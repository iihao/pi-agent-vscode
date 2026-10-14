// ---------------------------------------------------------------------------
// Filling in dropped content (reconciliation at turn end)
//
// Principle: the extension only decides how things are presented; content
// always comes from pi's authoritative messages.
//  - Streaming events (*_delta) drive the live experience but can miss chunks
//    (packet loss / reconnects);
//  - Message-end events (*_end / message_end) carry the full content and are
//    authoritative;
//  - At each message end we reconcile and send whatever was never rendered.
// Content is never silently dropped: duplicating is better than missing.
// ---------------------------------------------------------------------------

import {
    PiRawMessage,
    PiToolResultBlock,
    PiToolResultDetails,
    extractMessageParts,
    extractToolResult,
} from '../sdk/piTypes';

/** What the streaming phase has already sent to the webview for one message */
export interface StreamedContent {
    text: string;
    thinking: string;
}

export interface MissingSuffix {
    /** Still-missing part (empty string = nothing missing) */
    suffix: string;
    /** The streamed content is not a prefix of the authoritative content (deltas lost or rewritten) */
    mismatch: boolean;
}

/**
 * Compute what `streamed` is missing relative to `full`.
 * Empty streamed -> resend everything; streamed is a prefix of full -> send only
 * the suffix.
 */
export function missingSuffix(full: string, streamed: string): MissingSuffix {
    if (!full || full === streamed) { return { suffix: '', mismatch: false }; }
    if (!streamed) { return { suffix: full, mismatch: false }; }
    if (full.startsWith(streamed)) { return { suffix: full.slice(streamed.length), mismatch: false }; }
    // Mismatch: resend the authoritative full text so nothing is missed (the caller logs a diagnostic)
    return { suffix: full, mismatch: true };
}

export interface MissingToolCall {
    id: string;
    name: string;
    arguments?: unknown;
}

export interface AssistantCompletion {
    /** Still-missing text */
    textSuffix: string;
    /** Still-missing thinking */
    thinkingSuffix: string;
    /** Tool calls not yet rendered as cards */
    toolCalls: MissingToolCall[];
    /** Why this message failed (pi carries the error on an empty assistant message) */
    error?: string;
    /** The turn was aborted (user stop / abort), not failed */
    aborted: boolean;
    textMismatch: boolean;
    thinkingMismatch: boolean;
}

/**
 * Work out what still needs to be sent to the webview for a finished assistant
 * message. renderedToolIds: toolCallIds that already have a card.
 */
export function planAssistantCompletion(
    m: PiRawMessage,
    streamed: StreamedContent,
    renderedToolIds: ReadonlySet<string>,
): AssistantCompletion {
    const parts = extractMessageParts(m);
    const text = missingSuffix(parts.text, streamed.text);
    const thinking = missingSuffix(parts.thinking, streamed.thinking);
    const toolCalls: MissingToolCall[] = [];
    for (const tc of parts.toolCalls) {
        if (!tc.id || renderedToolIds.has(tc.id)) { continue; }
        toolCalls.push({ id: tc.id, name: tc.name || 'tool', arguments: tc.arguments });
    }
    const error = typeof m.errorMessage === 'string' && m.errorMessage ? m.errorMessage : undefined;
    return {
        textSuffix: text.suffix,
        thinkingSuffix: thinking.suffix,
        toolCalls,
        error,
        aborted: m.stopReason === 'aborted',
        textMismatch: text.mismatch,
        thinkingMismatch: thinking.mismatch,
    };
}

export interface ToolResultCompletion {
    toolCallId: string;
    toolName: string;
    isError: boolean;
    durationMs?: number;
    content?: PiToolResultBlock[] | string;
    details?: PiToolResultDetails;
    /** No card yet: a toolCall must be sent before the result */
    needCard: boolean;
}

/**
 * Work out which tool results to resend for a finished tool-result message.
 * Resending an already-completed result is idempotent (the webview locates the
 * card by toolCallId).
 */
export function planToolResultCompletion(
    m: PiRawMessage,
    renderedToolIds: ReadonlySet<string>,
): ToolResultCompletion | null {
    const r = extractToolResult(m);
    if (!r) { return null; }
    return {
        toolCallId: r.toolCallId,
        toolName: r.toolName,
        isError: r.isError,
        durationMs: r.durationMs,
        content: r.content,
        details: r.details,
        needCard: !renderedToolIds.has(r.toolCallId),
    };
}
