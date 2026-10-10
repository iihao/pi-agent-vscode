// ---------------------------------------------------------------------------
// Webview HTML 外壳
//
// 结构（body）保留在这里；样式与脚本已抽离为独立资源：
//   webview/styles.css  -> media/main.css
//   webview/main.js     -> media/main.js（esbuild 打包，含 markdown-it/highlight.js）
// 由 ChatPanel 通过 webview.asWebviewUri 引用。
// ---------------------------------------------------------------------------

import { UiStrings } from './strings';

/** HTML 属性转义 */
function escapeAttr(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} data: https:; font-src ${cspSource}; style-src ${cspSource} 'unsafe-inline'; script-src ${cspSource};">
<link rel="stylesheet" href="${styleUri}">
</head>
<body>
    <header class="header">
        <div class="brand">
            <span class="logo" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>
            </span>
            <span class="name">Pi</span>
            <span class="connection-status connecting" id="connectionStatus" title="${S.connStatus}"></span>
            <span class="message-count" id="messageCount">0</span>
            <span class="ctx-stats hidden" id="ctxStats"></span>
        </div>
        <div class="header-actions">
            <button id="searchBtn" class="icon-btn" title="${S.searchTitle}" aria-label="${S.searchTitle}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.5" y2="16.5"></line></svg>
            </button>
            <button id="exportBtn" class="icon-btn" title="${S.exportTitle}" aria-label="${S.exportTitle}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
            </button>
            <button id="newChatBtn" class="icon-btn" title="${S.newChatTitle}" aria-label="${S.newChatTitle}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z"></path><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line></svg>
            </button>
        </div>
    </header>

    <div class="session-bar" id="sessionBar">
        <span class="git-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
        </span>
        <button id="sessionBtn" class="pill session-pill" title="${S.sessionTitle}">
            <span id="sessionLabel" class="pill-label">${S.currentSession}</span>
            <span class="pill-caret">▾</span>
        </button>
        <div class="popover session-panel hidden" id="sessionPanel"></div>
    </div>

    <div class="search-bar" id="searchBar">
        <input type="text" id="searchInput" class="search-input" placeholder="${S.searchPlaceholder}">
        <span class="search-results" id="searchResults"></span>
        <button id="searchPrev" class="search-btn" title="${S.prev}">↑</button>
        <button id="searchNext" class="search-btn" title="${S.next}">↓</button>
        <button id="searchClose" class="search-btn" title="${S.close}">✕</button>
    </div>

    <div class="chat-container" id="chat">
        <div class="welcome" id="welcome">
            <div class="welcome-logo" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 8 10 12 6 16"></polyline><line x1="13" y1="16" x2="18" y2="16"></line></svg>
            </div>
            <div class="welcome-title">Pi Agent</div>
            <div class="welcome-desc">${S.welcomeDesc}</div>
            <div class="quick-actions">
                <button class="quick-action" data-q="${S.quickExplainQ}">${S.quickExplain}</button>
                <button class="quick-action" data-q="${S.quickReviewQ}">${S.quickReview}</button>
                <button class="quick-action" data-q="${S.quickSummaryQ}">${S.quickSummary}</button>
                <button class="quick-action" data-q="${S.quickTestQ}">${S.quickTest}</button>
            </div>
            <div class="welcome-guide">
                <div class="guide-heading">${S.guideTitle}</div>
                <div class="guide-item">
                    <span class="guide-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg></span>
                    <div class="guide-text">
                        <div class="guide-item-title">${S.guideAsk}</div>
                        <div class="guide-item-desc">${S.guideAskDesc}</div>
                    </div>
                </div>
                <div class="guide-item">
                    <span class="guide-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg></span>
                    <div class="guide-text">
                        <div class="guide-item-title">${S.guideAttach}</div>
                        <div class="guide-item-desc">${S.guideAttachDesc}</div>
                    </div>
                </div>
                <div class="guide-item">
                    <span class="guide-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg></span>
                    <div class="guide-text">
                        <div class="guide-item-title">${S.guidePerm}</div>
                        <div class="guide-item-desc">${S.guidePermDesc}</div>
                    </div>
                </div>
            </div>
            <div class="welcome-shortcuts">
                <div class="shortcut-hint"><kbd>Enter</kbd> ${S.kbdSend}</div>
                <div class="shortcut-hint"><kbd>Shift</kbd>+<kbd>Enter</kbd> ${S.kbdNewline}</div>
                <div class="shortcut-hint"><kbd>Ctrl</kbd>+<kbd>F</kbd> ${S.kbdSearch}</div>
                <div class="shortcut-hint"><kbd>↑</kbd><kbd>↓</kbd> ${S.kbdHistory}</div>
            </div>
        </div>
    </div>

    <div class="input-area">
        <div class="popover hidden" id="modelPanel"></div>
        <div class="popover hidden" id="thinkingPanel"></div>
        <div class="popover hidden" id="permPanel"></div>
        <div class="composer">
            <div class="chip-row hidden" id="chipRow"></div>
            <textarea id="input" class="input-box" placeholder="${S.inputPlaceholder}"></textarea>
            <div class="input-footer">
                <div class="composer-meta">
                    <button id="attachBtn" class="pill pill-icon-only" title="${S.attachTitle}">
                        <span class="pill-icon" aria-hidden="true">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
                        </span>
                    </button>
                    <button id="modelBtn" class="pill" title="${S.modelTitle}">
                        <span class="pill-icon" aria-hidden="true">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15l-1.9-4.1L5.5 9l4.6-1.4z"></path></svg>
                        </span>
                        <span id="modelLabel" class="pill-label">${S.notConnected}</span>
                        <span class="pill-caret">▾</span>
                    </button>
                    <button id="thinkingBtn" class="pill" title="${S.thinkingTitle}">
                        <span id="thinkingLabel" class="pill-label">${S.thinking}</span>
                        <span class="pill-caret">▾</span>
                    </button>
                    <button id="permBtn" class="pill" title="${S.permissionTitle}">
                        <span class="pill-icon" aria-hidden="true">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                        </span>
                        <span id="permLabel" class="pill-label">${S.permission}</span>
                        <span class="pill-caret">▾</span>
                    </button>
                </div>
                <button id="send" class="send-button" title="${S.sendTitle}" aria-label="${S.sendTitle}">
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
