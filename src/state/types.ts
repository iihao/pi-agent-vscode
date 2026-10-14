// ---------------------------------------------------------------------------
// Session-runtime state types
//
// One session (a ChatRuntime) owns one ChatState: panels bound to the same
// session share it, which is what gives "same session -> mirrored". Different
// sessions are fully isolated (busy / contexts / sessions / stats / models ...).
// The render ledger (what a given webview has already been sent) is per panel
// and does not live here.
// ---------------------------------------------------------------------------

import { ContextItem } from '../utils/context';
import { SessionInfo } from '../sdk/sessionManager';
import { PiModelInfo, PiUsage } from '../sdk/piTypes';

export interface TurnChange {
    rel: string;
    existed: boolean;
    edits: Array<{ oldText: string; newText: string }> | null;
    /** Snapshot of the file before the first touch this turn (diff / revert for write) */
    before?: string;
    /** Content written by write (diffed against the snapshot) */
    written?: string;
    /** Cached whole-turn diff (computed once) */
    diff?: string;
}

export interface SessionStats {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    contextPercent: number | null;
    contextWindow: number;
    autoCompact: boolean;
}

export interface ChatState {
    // UI state
    busy: boolean;

    // Per-turn change tracking (shared so panels on one session stay in sync)
    turnChanges: TurnChange[];

    // Set when clear() runs while disconnected: create a session once connected
    pendingNewSession: boolean;

    // Context state
    contexts: ContextItem[];

    // Usage stats
    lastUsage: PiUsage | undefined;
    stats: SessionStats | undefined;

    // Session state
    sessions: SessionInfo[];
    currentSessionId: string | undefined;

    // Model state
    models: PiModelInfo[];
    currentModel: { provider: string; id: string } | null;
    thinkingLevels: string[];
    currentThinking: string | null;

    // Permission state
    permissionMode: string;

    // Connection state
    connected: boolean;
    connecting: boolean;
}

export type ChatStateSelector<T> = (state: ChatState) => T;

export function getInitialState(): ChatState {
    return {
        busy: false,
        turnChanges: [],
        pendingNewSession: false,
        contexts: [],
        lastUsage: undefined,
        stats: undefined,
        sessions: [],
        currentSessionId: undefined,
        models: [],
        currentModel: null,
        thinkingLevels: [],
        currentThinking: null,
        permissionMode: 'ask',
        connected: false,
        connecting: false,
    };
}
