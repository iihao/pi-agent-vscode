import * as vscode from 'vscode';
import * as https from 'https';

// 对话消息记录
interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    isError?: boolean;
}

const SYSTEM_PROMPT = `你是 Pi，一个集成在 VSCode 中的专业 AI 编程助手。

工作方式：
- 用中文回复（代码、变量名和技术术语保持原样）
- 解释代码：说明整体功能、关键逻辑、潜在问题与改进点
- 重构代码：给出完整可运行的代码，并简要说明改动理由
- 生成代码：直接给出完整实现，包含必要注释
- 所有代码放在 markdown 代码块中并标注语言
- 回答简洁专业，不要多余的客套和铺垫`;

export class ChatPanel {
    public static currentPanel: ChatPanel | undefined;
    public static readonly viewType = 'pi-assistant.chatView';

    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];
    private _conversationHistory: ChatMessage[] = [];
    private _streaming = false;
    private _request: ReturnType<typeof https.request> | undefined;

    private constructor(panel: vscode.WebviewPanel) {
        this._panel = panel;
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
                    case 'clearChat':
                        this.clear();
                        break;
                    case 'applyCode':
                        if (message.code) {
                            void this._applyCode(message.code);
                        }
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

    public static createOrShow(extensionUri: vscode.Uri): ChatPanel {
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
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
            }
        );

        ChatPanel.currentPanel = new ChatPanel(panel);
        return ChatPanel.currentPanel;
    }

    /** 清空对话（同步清理 UI 与历史） */
    public clear() {
        this._conversationHistory = [];
        this._post({ type: 'clear' });
    }

    /** 供命令调用的直接提问入口 */
    public async askQuestion(question: string) {
        await this._handleUserMessage(question);
    }

    // ---------- 消息处理 ----------

    private async _handleUserMessage(userText: string) {
        if (this._streaming) {
            vscode.window.showWarningMessage('Pi 正在生成回复，请稍候…');
            return;
        }

        const config = vscode.workspace.getConfiguration('pi-assistant');
        const apiKey = config.get<string>('apiKey', '');
        if (!apiKey) {
            this._conversationHistory.push({ role: 'user', content: userText });
            this._post({ type: 'addUserMessage', text: userText });
            this._conversationHistory.push({
                role: 'assistant',
                content: '⚠️ 尚未配置 Anthropic API Key。\n\n请运行命令 **Pi: 设置 API Key**，或按 ⌘⇧P 输入 "Pi" 找到配置项。',
                isError: true,
            });
            this._post({
                type: 'error',
                text: '尚未配置 API Key，请在命令面板运行「Pi: 设置 API Key」。',
            });
            return;
        }

        // 1. 记录并显示用户消息
        this._conversationHistory.push({ role: 'user', content: userText });
        this._post({ type: 'addUserMessage', text: userText });

        // 2. 构建请求（附加编辑器上下文到本次请求）
        const messages = this._buildRequestMessages();

        // 3. 流式请求
        this._streaming = true;
        this._post({ type: 'assistantStart' });
        this._post({ type: 'setBusy', busy: true });

        const model = config.get<string>('model', 'claude-sonnet-4-20250514');
        let accumulated = '';
        try {
            await this._streamClaude({
                model,
                apiKey,
                messages,
                onChunk: (chunk) => {
                    accumulated += chunk;
                    this._post({ type: 'assistantChunk', text: chunk });
                },
            });
            this._conversationHistory.push({ role: 'assistant', content: accumulated });
            this._post({ type: 'assistantEnd' });
        } catch (err) {
            const msg = (err as Error).message;
            this._conversationHistory.push({
                role: 'assistant',
                content: `⚠️ 请求失败：${msg}`,
                isError: true,
            });
            this._post({ type: 'error', text: msg });
        } finally {
            this._streaming = false;
            this._request = undefined;
            this._post({ type: 'setBusy', busy: false });
        }
    }

    /** 构建 API 请求消息：历史 + 当前编辑器上下文 */
    private _buildRequestMessages(): Array<{ role: string; content: string }> {
        // 最近 20 条（排除错误消息），保持顺序
        const history = this._conversationHistory
            .filter((m) => !m.isError)
            .slice(-20)
            .map((m) => ({ role: m.role as string, content: m.content }));

        const context = this._collectEditorContext();
        if (context && history.length > 0) {
            const last = history[history.length - 1];
            if (last.role === 'user') {
                last.content = `${last.content}\n\n---\n【编辑器上下文】\n${context}`;
            }
        }
        return history;
    }

    /** 收集当前编辑器上下文（文件路径 + 选区代码） */
    private _collectEditorContext(): string {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return '';
        }
        const doc = editor.document;
        const parts: string[] = [];
        parts.push(`当前文件：${vscode.workspace.asRelativePath(doc.uri)}（${doc.languageId}）`);

        const sel = editor.selection;
        if (!sel.isEmpty) {
            const selected = doc.getText(sel);
            // 选区过大时截断，避免浪费 token
            const clipped = selected.length > 6000 ? selected.slice(0, 6000) + '\n// …(内容过长已截断)' : selected;
            parts.push(`用户选中代码：\n\`\`\`${doc.languageId}\n${clipped}\n\`\`\``);
        }
        return parts.join('\n\n');
    }

    // ---------- Anthropic 流式 API ----------

    private _streamClaude(opts: {
        model: string;
        apiKey: string;
        messages: Array<{ role: string; content: string }>;
        onChunk: (text: string) => void;
    }): Promise<void> {
        const config = vscode.workspace.getConfiguration('pi-assistant');
        const maxTokens = config.get<number>('maxTokens', 4096);
        const temperature = config.get<number>('temperature', 0.7);

        const payload = JSON.stringify({
            model: opts.model,
            max_tokens: maxTokens,
            temperature,
            system: SYSTEM_PROMPT,
            messages: opts.messages,
            stream: true,
        });

        return new Promise<void>((resolve, reject) => {
            const req = https.request(
                {
                    hostname: 'api.anthropic.com',
                    path: '/v1/messages',
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': opts.apiKey,
                        'anthropic-version': '2023-06-01',
                        'Content-Length': Buffer.byteLength(payload),
                    },
                },
                (res) => {
                    // 非 200：读取错误体并报错
                    if (res.statusCode !== 200) {
                        let body = '';
                        res.setEncoding('utf8');
                        res.on('data', (chunk: string) => (body += chunk));
                        res.on('end', () => {
                            let detail = body;
                            try {
                                const parsed = JSON.parse(body);
                                detail = parsed.error?.message || body;
                            } catch {
                                /* 保留原文 */
                            }
                            reject(new Error(this._friendlyHttpError(res.statusCode || 0, detail)));
                        });
                        return;
                    }

                    let buffer = '';
                    res.setEncoding('utf8');
                    res.on('data', (chunk: string) => {
                        buffer += chunk;
                        const lines = buffer.split('\n');
                        buffer = lines.pop() || '';
                        for (const line of lines) {
                            const trimmed = line.trim();
                            if (!trimmed.startsWith('data:')) {
                                continue;
                            }
                            const data = trimmed.slice(5).trim();
                            if (!data) {
                                continue;
                            }
                            try {
                                const event = JSON.parse(data);
                                if (
                                    event.type === 'content_block_delta' &&
                                    event.delta?.type === 'text_delta' &&
                                    typeof event.delta.text === 'string'
                                ) {
                                    opts.onChunk(event.delta.text);
                                } else if (event.type === 'error') {
                                    reject(new Error(event.error?.message || 'API 流式响应错误'));
                                }
                            } catch {
                                /* 忽略无法解析的片段 */
                            }
                        }
                    });
                    res.on('end', () => resolve());
                    res.on('error', (err) => reject(err));
                }
            );

            this._request = req;
            req.on('error', (err) => reject(err));
            req.setTimeout(120000, () => {
                req.destroy(new Error('请求超时（120 秒），请检查网络后重试'));
            });
            req.write(payload);
            req.end();
        });
    }

    private _friendlyHttpError(status: number, detail: string): string {
        switch (status) {
            case 401:
                return 'API Key 无效（401），请重新配置「Pi: 设置 API Key」';
            case 403:
                return 'API Key 没有访问权限（403）';
            case 404:
                return `模型不存在（404）：${detail}`;
            case 429:
                return '请求过于频繁或额度不足（429），请稍后重试';
            case 500:
            case 529:
                return `Anthropic 服务暂时不可用（${status}），请稍后重试`;
            default:
                return `API 错误 ${status}：${detail.slice(0, 200)}`;
        }
    }

    // ---------- 应用到编辑器 ----------

    private async _applyCode(code: string) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            await vscode.env.clipboard.writeText(code);
            vscode.window.showWarningMessage('没有打开的编辑器，代码已复制到剪贴板');
            return;
        }

        const sel = editor.selection;
        const edit = new vscode.WorkspaceEdit();
        if (!sel.isEmpty) {
            edit.replace(editor.document.uri, sel, code);
        } else {
            edit.insert(editor.document.uri, sel.active, code);
        }
        const applied = await vscode.workspace.applyEdit(edit);
        if (applied) {
            vscode.window.showInformationMessage(
                sel.isEmpty ? '代码已插入到光标处（⌘Z 可撤销）' : '代码已替换选中内容（⌘Z 可撤销）'
            );
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

    .welcome { text-align: center; padding: 32px 12px; color: var(--vscode-descriptionForeground); }
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

    .message { margin-bottom: 16px; animation: fadeIn .2s ease; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
    .message-header { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
    .avatar { font-size: 15px; }
    .name { font-weight: 600; font-size: 12px; color: var(--vscode-descriptionForeground); }
    .message-body {
        line-height: 1.6; padding: 10px 12px; border-radius: 8px;
        background: var(--vscode-editor-background);
        border: 1px solid var(--vscode-widget-border);
        overflow-wrap: anywhere;
    }
    .message.user .message-body {
        background: var(--vscode-input-background);
    }
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
        cursor: pointer; font-weight: 500; align-self: flex-end;
    }
    .send-button:hover { background: var(--vscode-button-hoverBackground); }
    .send-button:disabled { opacity: .5; cursor: not-allowed; }
</style>
</head>
<body>
    <div class="chat-container" id="chat">
        <div class="welcome" id="welcome">
            <h3>👋 我是 Pi Assistant</h3>
            <p>选中代码后右键「Pi: 解释代码 / 重构代码」快速开始</p>
            <p>对话时会自动附带当前文件与选中代码作为上下文</p>
            <div class="quick-actions">
                <button class="quick-action" data-q="解释当前选中的代码">📖 解释代码</button>
                <button class="quick-action" data-q="审查我选中的代码，指出潜在问题">🐛 代码审查</button>
                <button class="quick-action" data-q="优化我选中的代码的性能">⚡ 性能优化</button>
                <button class="quick-action" data-q="为选中的代码补充单元测试">🧪 写测试</button>
            </div>
        </div>
    </div>

    <div class="input-container">
        <textarea id="input" class="input-box" rows="1"
            placeholder="输入消息…（Enter 发送，Shift+Enter 换行）"></textarea>
        <button id="send" class="send-button">发送</button>
    </div>

<script>
    const vscode = acquireVsCodeApi();
    const chat = document.getElementById('chat');
    const welcome = document.getElementById('welcome');
    const input = document.getElementById('input');
    const sendBtn = document.getElementById('send');

    let busy = false;
    let currentBody = null;   // 正在流式的 assistant 消息体
    let currentBuffer = '';   // 当前 assistant 的 markdown 原文

    // ---------- 工具 ----------
    function escapeHtml(s) {
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function scrollToBottom() {
        chat.scrollTop = chat.scrollHeight;
    }

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
                      '<button data-act="apply">应用</button>' +
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

    // ---------- 控件状态 ----------
    function setBusy(value) {
        busy = value;
        sendBtn.disabled = value;
        sendBtn.textContent = value ? '生成中…' : '发送';
    }

    // ---------- 发送 ----------
    function send() {
        const text = input.value.trim();
        if (!text || busy) return;
        vscode.postMessage({ type: 'sendMessage', text: text });
        input.value = '';
        input.style.height = 'auto';
    }

    sendBtn.addEventListener('click', send);

    input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            send();
        }
    });

    input.addEventListener('input', function () {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    });

    // 快捷操作
    document.querySelectorAll('.quick-action').forEach(function (btn) {
        btn.addEventListener('click', function () {
            if (busy) return;
            vscode.postMessage({ type: 'sendMessage', text: btn.dataset.q });
        });
    });

    // 代码块按钮（事件委托）
    chat.addEventListener('click', function (e) {
        const btn = e.target.closest('button[data-act]');
        if (!btn) return;
        const codeEl = btn.closest('.code-block').querySelector('pre code');
        if (!codeEl) return;
        const code = codeEl.textContent;
        if (btn.dataset.act === 'apply') {
            vscode.postMessage({ type: 'applyCode', code: code });
        } else if (btn.dataset.act === 'copy') {
            vscode.postMessage({ type: 'copyCode', code: code });
        }
    });

    // ---------- 插件消息 ----------
    window.addEventListener('message', function (e) {
        const m = e.data;
        switch (m.type) {
            case 'addUserMessage':
                addMessage('user', m.text);
                break;
            case 'assistantStart':
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
            case 'error':
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
                chat.querySelectorAll('.message').forEach(function (el) { el.remove(); });
                welcome.style.display = '';
                currentBody = null;
                currentBuffer = '';
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
        // 中断进行中的请求
        if (this._request) {
            try {
                this._request.destroy();
            } catch {
                /* 忽略 */
            }
            this._request = undefined;
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
