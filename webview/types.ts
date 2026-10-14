// ---------------------------------------------------------------------------
// Webview shared type definitions
// ---------------------------------------------------------------------------

export interface UiStringsData {
    [key: string]: string;
    you: string;
    steering: string;
    queued: string;
    thinking: string;
    copyMsg: string;
    editMsg: string;
    deleteMsg: string;
    noSessions: string;
    messages: string;
    noResults: string;
    exportEmpty: string;
    exportHeader: string;
    exportTime: string;
    imageTooLarge: string;
    bashTruncated: string;
    outputTruncated: string;
    openFullOutput: string;
    historyDivider: string;
    changedFiles: string;
    revert: string;
    revertOne: string;
    revertLocked: string;
    undoRevert: string;
    undoRevertHint: string;
    allRestored: string;
    someRestoreFailed: string;
    remove: string;
    rename: string;
    context: string;
    cumulative: string;
    autoCompact: string;
    codeApply: string;
    codeCopy: string;
    noModels: string;
    noThinking: string;
    notConnected: string;
    connecting: string;
    connectionFailed: string;
    currentSession: string;
    sessionTitle: string;
    inputPlaceholder: string;
    inputBusyPlaceholder: string;
    sendTitle: string;
    stopTitle: string;
    modelTitle: string;
    thinkingTitle: string;
    permissionTitle: string;
    permission: string;
    attachTitle: string;
    attachFilesFolders: string;
    attachOpenEditors: string;
    attachRecent: string;
    outlineTitle: string;
    noMessages: string;
    prevQuestion: string;
    nextQuestion: string;
    searchTitle: string;
    exportTitle: string;
    newChatTitle: string;
    searchPlaceholder: string;
    prev: string;
    next: string;
    close: string;
}

export type UiStrings = UiStringsData & {
    thinkingLevels: Record<string, string>;
    permissionOptions: Record<string, string>;
    permissionDescs: Record<string, string>;
}

export interface ChatElements {
    chat: HTMLElement;
    welcome: HTMLElement;
    welcomeSetup: HTMLElement;
    input: HTMLTextAreaElement;
    sendBtn: HTMLButtonElement;
    modeBtn: HTMLButtonElement;
    modeLabel: HTMLElement;
    attachBtn: HTMLButtonElement;
    chipRow: HTMLElement;
    imageRow: HTMLElement;
    suggest: HTMLElement;
    modelBtn: HTMLButtonElement;
    modelLabel: HTMLElement;
    modelPanel: HTMLElement;
    thinkingBtn: HTMLButtonElement;
    thinkingLabel: HTMLElement;
    thinkingPanel: HTMLElement;
    permBtn: HTMLButtonElement;
    permLabel: HTMLElement;
    permPanel: HTMLElement;
    attachPanel: HTMLElement;
    sessionBtn: HTMLButtonElement;
    sessionLabel: HTMLElement;
    sessionPanel: HTMLElement;
    connectionStatus: HTMLElement;
    messageCount: HTMLElement;
    ctxStats: HTMLElement;
    searchBtn: HTMLButtonElement;
    exportBtn: HTMLButtonElement;
    newChatBtn: HTMLButtonElement;
    outlinePanel: HTMLElement;
    msgRail: HTMLElement;
    msgNav: HTMLElement;
    qPrev: HTMLButtonElement;
    qNext: HTMLButtonElement;
    qCounter: HTMLElement;
    qCount: HTMLElement;
    qCurrent: HTMLElement;
    searchBar: HTMLElement;
    searchInput: HTMLInputElement;
    searchResults: HTMLElement;
    searchPrev: HTMLButtonElement;
    searchNext: HTMLButtonElement;
    searchClose: HTMLButtonElement;
    ctxUsage: HTMLElement;
    ctxUsageRing: SVGCircleElement;
    ctxUsagePct: HTMLElement;
}

// ---- Domain models ----

export interface ModelInfo {
    provider: string;
    id: string;
}

