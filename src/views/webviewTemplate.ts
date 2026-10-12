// ---------------------------------------------------------------------------
// Webview HTML 外壳
//
// 结构（body）保留在这里；样式与脚本已抽离为独立资源：
//   webview/styles.css  -> media/main.css
//   webview/main.ts      -> media/main.js（esbuild 打包，含 markdown-it/highlight.js）
// 由 ChatPanel 通过 webview.asWebviewUri 引用。
// ---------------------------------------------------------------------------

import { UiStrings } from './strings';

/** HTML 转义（属性值与文本节点通用） */
function escapeAttr(s: unknown): string {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export interface WebviewAssets {
    cspSource: string;
    scriptUri: string;
    styleUri: string;
    locale: string;
}

export function getWebviewHtml(assets: WebviewAssets, S: UiStrings): string {
    const { cspSource, scriptUri, styleUri, locale } = assets;
    const i18n = escapeAttr(JSON.stringify(S));
    return `<!DOCTYPE html>
<html lang="${locale}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} data:; font-src ${cspSource}; style-src ${cspSource} 'unsafe-inline'; script-src ${cspSource};">
<link rel="stylesheet" href="${styleUri}">
</head>
<body>
    <header class="header">
        <div class="brand">
            <span class="logo" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 6 L11 12 L5.5 18"></path><path d="M13.5 18 H18.5"></path></svg>
            </span>
            <span class="name">Pi</span>
            <span class="connection-status connecting" id="connectionStatus" title="${escapeAttr(S.connStatus)}"></span>
            <span class="message-count" id="messageCount">0</span>
            <span class="ctx-stats hidden" id="ctxStats"></span>
        </div>
        <div class="header-actions">
            <button id="searchBtn" class="icon-btn" title="${escapeAttr(S.searchTitle)}" aria-label="${escapeAttr(S.searchTitle)}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.5" y2="16.5"></line></svg>
            </button>
            <button id="exportBtn" class="icon-btn" title="${escapeAttr(S.exportTitle)}" aria-label="${escapeAttr(S.exportTitle)}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
            </button>
            <button id="newChatBtn" class="icon-btn" title="${escapeAttr(S.newChatTitle)}" aria-label="${escapeAttr(S.newChatTitle)}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z"></path><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line></svg>
            </button>
        </div>
    </header>

    <div class="session-bar" id="sessionBar">
        <button id="sessionBtn" class="pill session-pill" title="${escapeAttr(S.sessionTitle)}">
            <span class="pill-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
            </span>
            <span id="sessionLabel" class="pill-label">${escapeAttr(S.currentSession)}</span>
            <span class="pill-caret">▾</span>
        </button>
        <div class="msg-nav hidden" id="msgNav">
            <button id="qPrev" class="icon-btn" title="${escapeAttr(S.prevQuestion)}" aria-label="${escapeAttr(S.prevQuestion)}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
            </button>
            <button id="qCounter" class="q-counter" title="${escapeAttr(S.outlineTitle)}" aria-label="${escapeAttr(S.outlineTitle)}">
                <span id="qCount" class="q-count">1/1</span>
                <span id="qCurrent" class="q-current"></span>
                <span class="pill-caret">▾</span>
            </button>
            <button id="qNext" class="icon-btn" title="${escapeAttr(S.nextQuestion)}" aria-label="${escapeAttr(S.nextQuestion)}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
            </button>
        </div>
        <div class="popover outline-panel hidden" id="outlinePanel"></div>
        <div class="popover session-panel hidden" id="sessionPanel"></div>
    </div>

    <div class="search-bar" id="searchBar">
        <input type="text" id="searchInput" class="search-input" placeholder="${escapeAttr(S.searchPlaceholder)}">
        <span class="search-results" id="searchResults"></span>
        <button id="searchPrev" class="search-btn" title="${escapeAttr(S.prev)}">↑</button>
        <button id="searchNext" class="search-btn" title="${escapeAttr(S.next)}">↓</button>
        <button id="searchClose" class="search-btn" title="${escapeAttr(S.close)}">✕</button>
    </div>

    <div class="chat-wrap">
    <div class="chat-container" id="chat">
        <div class="welcome" id="welcome">
            <div class="welcome-logo" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 8 10 12 6 16"></polyline><line x1="13" y1="16" x2="18" y2="16"></line></svg>
            </div>
            <div class="welcome-title">Pi Agent</div>
            <div class="quick-actions">
                <button class="quick-action" data-q="${escapeAttr(S.quickExplainQ)}">${S.quickExplain}</button>
                <button class="quick-action" data-q="${escapeAttr(S.quickReviewQ)}">${S.quickReview}</button>
                <button class="quick-action" data-q="${escapeAttr(S.quickSummaryQ)}">${S.quickSummary}</button>
                <button class="quick-action" data-q="${escapeAttr(S.quickTestQ)}">${S.quickTest}</button>
            </div>
            <div class="welcome-shortcuts">
                <div class="shortcut-hint"><kbd>Enter</kbd> ${escapeAttr(S.kbdSend)}</div>
                <div class="shortcut-hint"><kbd>Shift</kbd>+<kbd>Enter</kbd> ${escapeAttr(S.kbdNewline)}</div>
                <div class="shortcut-hint"><kbd>Ctrl</kbd>+<kbd>F</kbd> ${escapeAttr(S.kbdSearch)}</div>
                <div class="shortcut-hint"><kbd>↑</kbd><kbd>↓</kbd> ${escapeAttr(S.kbdHistory)}</div>
                <div class="shortcut-hint"><kbd>Alt</kbd><kbd>↑</kbd><kbd>↓</kbd> ${escapeAttr(S.kbdJump)}</div>
            </div>
        </div>
        </div>
        <div class="msg-rail hidden" id="msgRail"></div>
    </div>

    <div class="input-area">
        <div class="popover hidden" id="modelPanel"></div>
        <div class="popover hidden" id="thinkingPanel"></div>
        <div class="popover hidden" id="permPanel"></div>
        <div class="popover hidden" id="attachPanel"></div>
        <div class="suggest hidden" id="suggest"></div>
        <div class="composer">
            <div class="image-row hidden" id="imageRow"></div>
            <div class="chip-row hidden" id="chipRow"></div>
            <textarea id="input" class="input-box" placeholder="${escapeAttr(S.inputPlaceholder)}"></textarea>
            <div class="input-footer">
                <div class="composer-meta">
                    <button id="attachBtn" class="pill pill-icon-only" title="${escapeAttr(S.attachTitle)}">
                        <span class="pill-icon" aria-hidden="true">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                        </span>
                    </button>
                    <div class="ctx-usage hidden" id="ctxUsage">
                        <svg viewBox="0 0 36 36" class="ctx-usage-svg">
                            <circle class="ctx-usage-bg" cx="18" cy="18" r="15.5"></circle>
                            <circle class="ctx-usage-ring" id="ctxUsageRing" cx="18" cy="18" r="15.5"></circle>
                        </svg>
                        <span class="ctx-usage-pct" id="ctxUsagePct"></span>
                    </div>
                    <button id="modelBtn" class="pill" title="${escapeAttr(S.modelTitle)}">
                        <span class="pill-icon" aria-hidden="true">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6l1.9 4.6L18.5 12l-4.6 1.9L12 18l-1.9-4.1L5.5 12l4.6-1.4z"></path></svg>
                        </span>
                        <span id="modelLabel" class="pill-label">${escapeAttr(S.notConnected)}</span>
                        <span class="pill-caret">▾</span>
                    </button>
                    <button id="thinkingBtn" class="pill" title="${escapeAttr(S.thinkingTitle)}">
                        <span id="thinkingLabel" class="pill-label">${escapeAttr(S.thinking)}</span>
                        <span class="pill-caret">▾</span>
                    </button>
                    <button id="permBtn" class="pill" title="${escapeAttr(S.permissionTitle)}">
                        <span class="pill-icon" aria-hidden="true">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                        </span>
                        <span id="permLabel" class="pill-label">${escapeAttr(S.permission)}</span>
                        <span class="pill-caret">▾</span>
                    </button>
                </div>
                <button id="send" class="send-button" title="${escapeAttr(S.sendTitle)}" aria-label="${escapeAttr(S.sendTitle)}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg>
                </button>
            </div>
        </div>
    </div>

<div id="pi-i18n" data-strings="${i18n}" hidden></div>
<script type="module" src="${scriptUri}"></script>
</body>
</html>`;
}
