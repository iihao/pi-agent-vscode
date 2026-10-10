import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import shell from 'highlight.js/lib/languages/shell';
import python from 'highlight.js/lib/languages/python';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import java from 'highlight.js/lib/languages/java';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import markdown from 'highlight.js/lib/languages/markdown';
import sql from 'highlight.js/lib/languages/sql';
import diff from 'highlight.js/lib/languages/diff';
import katexPlugin from '@vscode/markdown-it-katex';
import 'katex/dist/katex.min.css';
import './styles.css';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sh', shell);
hljs.registerLanguage('shell', shell);
hljs.registerLanguage('zsh', shell);
hljs.registerLanguage('python', python);
hljs.registerLanguage('py', python);
hljs.registerLanguage('go', go);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('java', java);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('c', cpp);
hljs.registerLanguage('csharp', csharp);
hljs.registerLanguage('cs', csharp);
hljs.registerLanguage('css', css);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('yml', yaml);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('md', markdown);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('diff', diff);

const vscode = acquireVsCodeApi();
    const S = JSON.parse(document.getElementById('pi-i18n').dataset.strings || '{}');
    const chat = document.getElementById('chat');
    const welcome = document.getElementById('welcome');
    const input = document.getElementById('input');
    const sendBtn = document.getElementById('send');
    const attachBtn = document.getElementById('attachBtn');
    const chipRow = document.getElementById('chipRow');
    const modelBtn = document.getElementById('modelBtn');
    const modelLabel = document.getElementById('modelLabel');
    const modelPanel = document.getElementById('modelPanel');
    const thinkingBtn = document.getElementById('thinkingBtn');
    const thinkingLabel = document.getElementById('thinkingLabel');
    const thinkingPanel = document.getElementById('thinkingPanel');
    const permBtn = document.getElementById('permBtn');
    const permLabel = document.getElementById('permLabel');
    const permPanel = document.getElementById('permPanel');
    const sessionBtn = document.getElementById('sessionBtn');
    const sessionLabel = document.getElementById('sessionLabel');
    const sessionPanel = document.getElementById('sessionPanel');
    
    // 顶部栏元素
    const connectionStatus = document.getElementById('connectionStatus');
    const messageCount = document.getElementById('messageCount');
    const ctxStats = document.getElementById('ctxStats');
    
    // 工具栏和搜索
    const searchBtn = document.getElementById('searchBtn');
    const exportBtn = document.getElementById('exportBtn');
    const newChatBtn = document.getElementById('newChatBtn');
    const searchBar = document.getElementById('searchBar');
    const searchInput = document.getElementById('searchInput');
    const searchResults = document.getElementById('searchResults');
    const searchPrev = document.getElementById('searchPrev');
    const searchNext = document.getElementById('searchNext');
    const searchClose = document.getElementById('searchClose');

    let busy = false;
    let currentBody = null;
    let currentBuffer = '';
    let thinkingLine = null;
    let thinkingContent = '';
    // toolCallId -> { el, head, body }，用于并发工具调用的精确状态与结果回填
    let runningTools = {};

    // 模型 / 思考档位
    let modelsList = [];
    let currentModel = null;
    let thinkingLevels = [];
    let currentThinking = null;

    // 权限模式
    let permissionMode = 'ask';
    const PERMISSION_OPTIONS = [
        { id: 'ask', label: S.permissionOptions.ask, desc: S.permissionDescs.ask },
        { id: 'autoConfirm', label: S.permissionOptions.autoConfirm, desc: S.permissionDescs.autoConfirm },
        { id: 'restricted', label: S.permissionOptions.restricted, desc: S.permissionDescs.restricted },
    ];

    // 会话列表
    let sessionsList = [];
    let currentSessionId = null;

    // 编辑器上下文 chip
    let contexts = [];

    function shortId(id) { return id ? String(id).slice(0, 8) : S.sessionTitle; }

    const THINKING_LABELS = S.thinkingLevels;

    function closePopovers() {
        modelPanel.classList.add('hidden');
        thinkingPanel.classList.add('hidden');
        sessionPanel.classList.add('hidden');
        permPanel.classList.add('hidden');
    }

    function togglePopover(panel) {
        const willShow = panel.classList.contains('hidden');
        closePopovers();
        if (willShow) { panel.classList.remove('hidden'); }
    }

    function renderModelPanel() {
        if (!modelsList.length) {
            modelLabel.textContent = S.notConnected;
            modelPanel.innerHTML = '<div class="popover-empty">' + S.noModels + '</div>';
            return;
        }
        if (currentModel) {
            modelLabel.textContent = currentModel.id || S.modelTitle;
            modelLabel.title = currentModel.provider + ' / ' + currentModel.id;
        }
        let html = '';
        modelsList.forEach(function (mo) {
            const active = currentModel && currentModel.provider === mo.provider && currentModel.id === mo.id;
            html += '<button class="popover-item' + (active ? ' active' : '') + '" data-provider="' + escapeHtml(mo.provider) + '" data-model="' + escapeHtml(mo.id) + '">' +
                '<span class="popover-item-main">' + escapeHtml(mo.id) + '</span>' +
                '<span class="popover-item-meta">' + escapeHtml(mo.provider) + '</span></button>';
        });
        modelPanel.innerHTML = html;
    }

    function renderThinkingPanel() {
        const cur = currentThinking || 'medium';
        thinkingLabel.textContent = S.thinking + ' · ' + (THINKING_LABELS[cur] || cur);
        if (!thinkingLevels.length) {
            thinkingPanel.innerHTML = '<div class="popover-empty">' + S.noThinking + '</div>';
            return;
        }
        let html = '';
        thinkingLevels.forEach(function (lv) {
            const active = lv === currentThinking;
            html += '<button class="popover-item' + (active ? ' active' : '') + '" data-level="' + escapeHtml(lv) + '">' +
                '<span class="popover-item-main">' + escapeHtml(THINKING_LABELS[lv] || lv) + '</span>' +
                '<span class="popover-item-meta">' + escapeHtml(lv) + '</span></button>';
        });
        thinkingPanel.innerHTML = html;
    }

    function renderChips() {
        if (!contexts.length) { chipRow.classList.add('hidden'); chipRow.innerHTML = ''; return; }
        chipRow.classList.remove('hidden');
        let html = '';
        contexts.forEach(function (c) {
            const label = c.type === 'selection'
                ? (c.path + (c.lineRange ? ':' + c.lineRange : ''))
                : c.path;
            html += '<span class="chip"><span class="chip-label" title="' + escapeHtml(label) + '">' + escapeHtml(label) + '</span>' +
                '<button class="chip-remove" data-id="' + escapeHtml(c.id) + '" title="' + S.remove + '">✕</button></span>';
        });
        chipRow.innerHTML = html;
    }

    function formatTokens(n) {
        n = n || 0;
        if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
        if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
        if (n >= 1e3) return Math.round(n / 1e3) + 'k';
        return String(n);
    }

    function renderStats(s) {
        if (!s) { ctxStats.classList.add('hidden'); return; }
        const pct = (s.contextPercent === null || s.contextPercent === undefined) ? null : s.contextPercent;
        ctxStats.textContent = (pct === null ? '?' : pct.toFixed(1) + '%') + (s.autoCompact ? ' auto' : '');
        ctxStats.classList.toggle('danger', pct !== null && pct > 90);
        const parts = [];
        if (s.input) parts.push('↑' + formatTokens(s.input));
        if (s.output) parts.push('↓' + formatTokens(s.output));
        if (s.cacheRead) parts.push('R' + formatTokens(s.cacheRead));
        if (s.cacheWrite) parts.push('W' + formatTokens(s.cacheWrite));
        ctxStats.title = S.context + ' ' + (pct === null ? '?' : pct.toFixed(1) + '%') + ' / ' + formatTokens(s.contextWindow) +
            (s.autoCompact ? ' (' + S.autoCompact + ')' : '') +
            (parts.length ? '\n' + S.cumulative + ' ' + parts.join('  ') : '');
        ctxStats.classList.remove('hidden');
    }

    function renderPermissionPanel() {
        const cur = PERMISSION_OPTIONS.find(function (o) { return o.id === permissionMode; });
        permLabel.textContent = cur ? cur.label : S.permission;
        let html = '';
        PERMISSION_OPTIONS.forEach(function (o) {
            const active = o.id === permissionMode;
            html += '<button class="popover-item' + (active ? ' active' : '') + '" data-mode="' + o.id + '">' +
                '<span class="popover-item-main">' + escapeHtml(o.label) + '</span>' +
                '<span class="popover-item-meta">' + escapeHtml(o.desc) + '</span></button>';
        });
        permPanel.innerHTML = html;
    }

    function renderSessionPanel() {
        if (!sessionsList.length) {
            sessionLabel.textContent = S.currentSession;
            sessionPanel.innerHTML = '<div class="popover-empty">' + S.noSessions + '</div>';
            return;
        }
        const cur = sessionsList.find(function (s) { return s.id === currentSessionId; });
        sessionLabel.textContent = cur ? (cur.name || shortId(cur.id)) : S.currentSession;
        let html = '';
        sessionsList.forEach(function (s) {
            const date = new Date(s.createdAt);
            const dateStr = (date.getMonth() + 1) + '/' + date.getDate() + ' ' + date.getHours() + ':' + String(date.getMinutes()).padStart(2, '0');
            const active = s.id === currentSessionId;
            html += '<div class="session-row' + (active ? ' active' : '') + '" data-id="' + escapeHtml(s.id) + '" data-name="' + escapeHtml(s.name || '') + '">' +
                '<button class="session-row-main">' +
                    '<span class="session-row-title">' + escapeHtml(s.name || shortId(s.id)) + '</span>' +
                    '<span class="session-row-meta">' + dateStr + '</span>' +
                '</button>' +
                '<button class="session-row-act" data-act="rename" title="' + S.rename + '">✎</button>' +
            '</div>';
        });
        sessionPanel.innerHTML = html;
    }

    // 搜索状态
    let searchQuery = '';
    let searchMatches = [];
    let searchIndex = 0;
    let allMessages = [];
    
    // 消息历史导航
    let messageHistory = [];
    let historyIndex = -1;

    function scrollToBottom() { chat.scrollTop = chat.scrollHeight; }
    
    function updateConnectionStatus(status) {
        connectionStatus.className = 'connection-status ' + status;
    }
    
    function updateMessageCount() {
        var count = chat.querySelectorAll('.message').length;
        messageCount.textContent = count + ' ' + S.messages;
    }

    // ---- Markdown 渲染（markdown-it + highlight.js）----
    function renderFence(token) {
        var info = token.info ? token.info.trim() : '';
        var lang = info.split(/\s+/)[0] || 'code';
        var code = token.content.replace(/\n$/, '');
        if (lang === 'mermaid') {
            return '<div class="mermaid">' + escapeHtml(code) + '</div>';
        }
        var codeHtml;
        if (lang && hljs.getLanguage(lang)) {
            try { codeHtml = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value; }
            catch (e) { codeHtml = escapeHtml(code); }
        } else {
            codeHtml = escapeHtml(code);
        }
        var lines = code.split('\n');
        var lineNumbers = '';
        for (var i = 0; i < lines.length; i++) {
            lineNumbers += '<span class="line-number">' + (i + 1) + '</span>';
        }
        var actions = '<div class="code-actions"><button data-act="apply">' + S.codeApply + '</button><button data-act="copy">' + S.codeCopy + '</button></div>';
        return '<div class="code-block"><div class="code-block-header"><span>' + escapeHtml(lang) + '</span>' + actions + '</div><pre><div class="code-with-lines"><div class="line-numbers">' + lineNumbers + '</div><code class="hljs">' + codeHtml + '</code></div></pre></div>';
    }

    var md = new MarkdownIt({ html: false, linkify: true, breaks: true });
    md.use(katexPlugin);
    md.renderer.rules.fence = function (tokens, idx) { return renderFence(tokens[idx]); };
    md.renderer.rules.code_block = function (tokens, idx) { return renderFence(tokens[idx]); };
    md.renderer.rules.link_open = function (tokens, idx, options, env, self) {
        tokens[idx].attrSet('target', '_blank');
        tokens[idx].attrSet('rel', 'noopener noreferrer');
        return self.renderToken(tokens, idx, options);
    };

    function renderMarkdown(src) {
        return md.render(src || '');
    }

    // Mermaid 按需懒加载（大库，仅在出现图时拉取）
    var mermaidLoading = null;
    function renderMermaid() {
        var nodes = Array.prototype.slice.call(chat.querySelectorAll('.mermaid:not([data-processed])'));
        if (!nodes.length) return;
        nodes.forEach(function (n) { n.setAttribute('data-processed', '1'); });
        if (!mermaidLoading) {
            mermaidLoading = import('mermaid').then(function (mod) {
                var lib = mod.default || mod;
                lib.initialize({
                    startOnLoad: false,
                    securityLevel: 'strict',
                    theme: document.body.classList.contains('vscode-light') ? 'default' : 'dark',
                });
                return lib;
            }).catch(function () { return null; });
        }
        mermaidLoading.then(function (lib) {
            if (!lib) return;
            return lib.run({ nodes: nodes, suppressErrors: true }).catch(function () {});
        });
    }

    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function formatTime() {
        const now = new Date();
        return now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
    }

    function copyMessage(btn, text) {
        vscode.postMessage({ type: 'copyCode', code: text });
        var original = btn.innerHTML;
        btn.textContent = 'OK';
        setTimeout(function () { btn.innerHTML = original; }, 1000);
    }

    function editMessage(text) {
        input.value = text;
        input.focus();
        autoResizeInput();
    }

    function deleteMessage(msgEl) {
        msgEl.remove();
        updateMessageCount();
    }

    function addMessage(role, markdown, isError) {
        welcome.style.display = 'none';
        const el = document.createElement('div');
        el.className = 'message ' + (isError ? 'error' : role);
        const label = role === 'user' ? S.you : 'Pi';
        const time = formatTime();
        var actions = '';
        if (!isError) {
            actions = '<div class="message-actions">' +
                '<button class="msg-action-btn" data-action="copy" title="' + S.copyMsg + '">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>' +
                '</button>' +
                (role === 'user' ?
                    '<button class="msg-action-btn" data-action="edit" title="' + S.editMsg + '">' +
                        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"></path></svg>' +
                    '</button>' : '') +
                '<button class="msg-action-btn" data-action="delete" title="' + S.deleteMsg + '">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>' +
                '</button>' +
                '</div>';
        }
        el.innerHTML = '<div class="message-header"><span class="role-label">' + label + '</span><span class="message-time">' + time + '</span>' + actions + '</div><div class="message-body"></div>';
        const body = el.querySelector('.message-body');
        body.innerHTML = renderMarkdown(markdown);
        chat.appendChild(el);
        scrollToBottom();
        updateMessageCount();
        return body;
    }

    function createCollapsible(title, count, collapsed) {
        const wrap = document.createElement('div');
        wrap.className = 'collapsible' + (collapsed ? ' collapsed' : '');
        const header = document.createElement('div');
        header.className = 'collapsible-header';
        header.innerHTML = '<span class="chevron">▼</span><span class="title">' + escapeHtml(title) + '</span' + (count > 0 ? '<span class="count">' + count + '</span>' : '') + '>';
        const content = document.createElement('div');
        content.className = 'collapsible-content';
        header.addEventListener('click', function () { wrap.classList.toggle('collapsed'); });
        wrap.appendChild(header);
        wrap.appendChild(content);
        chat.appendChild(wrap);
        scrollToBottom();
        return content;
    }

    function showThinking() {
        welcome.style.display = 'none';
        thinkingContent = '';
        if (!thinkingLine) {
            thinkingLine = createCollapsible(S.thinking, 0, false);
            const wrap = thinkingLine.closest('.collapsible');
            if (wrap) { wrap.classList.add('flat'); }
        }
    }

    function appendThinking(text) {
        thinkingContent += text;
        if (thinkingLine) {
            let detail = thinkingLine.querySelector('.thinking-detail');
            if (!detail) {
                detail = document.createElement('div');
                detail.className = 'thinking-detail';
                thinkingLine.innerHTML = '';
                thinkingLine.appendChild(detail);
            }
            detail.textContent = thinkingContent;
        }
    }

    function hideThinking() {
        if (thinkingLine) {
            let detail = thinkingLine.querySelector('.thinking-detail');
            if (!detail) {
                detail = document.createElement('div');
                detail.className = 'thinking-detail';
                thinkingLine.innerHTML = '';
                thinkingLine.appendChild(detail);
            }
            detail.textContent = thinkingContent;
            const wrap = thinkingLine.closest('.collapsible');
            if (wrap) { wrap.classList.add('collapsed'); }
            thinkingLine = null;
        }
    }

    function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

    function formatDuration(ms) {
        if (ms === undefined || ms === null) return '';
        return ms < 1000 ? ms + 'ms' : (ms / 1000).toFixed(1) + 's';
    }

    // 每个工具调用 = 一张可展开的扁平卡片（头部：名称/参数/状态；主体：输出或 diff）
    function addTool(tool, detail, toolCallId) {
        welcome.style.display = 'none';
        hideThinking();
        const el = document.createElement('div');
        el.className = 'activity running collapsed';
        const head = document.createElement('div');
        head.className = 'activity-head';
        head.innerHTML =
            '<span class="activity-caret">▾</span>' +
            '<span class="activity-name">' + escapeHtml(capitalize(tool)) + '</span>' +
            (detail ? '<span class="activity-detail">' + escapeHtml(detail) + '</span>' : '') +
            '<span class="activity-status"><span class="activity-spinner"></span></span>';
        const body = document.createElement('div');
        body.className = 'activity-body';
        head.addEventListener('click', function () { el.classList.toggle('collapsed'); });
        el.appendChild(head);
        el.appendChild(body);
        chat.appendChild(el);
        if (toolCallId) { runningTools[toolCallId] = { el: el, head: head, body: body }; }
        scrollToBottom();
    }

    // 流式输出：实时更新主体文本
    function setToolOutput(toolCallId, text) {
        const t = toolCallId ? runningTools[toolCallId] : null;
        if (!t) return;
        let pre = t.body.querySelector('.activity-output');
        if (!pre) {
            pre = document.createElement('pre');
            pre.className = 'activity-output';
            t.body.appendChild(pre);
        }
        pre.textContent = text;
        scrollToBottom();
    }

    function renderDiff(body, diff) {
        const box = document.createElement('div');
        box.className = 'activity-diff';
        diff.split('\n').forEach(function (line) {
            const span = document.createElement('span');
            let cls = 'diff-line';
            if (/^(diff |index |--- |\+\+\+ )/.test(line)) cls += ' diff-meta';
            else if (line.indexOf('@@') === 0) cls += ' diff-hunk';
            else if (line.charAt(0) === '+') cls += ' diff-add';
            else if (line.charAt(0) === '-') cls += ' diff-del';
            span.className = cls;
            span.textContent = line || ' ';
            box.appendChild(span);
        });
        body.appendChild(box);
    }

    function endTool(toolCallId, data) {
        const t = toolCallId ? runningTools[toolCallId] : null;
        if (toolCallId) { delete runningTools[toolCallId]; }
        if (!t) return;
        t.el.classList.remove('running');
        t.el.classList.add(data.isError ? 'failed' : 'done');
        const status = t.head.querySelector('.activity-status');
        if (status) {
            status.textContent = (data.isError ? '✗' : '✓') + (data.durationMs ? '  ' + formatDuration(data.durationMs) : '');
        }
        if (data.diff) {
            renderDiff(t.body, data.diff);
            t.el.classList.remove('collapsed');
        } else if (data.output) {
            let pre = t.body.querySelector('.activity-output');
            if (!pre) { pre = document.createElement('pre'); pre.className = 'activity-output'; t.body.appendChild(pre); }
            pre.textContent = data.output;
            if (data.isError) pre.classList.add('error');
        }
        scrollToBottom();
    }

    function addNotice(text) {
        // 通知不应清掉空状态：新会话/空会话切换后仍需保留引导与 logo
        const el = document.createElement('div');
        el.className = 'status-line notice';
        el.textContent = text;
        chat.appendChild(el);
        scrollToBottom();
    }

    function setBusy(value) {
        busy = value;
        if (value) {
            sendBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg>';
            sendBtn.classList.add('stopping');
            sendBtn.title = S.stopTitle;
        } else {
            sendBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg>';
            sendBtn.classList.remove('stopping');
            sendBtn.title = S.sendTitle;
            hideThinking();
        }
    }

    // ========== 搜索功能 ==========
    
    // 提取纯净文本：克隆后剔除代码行号，避免复制/导出/搜索混入行号
    function getMessageText(body) {
        if (!body) return '';
        const clone = body.cloneNode(true);
        clone.querySelectorAll('.line-numbers').forEach(function (el) { el.remove(); });
        clone.style.position = 'absolute';
        clone.style.left = '-9999px';
        clone.style.top = '0';
        clone.style.whiteSpace = 'pre-wrap';
        document.body.appendChild(clone);
        const text = clone.innerText;
        clone.remove();
        return text;
    }

    function getAllMessages() {
        const messages = [];
        chat.querySelectorAll('.message').forEach(function (el) {
            const role = el.classList.contains('user') ? 'user' : 'assistant';
            const body = el.querySelector('.message-body');
            messages.push({ role: role, text: getMessageText(body), element: el });
        });
        return messages;
    }

    function searchMessages(query) {
        if (!query) {
            clearSearch();
            return;
        }
        searchQuery = query.toLowerCase();
        allMessages = getAllMessages();
        searchMatches = allMessages.filter(function (m) {
            return m.text.toLowerCase().includes(searchQuery);
        });
        searchIndex = 0;
        updateSearchUI();
        highlightMatches();
    }

    function updateSearchUI() {
        if (searchMatches.length === 0) {
            searchResults.textContent = S.noResults;
        } else {
            searchResults.textContent = (searchIndex + 1) + ' / ' + searchMatches.length;
        }
    }

    function highlightMatches() {
        clearHighlights();
        if (searchMatches.length > 0 && searchIndex < searchMatches.length) {
            const match = searchMatches[searchIndex];
            match.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            match.element.style.backgroundColor = 'var(--vscode-findMatchHighlightBackground, rgba(255,255,0,.2))';
            setTimeout(function () {
                match.element.style.backgroundColor = '';
            }, 3000);
        }
    }

    function clearHighlights() {
        chat.querySelectorAll('.message').forEach(function (el) {
            el.style.backgroundColor = '';
        });
    }

    function clearSearch() {
        searchQuery = '';
        searchMatches = [];
        searchIndex = 0;
        searchResults.textContent = '';
        clearHighlights();
    }

    function goToMatch(direction) {
        if (searchMatches.length === 0) return;
        searchIndex += direction;
        if (searchIndex < 0) searchIndex = searchMatches.length - 1;
        if (searchIndex >= searchMatches.length) searchIndex = 0;
        updateSearchUI();
        highlightMatches();
    }

    // ========== 导出功能 ==========
    
    function exportConversation() {
        const messages = getAllMessages();
        if (messages.length === 0) {
            vscode.postMessage({ type: 'notify', text: S.exportEmpty });
            return;
        }
        let markdown = S.exportHeader + '\n\n';
        markdown += S.exportTime + new Date().toLocaleString() + '\n\n---\n\n';
        messages.forEach(function (m) {
            const role = m.role === 'user' ? '**' + S.you + '**' : '**Pi**';
            markdown += '### ' + role + '\n\n' + m.text + '\n\n---\n\n';
        });
        vscode.postMessage({ type: 'exportConversation', markdown: markdown });
    }

    function autoResizeInput() {
        input.style.height = 'auto';
        var newHeight = Math.min(Math.max(36, input.scrollHeight), 200);
        input.style.height = newHeight + 'px';
    }

    function send() {
        const text = input.value.trim();
        if (!text || busy) return;
        // 保存到历史
        if (messageHistory.length === 0 || messageHistory[messageHistory.length - 1] !== text) {
            messageHistory.push(text);
            if (messageHistory.length > 50) messageHistory.shift();
        }
        historyIndex = -1;
        vscode.postMessage({ type: 'sendMessage', text: text });
        input.value = '';
        autoResizeInput();
    }
    
    function navigateHistory(direction) {
        if (messageHistory.length === 0) return;
        if (historyIndex === -1) {
            historyIndex = messageHistory.length + direction;
        } else {
            historyIndex += direction;
        }
        if (historyIndex < 0) historyIndex = 0;
        if (historyIndex >= messageHistory.length) {
            historyIndex = -1;
            input.value = '';
            return;
        }
        input.value = messageHistory[historyIndex];
        input.selectionStart = input.selectionEnd = input.value.length;
    }

    // 工具栏事件
    searchBtn.addEventListener('click', function () {
        searchBar.classList.toggle('visible');
        if (searchBar.classList.contains('visible')) {
            searchInput.focus();
        } else {
            clearSearch();
        }
    });
    exportBtn.addEventListener('click', exportConversation);
    newChatBtn.addEventListener('click', function () {
        vscode.postMessage({ type: 'newSession' });
    });
    
    // 搜索事件
    searchInput.addEventListener('input', function () {
        searchMessages(searchInput.value);
    });
    searchPrev.addEventListener('click', function () { goToMatch(-1); });
    searchNext.addEventListener('click', function () { goToMatch(1); });
    searchClose.addEventListener('click', function () {
        searchBar.classList.remove('visible');
        clearSearch();
    });
    searchInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            goToMatch(e.shiftKey ? -1 : 1);
        } else if (e.key === 'Escape') {
            searchBar.classList.remove('visible');
            clearSearch();
        }
    });
    
    sendBtn.addEventListener('click', function () { if (busy) { vscode.postMessage({ type: 'abort' }); } else { send(); } });
    input.addEventListener('input', autoResizeInput);
    input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!busy) send();
        } else if (e.key === 'f' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            searchBar.classList.add('visible');
            searchInput.focus();
        } else if (e.key === 'ArrowUp' && !busy && input.selectionStart === 0) {
            e.preventDefault();
            navigateHistory(-1);
        } else if (e.key === 'ArrowDown' && !busy && input.selectionStart === input.value.length) {
            e.preventDefault();
            navigateHistory(1);
        }
    });
    document.querySelectorAll('.quick-action').forEach(function (btn) {
        btn.addEventListener('click', function () { if (!busy) vscode.postMessage({ type: 'sendMessage', text: btn.dataset.q }); });
    });
    modelBtn.addEventListener('click', function (e) { e.stopPropagation(); togglePopover(modelPanel); });
    thinkingBtn.addEventListener('click', function (e) { e.stopPropagation(); togglePopover(thinkingPanel); });
    permBtn.addEventListener('click', function (e) { e.stopPropagation(); togglePopover(permPanel); });
    permPanel.addEventListener('click', function (e) {
        const item = e.target.closest('.popover-item');
        if (!item || !item.dataset.mode) return;
        vscode.postMessage({ type: 'setPermission', mode: item.dataset.mode });
        closePopovers();
    });
    modelPanel.addEventListener('click', function (e) {
        const item = e.target.closest('.popover-item');
        if (!item || !item.dataset.model) return;
        vscode.postMessage({ type: 'setModel', provider: item.dataset.provider, modelId: item.dataset.model });
        closePopovers();
    });
    thinkingPanel.addEventListener('click', function (e) {
        const item = e.target.closest('.popover-item');
        if (!item || !item.dataset.level) return;
        vscode.postMessage({ type: 'setThinking', level: item.dataset.level });
        closePopovers();
    });
    document.addEventListener('click', function () { closePopovers(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closePopovers(); } });
    attachBtn.addEventListener('click', function (e) { e.stopPropagation(); vscode.postMessage({ type: 'attachActive' }); });
    chipRow.addEventListener('click', function (e) {
        const btn = e.target.closest('.chip-remove');
        if (btn) { vscode.postMessage({ type: 'removeContext', id: btn.dataset.id }); }
    });
    sessionBtn.addEventListener('click', function (e) { e.stopPropagation(); togglePopover(sessionPanel); });
    sessionPanel.addEventListener('click', function (e) {
        const act = e.target.closest('.session-row-act');
        if (act) {
            const row = act.closest('.session-row');
            if (!row) return;
            if (act.dataset.act === 'rename') {
                vscode.postMessage({ type: 'renameSession', sessionId: row.dataset.id, currentName: row.dataset.name || '' });
                closePopovers();
            }
            return;
        }
        const main = e.target.closest('.session-row-main');
        if (main) {
            const row = main.closest('.session-row');
            if (row) { vscode.postMessage({ type: 'switchSession', sessionId: row.dataset.id }); closePopovers(); }
        }
    });
    chat.addEventListener('click', function (e) {
        // 链接：交给扩展宿主用系统浏览器打开
        var link = e.target.closest('a[href]');
        if (link) {
            e.preventDefault();
            vscode.postMessage({ type: 'openLink', href: link.getAttribute('href') });
            return;
        }
        // 代码块操作
        var codeBtn = e.target.closest('button[data-act]');
        if (codeBtn) {
            var codeEl = codeBtn.closest('.code-block').querySelector('pre code');
            if (codeEl) {
                var code = codeEl.textContent;
                if (codeBtn.dataset.act === 'apply') { vscode.postMessage({ type: 'applyCode', code: code }); }
                else if (codeBtn.dataset.act === 'copy') { vscode.postMessage({ type: 'copyCode', code: code }); }
            }
            return;
        }
        // 消息操作
        var msgBtn = e.target.closest('.msg-action-btn');
        if (msgBtn) {
            var msgEl = msgBtn.closest('.message');
            if (msgEl) {
                var body = msgEl.querySelector('.message-body');
                var text = getMessageText(body);
                if (msgBtn.dataset.action === 'copy') { copyMessage(msgBtn, text); }
                else if (msgBtn.dataset.action === 'edit') { editMessage(text); }
                else if (msgBtn.dataset.action === 'delete') { deleteMessage(msgEl); }
            }
        }
    });

    window.addEventListener('message', function (e) {
        const m = e.data;
        switch (m.type) {
            case 'addUserMessage': addMessage('user', m.text); break;
            case 'history':
                // 空会话保留欢迎/引导页，只有真的有历史消息时才隐藏
                if (m.messages && m.messages.length) {
                    welcome.style.display = 'none';
                    m.messages.forEach(function (msg) { addMessage(msg.role, msg.text); });
                    (function () {
                        const div = document.createElement('div');
                        div.className = 'history-divider';
                        div.textContent = S.historyDivider;
                        chat.appendChild(div);
                        scrollToBottom();
                    })();
                    renderMermaid();
                }
                break;
            case 'thinkingStart': showThinking(); break;
            case 'thinkingDelta': appendThinking(m.text); break;
            case 'thinkingEnd': hideThinking(); break;
            case 'toolCall': addTool(m.tool, m.detail, m.toolCallId); break;
            case 'toolUpdate': setToolOutput(m.toolCallId, m.output); break;
            case 'toolEnd': endTool(m.toolCallId, m); break;
            case 'assistantStart':
                hideThinking();
                currentBuffer = '';
                currentBody = addMessage('assistant', '');
                currentBody.classList.add('stream-cursor');
                break;
            case 'assistantChunk':
                if (currentBody) { currentBuffer += m.text; currentBody.innerHTML = renderMarkdown(currentBuffer); scrollToBottom(); }
                break;
            case 'assistantEnd':
                if (currentBody) { currentBody.classList.remove('stream-cursor'); currentBody = null; currentBuffer = ''; }
                renderMermaid();
                scrollToBottom();
                break;
            case 'notice': addNotice(m.text); break;
            case 'error':
                hideThinking();
                if (currentBody) { currentBody.classList.remove('stream-cursor'); currentBody = null; currentBuffer = ''; }
                addMessage('assistant', m.text, true);
                break;
            case 'setBusy': setBusy(m.busy); break;
            case 'connecting':
                updateConnectionStatus('connecting');
                modelsList = [];
                currentModel = null;
                modelLabel.textContent = S.connecting;
                modelPanel.innerHTML = '';
                break;
            case 'models': {
                modelsList = m.models || [];
                currentModel = m.current || null;
                if (modelsList.length === 0) {
                    updateConnectionStatus('disconnected');
                    modelLabel.textContent = S.connectionFailed;
                } else {
                    updateConnectionStatus('connected');
                }
                renderModelPanel();
                break;
            }
            case 'modelsError':
                modelLabel.textContent = S.noModels;
                modelPanel.innerHTML = '<div class="popover-empty">' + S.noModels + '</div>';
                break;
            case 'thinking': {
                thinkingLevels = m.levels || [];
                currentThinking = m.currentThinking || null;
                renderThinkingPanel();
                break;
            }
            case 'permission': {
                permissionMode = m.permissionMode || 'ask';
                renderPermissionPanel();
                break;
            }
            case 'stats': {
                renderStats(m.stats);
                break;
            }
            case 'contexts': {
                contexts = m.contexts || [];
                renderChips();
                break;
            }
            case 'sessions': {
                sessionsList = m.sessions || [];
                currentSessionId = m.current || null;
                renderSessionPanel();
                break;
            }
            case 'clear':
                chat.querySelectorAll('.message, .status-line, .activity, .history-divider, .collapsible').forEach(function (el) { el.remove(); });
                welcome.style.display = '';
                currentBody = null;
                currentBuffer = '';
                thinkingLine = null;
                thinkingContent = '';
                runningTools = {};
                contexts = [];
                renderChips();
                ctxStats.classList.add('hidden');
                clearSearch();
                updateMessageCount();
                scrollToBottom();
                break;
        }
    });

    scrollToBottom();
    input.focus();
    // 通知扩展宿主：监听器已就绪，可以开始连接/回推状态
    vscode.postMessage({ type: 'ready' });