export interface SessionInfo {
    id: string;
    name?: string;
    preview?: string;
    createdAt: number;
    messageCount: number;
}

export interface ContextChip {
    id: string;
    type: string;
    path: string;
    lineRange?: string;
    /** Auto-attached from the active editor (removable) */
    auto?: boolean;
}

/** File / selection attachment shown on a sent user message */
export interface MessageAttachment {
    type: string;
    path: string;
    lineRange?: string;
}

export interface PendingImage {
    mimeType: string;
    data: string;
    dataUrl: string;
}

export interface ToolRuntime {
    el: HTMLElement;
    head: HTMLElement;
    body: HTMLElement;
}

export interface SearchMatch {
    role: string;
    text: string;
    element: HTMLElement;
}

export interface MessageInfo {
    role: string;
    text: string;
    element: HTMLElement;
}

export interface SlashCommand {
    name: string;
    command: string;
    description?: string;
    source?: string;
}

export interface SuggestItem {
    label: string;
    detail?: string;
    source?: string;
    insert: string;
}

export interface SuggestToken {
    mode: 'slash' | 'file';
    start: number;
    end: number;
    filter: string;
}

export interface AttachItem {
    path: string;
    label: string;
    range?: string;
}

export interface StatsInfo {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    contextPercent: number | null;
    contextWindow: number;
    autoCompact: boolean;
}

export type TurnFileState = 'pending' | 'reverted' | 'deleted' | 'failed' | 'skipped';

export interface TurnFile {
    path: string;
    status: 'created' | 'modified';
    revertible: boolean;
    state: TurnFileState;
}

export interface TurnRevertEntry {
    path: string;
    result: 'reverted' | 'deleted' | 'failed' | 'skipped';
    error?: string;
}

export interface PermissionOption {
    id: string;
    label: string;
    desc: string;
}

// ---- VS Code API ----

export interface VSCodeAPI {
    postMessage(message: unknown): void;
    getState(): unknown;
    setState(state: unknown): void;
}

// ---- Message types ----

// ---- Re-export the message protocol from the shared contract ----
export type { PostMessage, WebviewMessage, SetupStatus, ContextAttachment } from '../src/chatPanel/sharedTypes';

// ---- Shared context ----

export interface WebviewContext {
    vscode: VSCodeAPI;
    S: UiStrings;
    els: ChatElements;
    // Streaming state
    busy: boolean;
    /** What sending does while busy: queue or steer */
    sendMode: 'queue' | 'steer';
    currentBody: HTMLElement | null;
    currentBuffer: string;
    streamRenderScheduled: boolean;
    // Thinking state
    thinkingLine: HTMLElement | null;
    thinkingContent: string;
    // Tool state
    runningTools: Record<string, ToolRuntime>;
    // Edit state
    editingMessageEl: HTMLElement | null;
    // Model/thinking config
    modelsList: ModelInfo[];
    currentModel: ModelInfo | null;
    thinkingLevels: string[];
    currentThinking: string | null;
    // Permission
    permissionMode: string;
    // Sessions
    sessionsList: SessionInfo[];
    currentSessionId: string | null;
    /** Session list search query */
    sessionQuery: string;
    // Contexts
    contexts: ContextChip[];
    // Images
    pendingImages: PendingImage[];
    // Search
    searchQuery: string;
    searchMatches: SearchMatch[];
    searchIndex: number;
    allMessages: MessageInfo[];
    // History
    messageHistory: string[];
    historyIndex: number;
    // Slash commands
    slashCommands: SlashCommand[];
    filesList: string[] | null;
    suggestItems: SuggestItem[];
    suggestIndex: number;
    suggestMode: string | null;
    suggestStart: number;
    suggestEnd: number;
    // Attach
    attachOpenEditors: AttachItem[];
    attachRecent: AttachItem[];
    attachPending: boolean;
    // Rail
    railCount: number;
    // Mermaid
    mermaidLoading: Promise<unknown> | null;
}
