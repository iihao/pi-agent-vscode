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
    const imageRow = document.getElementById('imageRow');
    const suggest = document.getElementById('suggest');
    const modelBtn = document.getElementById('modelBtn');
    const modelLabel = document.getElementById('modelLabel');
    const modelPanel = document.getElementById('modelPanel');
    const thinkingBtn = document.getElementById('thinkingBtn');
    const thinkingLabel = document.getElementById('thinkingLabel');
    const thinkingPanel = document.getElementById('thinkingPanel');
    const permBtn = document.getElementById('permBtn');
    const permLabel = document.getElementById('permLabel');
    const permPanel = document.getElementById('permPanel');
    const attachPanel = document.getElementById('attachPanel');
    let attachOpenEditors = [];
    let attachRecent = [];
    let attachPending = false;
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
    const outlinePanel = document.getElementById('outlinePanel');
    const msgRail = document.getElementById('msgRail');
    const msgNav = document.getElementById('msgNav');
    const qPrev = document.getElementById('qPrev');
    const qNext = document.getElementById('qNext');
    const qCounter = document.getElementById('qCounter');
    const qCount = document.getElementById('qCount');
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
    // 待发送的粘贴图片
    let pendingImages = [];

    function shortId(id) { return id ? String(id).slice(0, 8) : S.sessionTitle; }

    const THINKING_LABELS = S.thinkingLevels;

    function closePopovers() {
        modelPanel.classList.add('hidden');
        thinkingPanel.classList.add('hidden');
        sessionPanel.classList.add('hidden');
        permPanel.classList.add('hidden');
        attachPanel.classList.add('hidden');
        outlinePanel.classList.add('hidden');
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

    function renderAttachPanel() {
        let html = '<button class="popover-item" data-action="workspace">' +
            '<span class="popover-item-main">' + escapeHtml(S.attachFilesFolders) + '</span></button>';
        if (attachOpenEditors.length) {
            html += '<div class="popover-label">' + escapeHtml(S.attachOpenEditors) + '</div>';
            attachOpenEditors.forEach(function (f) {
                html += '<button class="popover-item" data-action="path" data-path="' + escapeAttr(f.path) + '"' +
                    (f.range ? ' data-range="' + escapeAttr(f.range) + '"' : '') + '>' +
                    '<span class="popover-item-main">' + escapeHtml(f.label) + '</span>' +
                    (f.range ? '<span class="popover-item-meta">' + escapeHtml(f.range) + '</span>' : '') + '</button>';
            });
        }
        if (attachRecent.length) {
            html += '<div class="popover-label">' + escapeHtml(S.attachRecent) + '</div>';
            attachRecent.forEach(function (f) {
                html += '<button class="popover-item" data-action="path" data-path="' + escapeAttr(f.path) + '">' +
                    '<span class="popover-item-main">' + escapeHtml(f.label) + '</span></button>';
            });
        }
        attachPanel.innerHTML = html;
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

    function sessionDisplayName(s) {
        // 用户重命名 > 自动命名 > 首条提问预览 > id 前 8 位
        return s.name || s.preview || shortId(s.id);
    }

    function renderSessionPanel() {
        if (!sessionsList.length) {
            sessionLabel.textContent = S.currentSession;
            sessionPanel.innerHTML = '<div class="popover-empty">' + S.noSessions + '</div>';
            return;
        }
        const cur = sessionsList.find(function (s) { return s.id === currentSessionId; });
        sessionLabel.textContent = cur ? sessionDisplayName(cur) : S.currentSession;
        let html = '';
        sessionsList.forEach(function (s) {
            const date = new Date(s.createdAt);
            const dateStr = (date.getMonth() + 1) + '/' + date.getDate() + ' ' + date.getHours() + ':' + String(date.getMinutes()).padStart(2, '0');
            const active = s.id === currentSessionId;
            const label = sessionDisplayName(s);
            html += '<div class="session-row' + (active ? ' active' : '') + '" data-id="' + escapeHtml(s.id) + '" data-name="' + escapeHtml(s.name || '') + '">' +
                '<button class="session-row-main">' +
                    '<span class="session-row-title" title="' + escapeHtml(label) + '">' + escapeHtml(label) + '</span>' +
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

    function isNearBottom() {
        return (chat.scrollHeight - chat.scrollTop - chat.clientHeight) < 80;
    }

    // 流式渲染：合并同一帧内的多个 chunk，避免每个 chunk 全量重渲染 markdown（O(n²)），
    // 并只在用户本就在底部时自动滚动（不抢走向上翻阅）。
    let streamRenderScheduled = false;
    function flushStreamRender() {
        streamRenderScheduled = false;
        if (!currentBody) { return; }
        const stick = isNearBottom();
        currentBody.innerHTML = renderMarkdown(currentBuffer);
        if (stick) { scrollToBottom(); }
    }
    function scheduleStreamRender() {
        if (streamRenderScheduled) { return; }
        streamRenderScheduled = true;
        requestAnimationFrame(flushStreamRender);
    }
    
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
    md.renderer.rules.image = function (tokens, idx, options, env, self) {
        const token = tokens[idx];
        const src = token.attrGet('src') || '';
        // 远程图片不自动加载（防追踪像素 / 泄露 IP）；改为可点击链接，用系统浏览器打开
        if (/^https?:\/\//i.test(src)) {
            const alt = self.renderInlineAsText(token.children, options, env) || src;
            return '<a href="' + escapeHtml(src) + '" target="_blank" rel="noopener noreferrer">🖼 ' + escapeHtml(alt) + '</a>';
        }
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

    function escapeAttr(s) {
        return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
        renderRail();
    }

    // ========== 本回合改动审阅 ==========

    function renderTurnChanges(files) {
        const existing = chat.querySelector('.turn-changes');
        if (existing) { existing.remove(); }
        if (!files || !files.length) { return; }
        const el = document.createElement('div');
        el.className = 'turn-changes';
        let rows = '';
        files.forEach(function (f) {
            const isAdd = f.status === 'created';
            rows += '<button class="turn-file" data-path="' + escapeHtml(f.path) + '" title="' + escapeHtml(f.path) + '">' +
                '<span class="turn-file-badge ' + (isAdd ? 'add' : 'mod') + '">' + (isAdd ? 'A' : 'M') + '</span>' +
                '<span class="turn-file-path">' + escapeHtml(f.path) + '</span></button>';
        });
        el.innerHTML = '<div class="turn-changes-head">' +
            '<span class="turn-changes-title">' + S.changedFiles + ' (' + files.length + ')</span>' +
            '<button class="turn-changes-revert" data-act="revert">' + S.revert + '</button>' +
            '</div><div class="turn-changes-list">' + rows + '</div>';
        chat.appendChild(el);
        scrollToBottom();
    }

    // ========== 问题导航（右侧刻度 + 头部列表） ==========

    function getUserMessageEls() {
        return Array.prototype.slice.call(chat.querySelectorAll('.message.user'));
    }

    function messagePreview(el) {
        // 缓存到元素上：避免每次重建导航条都克隆 DOM 取 innerText（O(n²)）
        if (el.dataset.preview !== undefined) { return el.dataset.preview; }
        const body = el.querySelector('.message-body');
        const p = (getMessageText(body) || '').replace(/\s+/g, ' ').trim();
        el.dataset.preview = p;
        return p;
    }

    let railCount = -1;
    function renderRail() {
        const users = getUserMessageEls();
        if (users.length === railCount) { return; } // 助手消息不改变提问数，无需重建
        railCount = users.length;
        const show = users.length >= 2;
        msgNav.classList.toggle('hidden', !show);
        if (!show) { msgRail.classList.add('hidden'); msgRail.innerHTML = ''; return; }
        msgRail.classList.remove('hidden');
        let html = '';
        users.forEach(function (el, i) {
            const preview = escapeHtml(messagePreview(el).slice(0, 140));
            html += '<button class="rail-dot" data-i="' + i + '" title="' + preview + '" aria-label="' + preview + '"></button>';
        });
        msgRail.innerHTML = html;
        updateRailActive();
    }

    function currentActiveIndex() {
        const users = getUserMessageEls();
        if (!users.length) { return -1; }
        const anchor = chat.getBoundingClientRect().top + 40;
        let active = 0;
        for (let i = 0; i < users.length; i++) {
            if (users[i].getBoundingClientRect().top <= anchor) { active = i; }
            else { break; }
        }
        return active;
    }

    function updateRailActive() {
        const active = currentActiveIndex();
        msgRail.querySelectorAll('.rail-dot').forEach(function (d, i) {
            d.classList.toggle('active', i === active);
        });
        const users = getUserMessageEls();
        qPrev.disabled = active <= 0;
        qNext.disabled = active < 0 || active >= users.length - 1;
        if (users.length) {
            qCount.textContent = (Math.max(0, active) + 1) + '/' + users.length;
        }
    }

    function jumpToUserMessage(i) {
        const users = getUserMessageEls();
        if (i < 0 || i >= users.length) { return; }
        const el = users[i];
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        el.classList.add('flash');
        setTimeout(function () { el.classList.remove('flash'); }, 1200);
    }

    function navigateUserMessage(dir) {
        const users = getUserMessageEls();
        if (!users.length) { return; }
        const cur = currentActiveIndex();
        const next = Math.min(users.length - 1, Math.max(0, cur + dir));
        if (next !== cur) { jumpToUserMessage(next); }
    }

    function renderOutline() {
        const users = getUserMessageEls();
        if (!users.length) {
            outlinePanel.innerHTML = '<div class="popover-empty">' + S.noMessages + '</div>';
            return;
        }
        const active = currentActiveIndex();
        let html = '';
        users.forEach(function (el, i) {
            const p = escapeHtml(messagePreview(el).slice(0, 200));
            html += '<button class="popover-item outline-item' + (i === active ? ' active' : '') + '" data-i="' + i + '">' +
                '<span class="outline-index">' + (i + 1) + '</span>' +
                '<span class="outline-text">' + p + '</span></button>';
        });
        outlinePanel.innerHTML = html;
    }

    function renderMessageImages(images) {
        const wrap = document.createElement('div');
        wrap.className = 'message-images';
        images.forEach(function (img) {
            const src = img.dataUrl || (img.data && img.mimeType ? 'data:' + img.mimeType + ';base64,' + img.data : '');
            if (!src) { return; }
            const im = document.createElement('img');
            im.src = src;
            im.alt = '';
            im.loading = 'lazy';
            wrap.appendChild(im);
        });
        return wrap;
    }

    function addMessage(role, markdown, isError, pending, images) {
        welcome.style.display = 'none';
        const el = document.createElement('div');
        el.className = 'message ' + (isError ? 'error' : role);
        if (pending) {
            el.dataset.pending = pending;
            el.dataset.pendingText = markdown || '';
        }
        const label = role === 'user' ? S.you : 'Pi';
        const time = formatTime();
        const badge = pending
            ? '<span class="pending-badge ' + pending + '">' + (pending === 'steering' ? S.steering : S.queued) + '</span>'
            : '';
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
        el.innerHTML = '<div class="message-header"><span class="role-label">' + label + '</span>' + badge + '<span class="message-time">' + time + '</span>' + actions + '</div><div class="message-body"></div>';
        const body = el.querySelector('.message-body');
        if (images && images.length) { body.appendChild(renderMessageImages(images)); }
        body.insertAdjacentHTML('beforeend', renderMarkdown(markdown));
        chat.appendChild(el);
        scrollToBottom();
        updateMessageCount();
        renderRail();
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
        input.placeholder = value ? S.inputBusyPlaceholder : S.inputPlaceholder;
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

    // ========== 图片粘贴 ==========

    const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
    function readImage(file) {
        if (file.size > MAX_IMAGE_BYTES) {
            vscode.postMessage({ type: 'notify', text: S.imageTooLarge });
            return;
        }
        const reader = new FileReader();
        reader.onload = function () {
            const dataUrl = String(reader.result || '');
            const comma = dataUrl.indexOf(',');
            if (comma === -1) { return; }
            pendingImages.push({ mimeType: file.type || 'image/png', data: dataUrl.slice(comma + 1), dataUrl: dataUrl });
            renderImages();
        };
        reader.readAsDataURL(file);
    }

    function renderImages() {
        if (!pendingImages.length) { imageRow.classList.add('hidden'); imageRow.innerHTML = ''; return; }
        imageRow.classList.remove('hidden');
        let html = '';
        pendingImages.forEach(function (img, i) {
            html += '<div class="image-thumb"><img src="' + img.dataUrl + '" alt=""><button data-i="' + i + '" title="' + S.remove + '">✕</button></div>';
        });
        imageRow.innerHTML = html;
    }

    // ========== `!` shell 命令 ==========

    function bashId() {
        return 'bash-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
    }

    function addBashRunning(id, command) {
        welcome.style.display = 'none';
        const el = document.createElement('div');
        el.className = 'activity bash running collapsed';
        el.dataset.bashId = id;
        const head = document.createElement('div');
        head.className = 'activity-head';
        head.innerHTML =
            '<span class="activity-caret">▾</span>' +
            '<span class="activity-name">$</span>' +
            '<span class="activity-detail">' + escapeHtml(command) + '</span>' +
            '<span class="activity-status"><span class="activity-spinner"></span></span>';
        const body = document.createElement('div');
        body.className = 'activity-body';
        head.addEventListener('click', function () { el.classList.toggle('collapsed'); });
        el.appendChild(head);
        el.appendChild(body);
        chat.appendChild(el);
        scrollToBottom();
    }

    function finishBash(m) {
        const el = chat.querySelector('.activity.bash[data-bash-id="' + m.id + '"]');
        if (!el) { return; }
        el.classList.remove('running');
        el.classList.add(m.isError ? 'failed' : 'done');
        const status = el.querySelector('.activity-status');
        if (status) {
            const mark = m.cancelled ? '⏹' : (m.isError ? '✗' : '✓');
            const code = (m.exitCode !== undefined && !m.cancelled) ? '  exit ' + m.exitCode : '';
            status.textContent = mark + code;
        }
        const body = el.querySelector('.activity-body');
        const pre = document.createElement('pre');
        pre.className = 'activity-output' + (m.isError ? ' error' : '');
        pre.textContent = m.output || '';
        body.appendChild(pre);
        if (m.truncated) {
            const note = document.createElement('div');
            note.className = 'status-line notice';
            note.textContent = S.bashTruncated;
            body.appendChild(note);
        }
        scrollToBottom();
    }

    // ========== 排队 / steer 状态 ==========

    function clearPending(el) {
        el.removeAttribute('data-pending');
        el.removeAttribute('data-pending-text');
        const badge = el.querySelector('.pending-badge');
        if (badge) { badge.remove(); }
    }

    function updateQueueBadges(steering, followUp) {
        const all = (steering || []).concat(followUp || []);
        chat.querySelectorAll('.message.user[data-pending]').forEach(function (el) {
            const raw = el.dataset.pendingText || '';
            // 队列里的文本带 context 块，用包含匹配；纯图片消息没有文本可匹配，
            // 只能在队列清空时一并清除，避免徽章永久残留。
            const stillQueued = raw
                ? all.some(function (q) { return q === raw || q.indexOf(raw) !== -1; })
                : all.length > 0;
            if (!stillQueued) { clearPending(el); }
        });
    }

    // ========== 斜杠命令 / @ 文件提及 ==========

    let slashCommands = [];
    let filesList = null;
    let suggestItems = [];
    let suggestIndex = 0;
    let suggestMode = null;
    let suggestStart = 0;
    let suggestEnd = 0;

    function detectSuggestToken() {
        const pos = input.selectionStart;
        const before = input.value.slice(0, pos);
        const slash = /^\/([^\s]*)$/.exec(before);
        if (slash) { return { mode: 'slash', start: 0, end: pos, filter: slash[1] }; }
        const at = /(^|\s)@([^\s@]*)$/.exec(before);
        if (at) { return { mode: 'file', start: pos - at[2].length - 1, end: pos, filter: at[2] }; }
        return null;
    }

    function updateSuggest() {
        const token = detectSuggestToken();
        if (!token) { closeSuggest(); return; }
        suggestMode = token.mode;
        suggestStart = token.start;
        suggestEnd = token.end;
        const f = token.filter.toLowerCase();
        if (token.mode === 'slash') {
            suggestItems = slashCommands.filter(function (c) {
                return c.name.toLowerCase().indexOf(f) !== -1 || (c.description || '').toLowerCase().indexOf(f) !== -1;
            }).slice(0, 50).map(function (c) {
                return { label: '/' + c.name, detail: c.description || '', source: c.source || '', insert: '/' + c.name + ' ' };
            });
        } else {
            if (filesList === null) { vscode.postMessage({ type: 'requestFiles' }); }
            const list = filesList || [];
            const matched = [];
            for (let i = 0; i < list.length && matched.length < 50; i++) {
                if (list[i].toLowerCase().indexOf(f) !== -1) { matched.push(list[i]); }
            }
            suggestItems = matched.map(function (p) {
                return { label: '@' + p, detail: '', source: '', insert: '@' + p + ' ' };
            });
        }
        suggestIndex = 0;
        renderSuggest();
    }

    function renderSuggest() {
        if (!suggestItems.length) { closeSuggest(); return; }
        if (suggestIndex >= suggestItems.length) { suggestIndex = 0; }
        let html = '';
        suggestItems.forEach(function (it, i) {
            html += '<div class="suggest-item' + (i === suggestIndex ? ' active' : '') + '" data-i="' + i + '">' +
                '<span class="suggest-label">' + escapeHtml(it.label) + '</span>' +
                (it.detail ? '<span class="suggest-detail">' + escapeHtml(it.detail) + '</span>' : '') +
                (it.source ? '<span class="suggest-source">' + escapeHtml(it.source) + '</span>' : '') +
                '</div>';
        });
        suggest.innerHTML = html;
        suggest.classList.remove('hidden');
    }

    function closeSuggest() {
        suggestMode = null;
        suggestItems = [];
        suggestIndex = 0;
        suggest.classList.add('hidden');
        suggest.innerHTML = '';
    }

    function acceptSuggest() {
        if (!suggestMode || !suggestItems.length) { return; }
        const item = suggestItems[suggestIndex];
        input.value = input.value.slice(0, suggestStart) + item.insert + input.value.slice(suggestEnd);
        const caret = suggestStart + item.insert.length;
        input.selectionStart = input.selectionEnd = caret;
        closeSuggest();
        input.focus();
        autoResizeInput();
    }

    function suggestOpen() {
        return !suggest.classList.contains('hidden') && suggestItems.length > 0;
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

    function send(mode) {
        const text = input.value.trim();
        const images = pendingImages.map(function (i) { return { type: 'image', data: i.data, mimeType: i.mimeType }; });
        if (!text && !images.length) { return; }
        // 保存到历史
        if (text && (messageHistory.length === 0 || messageHistory[messageHistory.length - 1] !== text)) {
            messageHistory.push(text);
            if (messageHistory.length > 50) messageHistory.shift();
        }
        historyIndex = -1;
        // `!` 前缀：直接执行 shell 命令，不经过模型回合
        if (text.charAt(0) === '!') {
            const command = text.slice(1).trim();
            if (command) {
                const id = bashId();
                addBashRunning(id, command);
                vscode.postMessage({ type: 'runBash', text: command, id: id });
            }
            input.value = '';
            autoResizeInput();
            return;
        }
        // 忙碌时：默认排队（follow-up），带修饰键则 steer 插入当前回合
        vscode.postMessage({ type: 'sendMessage', text: text, mode: busy ? (mode || 'queue') : undefined, images: images.length ? images : undefined });
        input.value = '';
        pendingImages = [];
        renderImages();
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

    // 问题导航事件
    qCounter.addEventListener('click', function (e) {
        e.stopPropagation();
        const willShow = outlinePanel.classList.contains('hidden');
        closePopovers();
        if (willShow) { renderOutline(); outlinePanel.classList.remove('hidden'); }
    });
    outlinePanel.addEventListener('click', function (e) {
        const it = e.target.closest('.outline-item');
        if (!it) { return; }
        jumpToUserMessage(Number(it.dataset.i));
        outlinePanel.classList.add('hidden');
    });
    msgRail.addEventListener('click', function (e) {
        const dot = e.target.closest('.rail-dot');
        if (dot) { jumpToUserMessage(Number(dot.dataset.i)); }
    });
    qPrev.addEventListener('click', function () { navigateUserMessage(-1); });
    qNext.addEventListener('click', function () { navigateUserMessage(1); });
    let railRaf = 0;
    chat.addEventListener('scroll', function () {
        if (railRaf) { return; }
        railRaf = requestAnimationFrame(function () { railRaf = 0; updateRailActive(); });
    });

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
    input.addEventListener('input', function () { autoResizeInput(); updateSuggest(); });
    input.addEventListener('click', function () { updateSuggest(); });
    input.addEventListener('paste', function (e) {
        const items = e.clipboardData && e.clipboardData.items;
        if (!items) { return; }
        let handled = false;
        for (let i = 0; i < items.length; i++) {
            const it = items[i];
            if (it.kind === 'file' && it.type && it.type.indexOf('image/') === 0) {
                const file = it.getAsFile();
                if (file) { readImage(file); handled = true; }
            }
        }
        if (handled) { e.preventDefault(); }
    });
    imageRow.addEventListener('click', function (e) {
        const btn = e.target.closest('button[data-i]');
        if (btn) { pendingImages.splice(Number(btn.dataset.i), 1); renderImages(); }
    });
    input.addEventListener('keyup', function (e) {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') { updateSuggest(); }
    });
    ['dragenter', 'dragover'].forEach(function (ev) {
        input.addEventListener(ev, function (e) { e.preventDefault(); });
    });
    input.addEventListener('drop', function (e) {
        e.preventDefault();
        const dt = e.dataTransfer;
        if (!dt) { return; }
        let raw = '';
        try { raw = dt.getData('text/uri-list') || dt.getData('text/plain') || ''; } catch (err) { raw = ''; }
        const paths = raw.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(function (s) { return s && s.charAt(0) !== '#'; });
        if (paths.length) { vscode.postMessage({ type: 'dropFiles', paths: paths }); }
    });
    suggest.addEventListener('mousedown', function (e) {
        const it = e.target.closest('.suggest-item');
        if (!it) { return; }
        e.preventDefault();
        suggestIndex = Number(it.dataset.i);
        acceptSuggest();
    });
    input.addEventListener('keydown', function (e) {
        // Alt+↑/↓ 交给文档级处理器做问题跳转，不当作输入历史
        if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { return; }
        // 补全菜单优先响应方向键 / 回车 / Tab / Esc
        if (suggestOpen()) {
            if (e.key === 'ArrowDown') { e.preventDefault(); suggestIndex = (suggestIndex + 1) % suggestItems.length; renderSuggest(); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); suggestIndex = (suggestIndex - 1 + suggestItems.length) % suggestItems.length; renderSuggest(); return; }
            if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); acceptSuggest(); return; }
            if (e.key === 'Escape') { e.preventDefault(); closeSuggest(); return; }
        }
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            send(e.ctrlKey || e.metaKey ? 'steer' : undefined);
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
        btn.addEventListener('click', function () {
            vscode.postMessage({ type: 'sendMessage', text: btn.dataset.q, mode: busy ? 'queue' : undefined });
        });
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
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { closePopovers(); return; }
        // Alt+↑/↓：在用户提问之间快速跳转
        if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
            e.preventDefault();
            navigateUserMessage(e.key === 'ArrowDown' ? 1 : -1);
        }
    });
    attachBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        const willShow = attachPanel.classList.contains('hidden');
        closePopovers();
        if (willShow) { attachPending = true; vscode.postMessage({ type: 'requestAttachMenu' }); }
        else { attachPending = false; }
    });
    attachPanel.addEventListener('click', function (e) {
        const item = e.target.closest('.popover-item');
        if (!item) { return; }
        const action = item.dataset.action;
        if (action === 'workspace') { vscode.postMessage({ type: 'attachWorkspace' }); }
        else if (action === 'path') {
            vscode.postMessage({ type: 'attachPath', path: item.dataset.path, range: item.dataset.range || undefined });
        }
        closePopovers();
    });
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
        // 本回合改动：打开文件 / 撤销
        var turnFile = e.target.closest('.turn-file');
        if (turnFile) { vscode.postMessage({ type: 'openFile', path: turnFile.dataset.path }); return; }
        var revertBtn = e.target.closest('.turn-changes-revert');
        if (revertBtn) { vscode.postMessage({ type: 'revertTurn' }); return; }
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
            case 'addUserMessage': addMessage('user', m.text, false, m.pending, m.images); break;
            case 'history':
                // 空会话保留欢迎/引导页，只有真的有历史消息时才隐藏
                if (m.messages && m.messages.length) {
                    welcome.style.display = 'none';
                    m.messages.forEach(function (msg) { addMessage(msg.role, msg.text, false, undefined, msg.images); });
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
                if (currentBody) { currentBuffer += m.text; scheduleStreamRender(); }
                break;
            case 'assistantEnd':
                if (currentBody) {
                    streamRenderScheduled = false;
                    const stick = isNearBottom();
                    currentBody.innerHTML = renderMarkdown(currentBuffer);
                    currentBody.classList.remove('stream-cursor');
                    currentBody = null;
                    currentBuffer = '';
                    if (stick) { scrollToBottom(); }
                }
                renderMermaid();
                break;
            case 'notice': addNotice(m.text); break;
            case 'focusInput': input.focus(); break;
            case 'editLast': {
                const users = chat.querySelectorAll('.message.user');
                const last = users[users.length - 1];
                if (last) { editMessage(getMessageText(last.querySelector('.message-body'))); }
                break;
            }
            case 'queue': updateQueueBadges(m.steering, m.followUp); break;
            case 'bashResult': finishBash(m); break;
            case 'turnChanges': renderTurnChanges(m.files); break;
            case 'commands': slashCommands = m.commands || []; if (suggestMode === 'slash') { updateSuggest(); } break;
            case 'files': filesList = m.files || []; if (suggestMode === 'file') { updateSuggest(); } break;
            case 'insertMentions': {
                const insert = (m.paths || []).map(function (p) { return '@' + p + ' '; }).join('');
                if (insert) {
                    const pos = input.selectionStart;
                    input.value = input.value.slice(0, pos) + insert + input.value.slice(input.selectionEnd);
                    input.selectionStart = input.selectionEnd = pos + insert.length;
                    input.focus();
                    autoResizeInput();
                }
                break;
            }
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
            case 'attachMenu': {
                attachOpenEditors = m.openEditors || [];
                attachRecent = m.recentFiles || [];
                if (attachPending) {
                    renderAttachPanel();
                    attachPanel.classList.remove('hidden');
                    attachPending = false;
                }
                break;
            }
            case 'sessions': {
                sessionsList = m.sessions || [];
                currentSessionId = m.current || null;
                renderSessionPanel();
                break;
            }
            case 'clear':
                chat.querySelectorAll('.message, .status-line, .activity, .history-divider, .collapsible, .turn-changes').forEach(function (el) { el.remove(); });
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
                closeSuggest();
                pendingImages = [];
                renderImages();
                updateMessageCount();
                renderRail();
                scrollToBottom();
                break;
        }
    });

    scrollToBottom();
    input.focus();
    // 通知扩展宿主：监听器已就绪，可以开始连接/回推状态
    vscode.postMessage({ type: 'ready' });
