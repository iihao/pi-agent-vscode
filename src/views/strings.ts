// ---------------------------------------------------------------------------
// Webview UI strings (localized via vscode.l10n, injected into the HTML by the host)
// ---------------------------------------------------------------------------

import * as vscode from 'vscode';

const t = vscode.l10n.t;

export interface UiStrings {
    [key: string]: unknown;
    connStatus: string;
    setupTitle: string;
    setupTrust: string;
    setupTrustAction: string;
    setupPi: string;
    setupPiAction: string;
    setupConnect: string;
    setupConnectAction: string;
    setupProvider: string;
    setupProviderAction: string;
    setupLogs: string;
    setupManage: string;
    outlineTitle: string;
    noMessages: string;
    prevQuestion: string;
    nextQuestion: string;
    searchTitle: string;
    exportTitle: string;
    newChatTitle: string;
    sessionTitle: string;
    sessionSearch: string;
    /** Session list: re-read the directory from disk */
    sessionReload: string;
    currentSession: string;
    searchPlaceholder: string;
    prev: string;
    next: string;
    close: string;
    quickExplain: string;
    quickExplainQ: string;
    quickReview: string;
    quickReviewQ: string;
    quickSummary: string;
    quickSummaryQ: string;
    quickTest: string;
    quickTestQ: string;
    kbdSend: string;
    kbdNewline: string;
    kbdSearch: string;
    kbdHistory: string;
    kbdJump: string;
    inputPlaceholder: string;
    inputBusyPlaceholder: string;
    queued: string;
    steering: string;
    bashTruncated: string;
    outputTruncated: string;
    openFullOutput: string;
    imageTooLarge: string;
    attachTitle: string;
    attachFilesFolders: string;
    attachCurrentFile: string;
    attachCurrentSelection: string;
    attachOpenEditors: string;
    attachRecent: string;
    modelTitle: string;
    notConnected: string;
    connecting: string;
    connectionFailed: string;
    thinkingTitle: string;
    thinking: string;
    permissionTitle: string;
    permission: string;
    sendTitle: string;
    stopTitle: string;
    queueTitle: string;
    steerTitle: string;
    modeQueue: string;
    modeSteer: string;
    historyDivider: string;
    /** Transcript replay: a checkpoint left by pi's auto-compaction */
    compactedHere: string;
    /** Transcript replay: how many older items were left out */
    historyTrimmed: string;
    exportHeader: string;
    exportTime: string;
    exportEmpty: string;
    remove: string;
    copyMsg: string;
    editMsg: string;
    deleteMsg: string;
    rename: string;
    codeApply: string;
    codeCopy: string;
    noSessions: string;
    noModels: string;
    noThinking: string;
    noResults: string;
    messages: string;
    changedFiles: string;
    showDiff: string;
    revert: string;
    revertOne: string;
    revertLocked: string;
    undoRevert: string;
    undoRevertHint: string;
    allRestored: string;
    someRestoreFailed: string;
    you: string;
    context: string;
    cumulative: string;
    autoCompact: string;
    ctxUsageTitle: string;
    ctxUsageWindow: string;
    ctxUsageHint: string;
    compact: string;
    thinkingLevels: Record<string, string>;
    permissionOptions: Record<string, string>;
    permissionDescs: Record<string, string>;
}

