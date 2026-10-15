// ---------------------------------------------------------------------------
// Shared message-protocol types (extension host <-> webview)
//
// This file is the single message contract for both sides; src/ and webview/
// both import from it.
// ---------------------------------------------------------------------------

import { PiImageBlock } from '../sdk/piTypes';

export type ImageAttachment = { type?: string; data?: string; mimeType?: string };

/** File / selection reference (composer attachment and message echo) */
export interface ContextAttachment {
    type: string;
    path: string;
    lineRange?: string;
}

/** First-run setup status */
export interface SetupStatus {
    connecting: boolean;
    connected: boolean;
    piFound: boolean;
    hasModels: boolean;
    workspaceTrusted: boolean;
    /** Whether the current provider has usable credentials (undefined = unknown) */
    authReady?: boolean;
    /** Why it is not ready (pi's auth check reason) */
    authReason?: string;
    /** Current provider id */
    provider?: string;
}

/**
 * One renderable transcript item, replayed after a reconnect or session switch.
 * The shapes mirror the live events (addUserMessage / thinking / toolCall /
 * toolEnd ...) so the webview can reuse the very same renderers and a restored
 * transcript looks identical to the one that was streamed.
 */
export interface HistoryItem {
    kind: 'user' | 'assistant' | 'thinking' | 'tool' | 'toolResult' | 'compaction' | 'notice';
    text?: string;
    /** tool / toolResult: tool name */
    tool?: string;
    toolCallId?: string;
    /** Tool card title (one-line summary of the arguments) */
    detail?: string;
    /** Full tool arguments (tool card body) */
    args?: string;
    isError?: boolean;
    durationMs?: number;
    diff?: string;
    output?: string;
    truncated?: boolean;
    fullOutputPath?: string;
    /** user: attached files / images carried by the message */
    images?: PiImageBlock[];
    attachments?: ContextAttachment[];
}

// ---- extension host -> webview ----

export interface PostMessage {
    type: string;
    text?: string;
    busy?: boolean;
    isError?: boolean;
    /** Action buttons on an error bubble */
    actions?: Array<{ id: string; label: string }>;
    /** First-run setup */
    setup?: SetupStatus;
    messages?: Array<{ role: string; text: string; images?: PiImageBlock[]; attachments?: ContextAttachment[] }>;
    /** Full-fidelity transcript replay (used instead of `messages` when available) */
    items?: HistoryItem[];
    /** How many earlier items were left out of `items` (kept in the session file) */
    hidden?: number;
    /**
     * `clear`: whether the transcript state is still unknown afterwards. True
     * when the transcript is being rebuilt from disk (the webview keeps its boot
     * state until the replayed `history` arrives); false when the host already
     * knows the session is empty (New chat / `/clear`).
     */
    boot?: boolean;
    models?: Array<{ provider: string; id: string }>;
    current?: { provider: string; id: string } | string | null;
    levels?: string[];
    currentThinking?: string | null;
    permissionMode?: string;
    sessions?: Array<{ id: string; file: string; createdAt: number; messageCount: number; name?: string; preview?: string }>;
    tool?: string;
    detail?: string;
    /** Full tool arguments (card body, so long commands are not reduced to a summary) */
    toolArgs?: string;
    toolCallId?: string;
    output?: string;
    diff?: string;
    durationMs?: number;
    /** Tool output was truncated by pi */
    truncated?: boolean;
    /** Path to the full output file when truncated (openable) */
    fullOutputPath?: string;
    toolCalls?: Array<{ tool: string; detail: string; isError?: boolean }>;
    stats?: {
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite: number;
        contextPercent: number | null;
        contextWindow: number;
        autoCompact: boolean;
    };
    contexts?: Array<ContextAttachment & { id: string; auto?: boolean }>;
    /** File / selection attachments carried by this user message (for echo) */
    attachments?: ContextAttachment[];
    images?: ImageAttachment[];
    pending?: 'steering' | 'queued';
    steering?: string[];
    followUp?: string[];
    paths?: string[];
    openEditors?: Array<{ path: string; label: string; range?: string }>;
    recentFiles?: Array<{ path: string; label: string }>;
    code?: string;
    // Workspace file list (@ mention completion)
    files?: string[];
    // Per-turn changes / revert
    turnFiles?: Array<{ path: string; status: 'created' | 'modified'; revertible: boolean; state: 'pending' | 'reverted' | 'deleted' | 'failed' | 'skipped'; diff?: string }>;
    results?: Array<{ path: string; result: 'reverted' | 'deleted' | 'failed' | 'skipped'; error?: string }>;
    canUndo?: boolean;
    restored?: number;
    autoHideMs?: number;
    [key: string]: unknown;
}

// ---- webview -> extension host ----

export interface WebviewMessage {
    type: string;
    text?: string;
    /** Action id from an error-bubble button (retry / logs ...) */
    action?: string;
    code?: string;
    provider?: string;
    modelId?: string;
    sessionId?: string;
    markdown?: string;
    href?: string;
    level?: string;
    currentName?: string;
    id?: string;
    mode?: string;
    paths?: string[];
    path?: string;
    range?: string;
    images?: ImageAttachment[];
}
