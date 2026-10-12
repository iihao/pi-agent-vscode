// ---------------------------------------------------------------------------
// Webview UI 文案（通过 vscode.l10n 本地化，由扩展宿主注入到 HTML）
// ---------------------------------------------------------------------------

import * as vscode from 'vscode';

const t = vscode.l10n.t;

export interface UiStrings {
    [key: string]: unknown;
    connStatus: string;
    outlineTitle: string;
    noMessages: string;
    prevQuestion: string;
    nextQuestion: string;
    searchTitle: string;
    exportTitle: string;
    newChatTitle: string;
    sessionTitle: string;
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
    historyDivider: string;
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
    revert: string;
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
        outlineTitle: t('Jump to a question'),
        noMessages: t('No questions yet'),
        prevQuestion: t('Previous question'),
        nextQuestion: t('Next question'),
        searchTitle: t('Search messages (Ctrl+F)'),
        exportTitle: t('Export conversation as Markdown'),
        newChatTitle: t('New chat'),
        sessionTitle: t('Sessions'),
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
        inputBusyPlaceholder: t('Pi is working — Enter to queue, Ctrl/Cmd+Enter to steer'),
        queued: t('Queued'),
        steering: t('Steering'),
        bashTruncated: t('Output truncated'),
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
        historyDivider: t('History above'),
        exportHeader: t('# Pi Agent Conversation'),
        exportTime: t('Exported: '),
        exportEmpty: t('No messages to export'),
        remove: t('Remove'),
        copyMsg: t('Copy message'),
        editMsg: t('Edit message'),
        deleteMsg: t('Delete message'),
        rename: t('Rename'),
        codeApply: t('Apply'),
        codeCopy: t('Copy'),
        noSessions: t('No sessions'),
        noModels: t('No models available'),
        noThinking: t('This model does not support thinking levels'),
        noResults: t('No results'),
        messages: t('messages'),
        changedFiles: t('Changed files'),
        revert: t('Revert'),
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