export function getUiStrings(): UiStrings {
    return {
        connStatus: t('Connection status'),
        setupTitle: t('Set up Pi'),
        setupTrust: t('Workspace trusted'),
        setupTrustAction: t('Manage trust'),
        setupPi: t('pi CLI installed'),
        setupPiAction: t('Install pi'),
        setupConnect: t('Connected to pi'),
        setupConnectAction: t('Retry'),
        setupProvider: t('Model provider ready'),
        setupProviderAction: t('Connect'),
        setupLogs: t('Show logs'),
        setupManage: t('Manage providers'),
        outlineTitle: t('Jump to a question'),
        noMessages: t('No questions yet'),
        prevQuestion: t('Previous question'),
        nextQuestion: t('Next question'),
        searchTitle: t('Search messages (Ctrl+F)'),
        exportTitle: t('Export conversation as Markdown'),
        newChatTitle: t('New chat'),
        sessionTitle: t('Sessions'),
        sessionSearch: t('Search sessions…'),
        sessionReload: t('Re-read the session list from disk'),
        currentSession: t('Current session'),
        searchPlaceholder: t('Search messages…'),
        prev: t('Previous'),
        next: t('Next'),
        close: t('Close'),
        quickExplain: t('Explain code'),
        quickExplainQ: t('Explain my selected code'),
        quickReview: t('Review code'),
        quickReviewQ: t('Review the current file and point out potential issues'),
        quickSummary: t('Summarize project'),
        quickSummaryQ: t('Summarize what this project does'),
        quickTest: t('Run tests'),
        quickTestQ: t('Run the project tests and report the results'),
        kbdSend: t('send'),
        kbdNewline: t('newline'),
        kbdSearch: t('search'),
        kbdHistory: t('history'),
        kbdJump: t('jump questions'),
        inputPlaceholder: t('Describe a task for pi… (@ file, / command, ! shell)'),
        inputBusyPlaceholder: t('Pi is working — Enter sends, ■ stops'),
        queued: t('Queued'),
        steering: t('Steering'),
        bashTruncated: t('Output truncated'),
        outputTruncated: t('Output truncated by pi'),
        openFullOutput: t('Open full output'),
        imageTooLarge: t('Image is too large (max 5 MB)'),
        attachTitle: t('Add context'),
        attachFilesFolders: t('Files & folders…'),
        attachCurrentFile: t('Current file'),
        attachCurrentSelection: t('Current selection'),
        attachOpenEditors: t('Open files'),
        attachRecent: t('Recent'),
        modelTitle: t('Select model'),
        notConnected: t('Not connected'),
        connecting: t('Connecting…'),
        connectionFailed: t('Connection failed'),
        thinkingTitle: t('Thinking level'),
        thinking: t('Thinking'),
        permissionTitle: t('Permission mode'),
        permission: t('Permission'),
        sendTitle: t('Send'),
        stopTitle: t('Stop'),
        queueTitle: t('Queue for after the current turn'),
        steerTitle: t('Steer the running turn (insert now)'),
        modeQueue: t('Queue'),
        modeSteer: t('Steer'),
        historyDivider: t('History above'),
        compactedHere: t('Context compacted here'),
        historyTrimmed: t('Earlier transcript not shown ({0} items) — the full history stays in the session file'),
        exportHeader: t('# Pi Agent Conversation'),
        exportTime: t('Exported: '),
        exportEmpty: t('No messages to export'),
        remove: t('Remove'),
        copyMsg: t('Copy message'),
        editMsg: t('Reuse as a new message (Pi still sees the original)'),
        deleteMsg: t('Remove from view (Pi still sees this message in context)'),
        rename: t('Rename'),
        codeApply: t('Apply'),
        codeCopy: t('Copy'),
        noSessions: t('No sessions'),
        noModels: t('No models available'),
        noThinking: t('This model does not support thinking levels'),
        noResults: t('No results'),
        messages: t('messages'),
        changedFiles: t('Changed files'),
        showDiff: t('Show diff'),
        revert: t('Revert all'),
        revertOne: t('Undo this file\u2019s changes'),
        revertLocked: process.platform === 'darwin'
            ? t('Overwritten — undo in your editor (⌘Z)')
            : t('Overwritten — undo in your editor (Ctrl+Z)'),
        undoRevert: t('Undo'),
        undoRevertHint: t('Restore the changes you just reverted'),
        allRestored: t('All changes undone'),
        someRestoreFailed: t('{0} of {1} undone'),
        you: t('You'),
        context: t('Context'),
        cumulative: t('Cumulative'),
        autoCompact: t('auto-compact'),
        ctxUsageTitle: t('Context usage — click to compact'),
        ctxUsageWindow: t('Window'),
        ctxUsageHint: t('Click to compact'),
        compact: t('Compact'),
        thinkingLevels: {
            off: t('Off'), minimal: t('Minimal'), low: t('Low'),
            medium: t('Medium'), high: t('High'), xhigh: t('Very high'), max: t('Max'),
        },
        permissionOptions: {
            ask: t('Manual'), autoConfirm: t('Auto'), restricted: t('Read-only'),
        },
        permissionDescs: {
            ask: t('Normal execution'), autoConfirm: t('Auto-confirm'), restricted: t('Disable bash/edit/write'),
        },
    };
}
