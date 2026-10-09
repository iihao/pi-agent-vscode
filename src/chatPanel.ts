import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import type { RpcClient, JsonAgentSessionEvent } from '@earendil-works/pi-coding-agent' with { 'resolution-mode': 'import' };

// pi SDK 是 ESM-only；本扩展编译为 CJS（node16 模式下动态 import 原样保留），
// Node 支持在 CJS 中动态 import ESM 包
type PiSdkModule = typeof import('@earendil-works/pi-coding-agent', { with: { 'resolution-mode': 'import' } });
let sdkPromise: Promise<PiSdkModule> | undefined;
function loadPiSdk(): Promise<PiSdkModule> {
    if (!sdkPromise) {
        sdkPromise = import('@earendil-works/pi-coding-agent');
    }
    return sdkPromise;
}

export class ChatPanel {
    public static currentPanel: ChatPanel | undefined;
    public static readonly viewType = 'pi-assistant.chatView';

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionPath: string;
    private _disposables: vscode.Disposable[] = [];
    private _client: RpcClient | undefined;
    private _unsubscribe: (() => void) | undefined;
    private _starting: Promise<void> | undefined;
    private _busy = false;
    private _turnHadText = false;

    private constructor(panel: vscode.WebviewPanel, extensionPath: string) {
        this._panel = panel;
        this._extensionPath = extensionPath;
        this._panel.webview.html = this._getHtmlForWebview();

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            (message: { type: string; text?: string; code?: string }) => {
                switch (message.type) {
                    case 'sendMessage':
                        if (message.text) {
                            void this._handleUserMessage(message.text);
                        }
                        break;
                    case 'abort':
                        void this._abort();
                        break;
                    case 'clearChat':
                        this.clear();
                        break;
                    case 'copyCode':
                        if (message.code) {
                            void vscode.env.clipboard.writeText(message.code).then(() => {
                                vscode.window.showInformationMessage('代码已复制到剪贴板');
                            });
                        }
                        break;
                }
            },
            null,
            this._disposables
        );
    }

    public static createOrShow(extensionPath: string): ChatPanel {
        const column = vscode.ViewColumn.Beside;

        if (ChatPanel.currentPanel) {
            ChatPanel.currentPanel._panel.reveal(column);
            return ChatPanel.currentPanel;
        }

        const panel = vscode.window.createWebviewPanel(
            ChatPanel.viewType,
            'Pi Assistant',
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
            }
        );

        ChatPanel.currentPanel = new ChatPanel(panel, extensionPath);
        return ChatPanel.currentPanel;
    }

    public clear() {
        this._post({ type: 'clear' });
    }

    /** 供命令调用的直接提问入口（如「解释代码」右键命令） */
    public async askQuestion(question: string) {
        await this._handleUserMessage(question);
    }

    // ---------- pi RpcClient 生命周期 ----------

    private async _ensureClient(): Promise<RpcClient> {
        if (this._client) {
            return this._client;
        }
        if (!this._starting) {
            this._starting = this._startClient().catch((err) => {
                this._starting = undefined; // 允许下次重试
                throw err;
            });
        }
        await this._starting;
        if (!this._client) {
            throw new Error('Pi 客户端未能启动');
        }
        return this._client;
    }

    private async _startClient(): Promise<void> {
        const sdk = await loadPiSdk();
        const cliPath = path.join(
            this._extensionPath,
            'node_modules',
            '@earendil-works',
            'pi-coding-agent',
            'dist',
            'cli.js'
        );
        if (!fs.existsSync(cliPath)) {
            throw new Error(`找不到 pi CLI（${cliPath}），请确认依赖已安装`);
        }

        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
        const client = new sdk.RpcClient({
            cliPath,
            cwd,
            args: ['--no-session'],
        });

        this._unsubscribe = client.onEvent((event) => this._onAgentEvent(event));
        await client.start();
        this._client = client;
        this._post({
            type: 'notice',
            text: `已连接 pi（工作目录：${vscode.workspace.asRelativePath(cwd, false) || cwd}）`,
        });
    }

    private async _abort(): Promise<void> {
        if (this._client) {
            try {
                await this._client.abort();
            } catch {
                /* 忽略中止异常 */
            }
        }
    }

    // ---------- 事件桥接（pi → webview） ----------

    private _onAgentEvent(event: JsonAgentSessionEvent): void {
        switch (event.type) {
            case 'agent_start':
                this._busy = true;
                this._turnHadText = false;
                this._post({ type: 'setBusy', busy: true });
                break;

            case 'message_update': {
                const ae = event.assistantMessageEvent;
                if (ae.type === 'thinking_start') {
                    this._post({ type: 'thinkingStart' });
                } else if (ae.type === 'thinking_end') {
                    this._post({ type: 'thinkingEnd' });
                } else if (ae.type === 'text_delta' && ae.delta) {
                    if (!this._turnHadText) {
                        this._turnHadText = true;
                        this._post({ type: 'assistantStart' });
                    }
                    this._post({ type: 'assistantChunk', text: ae.delta });
                } else if (ae.type === 'text_end') {
                    if (this._turnHadText) {
                        this._turnHadText = false;
                        this._post({ type: 'assistantEnd' });
                    }
                }
                break;
            }

            case 'tool_execution_start':
                this._turnHadText = false; // 工具之后的文本另起气泡
                this._post({
                    type: 'toolCall',
                    tool: event.toolName,
                    detail: this._summarizeToolArgs(event.args),
                });
                break;

            case 'tool_execution_end':
                this._post({
                    type: 'toolEnd',
                    tool: event.toolName,
                    isError: Boolean(event.isError),
                });
                break;

            case 'auto_retry_start':
                this._post({
                    type: 'notice',
                    text: `自动重试（${event.attempt}/${event.maxAttempts}）：${event.errorMessage}`,
                });
                break;

            case 'agent_settled':
                this._busy = false;
                this._turnHadText = false;
                this._post({ type: 'thinkingEnd' });
                this._post({ type: 'setBusy', busy: false });
                break;

            default:
                // 其余事件（usage/turn 边界等）暂不展示
                break;
        }
    }

    private _summarizeToolArgs(args: unknown): string {
        try {
            const a = args as Record<string, unknown> | undefined;
            if (!a) {
                return '';
            }
            if (typeof a.path === 'string') {
                return a.path;
            }
            if (typeof a.command === 'string') {
                const cmd = String(a.command);
                return cmd.length > 90 ? cmd.slice(0, 90) + '…' : cmd;
            }
            const json = JSON.stringify(a);
            return json.length > 90 ? json.slice(0, 90) + '…' : json;
        } catch {
            return '';
        }
    }

    // ---------- 用户消息 ----------

    private async _handleUserMessage(userText: string) {
        if (this._busy) {
            vscode.window.showWarningMessage('Pi 正在工作，请等待完成或点击「停止」');
            return;
        }

        this._post({ type: 'addUserMessage', text: userText });
        this._busy = true;
        this._post({ type: 'setBusy', busy: true });

        try {
            const client = await this._ensureClient();
            const disposition = await client.prompt(userText);
            if (disposition === 'handled') {
                // 被斜杠命令等直接处理，不会启动 agent 运行
                this._busy = false;
                this._post({ type: 'setBusy', busy: false });
            }
            // 其他情况等待事件流：agent_settled 会重置 busy 状态
        } catch (err) {
            this._busy = false;
            this._post({ type: 'thinkingEnd' });
            this._post({ type: 'setBusy', busy: false });
            this._post({ type: 'error', text: (err as Error).message });
        }
    }

    // ---------- Webview ----------

    private _post(message: Record<string, unknown>) {
        void this._panel.webview.postMessage(message);
    }

    private _getHtmlForWebview(): string {
        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
        font-family: var(--vscode-font-family);
        font-size: var(--vscode-font-size);
        color: var(--vscode-foreground);
        background: var(--vscode-sideBar-background);
        height: 100vh;
        display: flex;
        flex-direction: column;
        padding: 12px;
    }
    .chat-container { flex: 1; overflow-y: auto; padding-right: 6px; }
    .chat-container::-webkit-scrollbar { width: 8px; }
    .chat-container::-webkit-scrollbar-thumb { background: var(--vscode-scrollbarSlider-background); border-radius: 4px; }

    .welcome { text-align: center; padding: 28px 12px; color: var(--vscode-descriptionForeground); }
    .welcome h3 { margin-bottom: 10px; color: var(--vscode-foreground); }
    .welcome p { margin-bottom: 6px; font-size: 12px; }
    .quick-actions { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; margin-top: 14px; }
    .quick-action {
        padding: 5px 10px; background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
        border: 1px solid var(--vscode-widget-border); border-radius: 4px;
        cursor: pointer; font-size: 12px;
    }
    .quick-action:hover { background: var(--vscode-button-secondaryHoverBackground); }

    .message { margin-bottom: 14px; animation: fadeIn .2s ease; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
    .message-header { display: flex; align-items: center; gap: 6px; margin-bottom: 5px; }
    .avatar { font-size: 15px; }
    .name { font-weight: 600; font-size: 12px; color: var(--vscode-descriptionForeground); }
    .message-body {
        line-height: 1.6; padding: 10px 12px; border-radius: 8px;
        background: var(--vscode-editor-background);
        border: 1px solid var(--vscode-widget-border);
        overflow-wrap: anywhere;
    }
    .message.user .message-body { background: var(--vscode-input-background); }
    .message.error .message-body {
        border-color: var(--vscode-inputValidation-errorBorder, #f44);
        color: var(--vscode-errorForeground, #f66);
    }
    .message-body .text-block { margin-bottom: 6px; }
    .message-body .text-block:last-child { margin-bottom: 0; }
    .md-heading { font-weight: 700; margin: 6px 0 4px; }
    .md-li { margin: 2px 0; }
    .inline-code {
        background: var(--vscode-textCodeBlock-background);
        padding: 1px 5px; border-radius: 3px;
        font-family: var(--vscode-editor-font-family);
        font-size: .92em;
    }
    .code-block { margin: 8px 0; border-radius: 6px; overflow: hidden; border: 1px solid var(--vscode-widget-border); }
    .code-block-header {
        display: flex; justify-content: space-between; align-items: center;
        padding: 4px 10px; background: var(--vscode-tab-inactiveBackground);
        font-size: 11px; color: var(--vscode-descriptionForeground);
    }
    .code-actions { display: flex; gap: 6px; }
    .code-actions button {
        background: transparent; border: none; color: var(--vscode-foreground);
        cursor: pointer; padding: 2px 8px; border-radius: 3px; font-size: 11px;
    }
    .code-actions button:hover { background: var(--vscode-toolbar-hoverBackground); }
    .code-block pre { margin: 0; padding: 10px; background: var(--vscode-editor-background); overflow-x: auto; }
    .code-block code {
        font-family: var(--vscode-editor-font-family);
        font-size: 12.5px; line-height: 1.5;
    }
    .stream-cursor::after { content: '▊'; animation: blink 1s steps(1) infinite; }
    @keyframes blink { 50% { opacity: 0; } }

    /* 状态行：思考 / 工具调用 / 通知 */
    .status-line {
        display: flex; align-items: center; gap: 6px;
        font-size: 11.5px; color: var(--vscode-descriptionForeground);
        padding: 3px 8px; margin: 6px 0; border-radius: 4px;
        background: var(--vscode-textBlockQuote-background, rgba(127,127,127,.08));
        overflow-wrap: anywhere;
    }
    .status-line.thinking { font-style: italic; animation: pulse 1.6s ease-in-out infinite; }
    @keyframes pulse { 50% { opacity: .45; } }
    .status-line.tool.running { animation: pulse 1.2s ease-in-out infinite; }
    .status-line.tool.done { opacity: .85; }
    .status-line.tool.failed { color: var(--vscode-errorForeground, #f66); }
    .status-line.notice { font-size: 11px; opacity: .8; }

    .input-container { display: flex; gap: 8px; padding-top: 10px; border-top: 1px solid var(--vscode-widget-border); margin-top: 8px; }
    .input-box {
        flex: 1; min-height: 34px; max-height: 120px; padding: 7px 10px;
        border: 1px solid var(--vscode-input-border, transparent); border-radius: 4px;
        background: var(--vscode-input-background); color: var(--vscode-input-foreground);
        font-family: inherit; font-size: inherit; resize: none; outline: none;
    }
    .input-box:focus { border-color: var(--vscode-focusBorder); }
    .send-button {
        padding: 7px 14px; background: var(--vscode-button-background);
        color: var(--vscode-button-foreground); border: none; border-radius: 4px;
        cursor: pointer; font-weight: 500; align-self: flex-end; min-width: 58px;
    }
    .send-button:hover { background: var(--vscode-button-hoverBackground); }
    .send-button.stopping { background: var(--vscode-inputValidation-errorBackground, #5a1d1d); }
</style>
</head>
<body>
    <div class="chat-container" id="chat">
        <div class="welcome" id="welcome">
            <h3>👋 我是 Pi Assistant</h3>
            <p>由本地 pi agent 驱动：可以读写文件、运行命令、多步完成任务</p>
            <p>选中代码后右键「Pi: 解释代码 / 重构代码」快速开始</p>
            <div class="quick-actions">
                <button class="quick-action" data-q="解释我选中的代码">📖 解释代码</button>
                <button class="quick-action" data-q="审查当前文件，指出潜在问题">🐛 代码审查</button>
                <button class="quick-action" data-q="总结这个项目是做什么的">📋 项目总结</button>
                <button class="quick-action" data-q="运行项目的测试并报告结果">🧪 跑测试</button>
            </div>
        </div>
    </div>

    <div class="input-container">
        <textarea id="input" class="input-box" rows="1"
            placeholder="给 pi 一个任务…（Enter 发送，Shift+Enter 换行）"></textarea>
        <button id="send" class="send-button">发送</button>
    </div>

<script>
    const vscode = acquireVsCodeApi();
    const chat = document.getElementById('chat');
    const welcome = document.getElementById('welcome');
    const input = document.getElementById('input');
    const sendBtn = document.getElementById('send');

    let busy = false;
    let currentBody = null;
    let currentBuffer = '';
    let thinkingLine = null;

    function escapeHtml(s) {
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function scrollToBottom() { chat.scrollTop = chat.scrollHeight; }

    function renderMarkdown(src) {
        const parts = [];
        const regex = /\`\`\`(\\w*)\\n([\\s\\S]*?)(\`\`\`|$)/g;
        let lastIndex = 0;
        let match;
        while ((match = regex.exec(src)) !== null) {
            if (match.index > lastIndex) {
                parts.push({ type: 'text', content: src.slice(lastIndex, match.index) });
            }
            parts.push({
                type: 'code',
                lang: match[1] || 'code',
                content: match[2].replace(/\\n$/, ''),
                closed: match[3] === '\`\`\`'
            });
            lastIndex = regex.lastIndex;
        }
        if (lastIndex < src.length) {
            parts.push({ type: 'text', content: src.slice(lastIndex) });
        }

        return parts.map(function (p) {
            if (p.type === 'code') {
                const actions = p.closed
                    ? '<div class="code-actions">' +
                      '<button data-act="copy">复制</button>' +
                      '</div>'
                    : '';
                return '<div class="code-block">' +
                    '<div class="code-block-header"><span>' + escapeHtml(p.lang) + '</span>' + actions + '</div>' +
                    '<pre><code>' + escapeHtml(p.content) + '</code></pre>' +
                    '</div>';
            }
            let t = escapeHtml(p.content);
            t = t.replace(/\`([^\`\\n]+)\`/g, '<code class="inline-code">$1</code>');
            t = t.replace(/\\*\\*([^*\\n]+)\\*\\*/g, '<strong>$1</strong>');
            t = t.replace(/^#{1,4}\\s*(.+)$/gm, '<div class="md-heading">$1</div>');
            t = t.replace(/^\\s*[-*]\\s+(.+)$/gm, '<div class="md-li">• $1</div>');
            t = t.replace(/\\n/g, '<br>');
            return '<div class="text-block">' + t + '</div>';
        }).join('');
    }

    function addMessage(role, markdown, isError) {
        welcome.style.display = 'none';
        const el = document.createElement('div');
        el.className = 'message ' + (isError ? 'error' : role);
        const avatar = role === 'user' ? '👤' : '🤖';
        const name = role === 'user' ? '你' : 'Pi';
        el.innerHTML =
            '<div class="message-header"><span class="avatar">' + avatar + '</span><span class="name">' + name + '</span></div>' +
            '<div class="message-body"></div>';
        const body = el.querySelector('.message-body');
        body.innerHTML = renderMarkdown(markdown);
        chat.appendChild(el);
        scrollToBottom();
        return body;
    }

    function showThinking() {
        welcome.style.display = 'none';
        if (!thinkingLine) {
            thinkingLine = document.createElement('div');
            thinkingLine.className = 'status-line thinking';
            thinkingLine.textContent = '💭 思考中…';
            chat.appendChild(thinkingLine);
            scrollToBottom();
        }
    }

    function hideThinking() {
        if (thinkingLine) { thinkingLine.remove(); thinkingLine = null; }
    }

    function addToolLine(tool, detail) {
        welcome.style.display = 'none';
        hideThinking();
        const el = document.createElement('div');
        el.className = 'status-line tool running';
        el.textContent = '🔧 ' + tool + (detail ? ' · ' + detail : '') + ' …';
        chat.appendChild(el);
        scrollToBottom();
    }

    function endToolLine(isError) {
        const lines = chat.querySelectorAll('.status-line.tool.running');
        const el = lines[lines.length - 1];
        if (el) {
            el.classList.remove('running');
            el.classList.add(isError ? 'failed' : 'done');
            el.textContent = el.textContent.replace(/ …$/, '') + (isError ? ' ✗' : ' ✓');
        }
    }

    function addNotice(text) {
        welcome.style.display = 'none';
        const el = document.createElement('div');
        el.className = 'status-line notice';
        el.textContent = 'ℹ️ ' + text;
        chat.appendChild(el);
        scrollToBottom();
    }

    function setBusy(value) {
        busy = value;
        if (value) {
            sendBtn.textContent = '停止';
            sendBtn.classList.add('stopping');
        } else {
            sendBtn.textContent = '发送';
            sendBtn.classList.remove('stopping');
            hideThinking();
        }
    }

    function send() {
        const text = input.value.trim();
        if (!text || busy) return;
        vscode.postMessage({ type: 'sendMessage', text: text });
        input.value = '';
        input.style.height = 'auto';
    }

    sendBtn.addEventListener('click', function () {
        if (busy) {
            vscode.postMessage({ type: 'abort' });
        } else {
            send();
        }
    });

    input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!busy) send();
        }
    });

    input.addEventListener('input', function () {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    });

    document.querySelectorAll('.quick-action').forEach(function (btn) {
        btn.addEventListener('click', function () {
            if (busy) return;
            vscode.postMessage({ type: 'sendMessage', text: btn.dataset.q });
        });
    });

    chat.addEventListener('click', function (e) {
        const btn = e.target.closest('button[data-act]');
        if (!btn) return;
        const codeEl = btn.closest('.code-block').querySelector('pre code');
        if (!codeEl) return;
        if (btn.dataset.act === 'copy') {
            vscode.postMessage({ type: 'copyCode', code: codeEl.textContent });
        }
    });

    window.addEventListener('message', function (e) {
        const m = e.data;
        switch (m.type) {
            case 'addUserMessage':
                addMessage('user', m.text);
                break;
            case 'thinkingStart':
                showThinking();
                break;
            case 'thinkingEnd':
                hideThinking();
                break;
            case 'toolCall':
                addToolLine(m.tool, m.detail);
                break;
            case 'toolEnd':
                endToolLine(Boolean(m.isError));
                break;
            case 'assistantStart':
                hideThinking();
                currentBuffer = '';
                currentBody = addMessage('assistant', '');
                currentBody.classList.add('stream-cursor');
                break;
            case 'assistantChunk':
                if (currentBody) {
                    currentBuffer += m.text;
                    currentBody.innerHTML = renderMarkdown(currentBuffer);
                    scrollToBottom();
                }
                break;
            case 'assistantEnd':
                if (currentBody) {
                    currentBody.classList.remove('stream-cursor');
                    currentBody = null;
                    currentBuffer = '';
                }
                scrollToBottom();
                break;
            case 'notice':
                addNotice(m.text);
                break;
            case 'error':
                hideThinking();
                if (currentBody) {
                    currentBody.classList.remove('stream-cursor');
                    currentBody = null;
                    currentBuffer = '';
                }
                addMessage('assistant', '⚠️ ' + m.text, true);
                break;
            case 'setBusy':
                setBusy(m.busy);
                break;
            case 'clear':
                chat.querySelectorAll('.message, .status-line').forEach(function (el) { el.remove(); });
                welcome.style.display = '';
                currentBody = null;
                currentBuffer = '';
                thinkingLine = null;
                scrollToBottom();
                break;
        }
    });

    scrollToBottom();
    input.focus();
</script>
</body>
</html>`;
    }

    public dispose() {
        ChatPanel.currentPanel = undefined;
        if (this._unsubscribe) {
            this._unsubscribe();
            this._unsubscribe = undefined;
        }
        const client = this._client;
        this._client = undefined;
        if (client) {
            void client.stop();
        }
        this._panel.dispose();
        while (this._disposables.length) {
            const d = this._disposables.pop();
            if (d) {
                d.dispose();
            }
        }
    }
}
