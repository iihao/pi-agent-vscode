// ---------------------------------------------------------------------------
// ChatPanel - 主聊天面板（重构版）
// ---------------------------------------------------------------------------

import * as vscode from 'vscode';
import * as path from 'path';
import { getWebviewHtml } from './views/webviewTemplate';
import { getUiStrings } from './views/strings';
import { PiClientManager, PiStartError, PiNotFoundError } from './sdk/clientManager';
import { SessionManager } from './sdk/sessionManager';
import { summarizeToolArgs, formatUsage, validateMessage, extractToolOutput } from './utils/formatters';
import { PI_INSTALL_HINT, extractMessageText, PiAgentEvent, PiRpcClient, PiModelInfo, PiSessionStats, respondExtensionUI } from './sdk/piTypes';
import { logInfo, logError } from './utils/logger';

/** 判断错误是否为「pi 进程/连接」类问题（用类型/code 判断，不依赖本地化文案） */
function isProcessError(err: unknown): boolean {
    if (err instanceof PiStartError) { return true; }
    const e = err as { code?: string; message?: string } | undefined;
    if (e?.code === 'ENOENT' || e?.code === 'ECONNREFUSED') { return true; }
    const m = (e?.message || '').toLowerCase();
    return m.includes('process') || m.includes('spawn') || m.includes('stdin')
        || m.includes('not started') || m.includes('exited') || m.includes('econnrefused');
}

function permissionLabel(mode: string): string {
    switch (mode) {
        case 'ask': return vscode.l10n.t('Manual');
        case 'autoConfirm': return vscode.l10n.t('Auto');
        case 'restricted': return vscode.l10n.t('Read-only');
        default: return mode;
    }
}

/** webview 构建产物所在目录 */
function mediaRoot(extensionPath: string): vscode.Uri {
    return vscode.Uri.file(path.join(extensionPath, 'media'));
}

// 消息类型定义
interface WebviewMessage {
    type: string;
    text?: string;
    code?: string;
    provider?: string;
    modelId?: string;
    sessionId?: string;
    markdown?: string;
    href?: string;
    level?: string;
    currentName?: string;
    id?: string;
    mode?: string;
}

// 发送给 webview 的消息类型
interface PostMessage {
    type: string;
    text?: string;
    busy?: boolean;
    messages?: Array<{ role: string; text: string }>;
    models?: Array<{ provider: string; id: string }>;
    current?: { provider: string; id: string } | string | null;
    tool?: string;
    detail?: string;
    isError?: boolean;
    sessions?: Array<{ id: string; file: string; createdAt: number; messageCount: number; name?: string }>;
    code?: string;
    toolCallId?: string;
    output?: string;
    diff?: string;
    durationMs?: number;
    levels?: string[];
    currentThinking?: string | null;
    permissionMode?: string;
    stats?: {
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite: number;
        contextPercent: number | null;
        contextWindow: number;
        autoCompact: boolean;
    };
    contexts?: Array<{ id: string; type: string; path: string; lineRange?: string }>;
    toolCalls?: Array<{ tool: string; detail: string; isError?: boolean }>;
    [key: string]: unknown;
}

interface ContextItem {
    id: string;
    type: 'file' | 'selection';
    path: string;
    languageId?: string;
    code?: string;
    lineRange?: string;
}

export class ChatPanel {
    public static currentView: ChatPanel | undefined;
    public static readonly viewType = 'pi-agent.chatView';

    private readonly _webview: vscode.Webview;
    private readonly _extensionPath: string;
    private _disposables: vscode.Disposable[] = [];
    private _clientManager: PiClientManager;
    private _sessionManager: SessionManager;
    private _busy = false;
    private _turnHadText = false;
    private _contexts: ContextItem[] = [];
    private _lastUsage: { input?: number; output?: number; cacheRead?: number } | undefined;

    private constructor(webview: vscode.Webview, extensionPath: string, disposeEvent: vscode.Event<void>) {
        this._webview = webview;
        this._extensionPath = extensionPath;
        this._clientManager = new PiClientManager();
        this._sessionManager = new SessionManager();

        const root = mediaRoot(extensionPath);
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(root, 'main.js')).toString();
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(root, 'main.css')).toString();
        webview.html = getWebviewHtml(
            { cspSource: webview.cspSource, scriptUri, styleUri, locale: vscode.env.language },
            getUiStrings()
        );

        disposeEvent(() => this.dispose(), null, this._disposables);

        webview.onDidReceiveMessage(
            (message: WebviewMessage) => this._handleWebviewMessage(message),
            null,
            this._disposables
        );

        // 订阅 pi 事件
        this._clientManager.onEvent((event: PiAgentEvent) => this._onAgentEvent(event));
    }

    public static registerViewProvider(context: vscode.ExtensionContext, extensionPath: string): void {
        const provider: vscode.WebviewViewProvider = {
            resolveWebviewView: (view) => {
                view.webview.options = { enableScripts: true, localResourceRoots: [mediaRoot(extensionPath)] };
                const panel = new ChatPanel(view.webview, extensionPath, view.onDidDispose);
                ChatPanel.currentView = panel;
                // 连接由 webview 的 ready 消息触发，确保 webview 消息监听器已就绪，
                // 避免 ESM 延迟执行导致 models/sessions 等消息被丢弃。
            },
        };
        context.subscriptions.push(
            vscode.window.registerWebviewViewProvider(ChatPanel.viewType, provider)
        );
    }

    public static async ensureView(): Promise<ChatPanel> {
        await vscode.commands.executeCommand(`${ChatPanel.viewType}.focus`);
        for (let i = 0; i < 40; i++) {
            if (ChatPanel.currentView) { return ChatPanel.currentView; }
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        throw new Error(vscode.l10n.t('Pi chat view could not be created, please retry'));
    }

    public clear() {
        if (this._busy) {
            void this._clientManager.abort().catch((err) => { logError(`abort failed: ${(err as Error).message}`); });
        }
        this._busy = false;
        this._turnHadText = false;
        this._contexts = [];
        this._post({ type: 'clear' });
        this._post({ type: 'setBusy', busy: false });
        this._postContexts();
        const client = this._clientManager.client;
        if (this._clientManager.isConnected && client) {
            void this._sessionManager.createNewSession(client).then((ok) => {
                if (ok) { this._postSessionList(); }
            }).catch((err) => { logError(`clear/newSession failed: ${(err as Error).message}`); });
        }
    }

    /** 重启 pi 客户端（权限模式/可执行路径变更后生效） */
    public async restartClient(): Promise<void> {
        await this._clientManager.stop();
        this._busy = false;
        this._turnHadText = false;
        this._contexts = [];
        this._post({ type: 'clear' });
        this._post({ type: 'setBusy', busy: false });
        this._postContexts();
        await this._ensureClient();
    }

    // ---------- 编辑器上下文 ----------

    /** 附加当前编辑器：有选区则附加选区，否则附加整个文件 */
    public attachActive(): void {
        const editor = vscode.window.activeTextEditor;
        if (!editor) { this._post({ type: 'notice', text: vscode.l10n.t('No active editor') }); return; }
        if (!editor.selection.isEmpty) { this._addSelectionContext(editor); }
        else { this._addFileContext(editor); }
    }

    public attachFile(): void {
        const editor = vscode.window.activeTextEditor;
        if (!editor) { this._post({ type: 'notice', text: vscode.l10n.t('No active editor') }); return; }
        this._addFileContext(editor);
    }

    public attachSelection(): void {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.selection.isEmpty) { this._post({ type: 'notice', text: vscode.l10n.t('Please select some code first') }); return; }
        this._addSelectionContext(editor);
    }

    private _addFileContext(editor: vscode.TextEditor): void {
        const rel = vscode.workspace.asRelativePath(editor.document.uri);
        this._addContext({ type: 'file', path: rel });
    }

    private _addSelectionContext(editor: vscode.TextEditor): void {
        const sel = editor.selection;
        const rel = vscode.workspace.asRelativePath(editor.document.uri);
        const lineRange = sel.start.line === sel.end.line
            ? `${sel.start.line + 1}`
            : `${sel.start.line + 1}-${sel.end.line + 1}`;
        this._addContext({
            type: 'selection',
            path: rel,
            languageId: editor.document.languageId,
            code: editor.document.getText(sel),
            lineRange,
        });
    }

    private _addContext(item: Omit<ContextItem, 'id'>): void {
        const key = `${item.type}:${item.path}:${item.lineRange || ''}`;
        if (this._contexts.some((c) => `${c.type}:${c.path}:${c.lineRange || ''}` === key)) {
            this._post({ type: 'notice', text: vscode.l10n.t('Context already attached') });
            return;
        }
        const id = 'ctx-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
        this._contexts.push({ ...item, id });
        this._postContexts();
    }

    private _removeContext(id: string): void {
        this._contexts = this._contexts.filter((c) => c.id !== id);
        this._postContexts();
    }

    private _postContexts(): void {
        this._post({
            type: 'contexts',
            contexts: this._contexts.map((c) => ({ id: c.id, type: c.type, path: c.path, lineRange: c.lineRange })),
        });
    }

    /** 把附加的上下文拼接到 prompt 前面 */
    private _withContext(text: string): string {
        if (this._contexts.length === 0) { return text; }
        const parts: string[] = [vscode.l10n.t('[Attached context]')];
        for (const c of this._contexts) {
            if (c.type === 'file') {
                parts.push(vscode.l10n.t('File: {0}', c.path));
            } else {
                parts.push(vscode.l10n.t('Selection: {0} line {1}\n\n```{2}\n{3}\n```', c.path, c.lineRange || '', c.languageId || '', c.code || ''));
            }
        }
        return parts.join('\n') + '\n\n' + text;
    }

    public async askQuestion(question: string) {
        await this._handleUserMessage(question);
    }

    // ---------- Webview 消息处理 ----------

    private async _handleWebviewMessage(message: WebviewMessage): Promise<void> {
        switch (message.type) {
            case 'sendMessage':
                if (message.text) {
                    const validation = validateMessage(message.text);
                    if (!validation.valid) {
                        this._post({ type: 'notice', text: validation.error || vscode.l10n.t('Invalid message') });
                        return;
                    }
                    await this._handleUserMessage(message.text);
                }
                break;
            case 'abort':
                await this._clientManager.abort();
                break;
            case 'setModel':
                if (message.provider && message.modelId) {
                    await this._handleSetModel(message.provider, message.modelId);
                }
                break;
            case 'setThinking':
                if (message.level) { await this._handleSetThinking(message.level); }
                break;
            case 'setPermission':
                if (message.mode) { await this._handleSetPermission(message.mode); }
                break;
            case 'clearChat':
                this.clear();
                break;
            case 'newSession':
                await this._handleNewSession();
                break;
            case 'switchSession':
                if (message.sessionId) { await this._handleSwitchSession(message.sessionId); }
                break;
            case 'renameSession':
                if (message.sessionId) { await this._handleRenameSession(message.sessionId, message.currentName); }
                break;
            case 'ready':
                await this._ensureClient();
                break;
            case 'attachActive':
                this.attachActive();
                break;
            case 'removeContext':
                if (message.id) { this._removeContext(message.id); }
                break;
            case 'clearContexts':
                this._contexts = [];
                this._postContexts();
                break;
            case 'applyCode':
                if (message.code) { await this._applyCode(message.code); }
                break;
            case 'copyCode':
                if (message.code) {
                    await vscode.env.clipboard.writeText(message.code);
                    vscode.window.showInformationMessage(vscode.l10n.t('Code copied to clipboard'));
                }
                break;
            case 'openLink':
                if (message.href) {
                    await vscode.env.openExternal(vscode.Uri.parse(message.href));
                }
                break;
            case 'notify':
                if (message.text) {
                    void vscode.window.showInformationMessage(message.text);
                }
                break;
            case 'exportConversation':
                if (message.markdown) {
                    await this._exportConversation(message.markdown);
                }
                break;
        }
    }

    private async _exportConversation(markdown: string): Promise<void> {
        try {
            const fileName = 'pi-conversation-' + new Date().toISOString().slice(0, 10) + '.md';
            const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
            const uri = await vscode.window.showSaveDialog({
                defaultUri: folder ? vscode.Uri.joinPath(folder, fileName) : vscode.Uri.file(fileName),
                filters: { 'Markdown': ['md'], 'Text': ['txt'] }
            });
            if (uri) {
                await vscode.workspace.fs.writeFile(uri, Buffer.from(markdown, 'utf8'));
                vscode.window.showInformationMessage(vscode.l10n.t('Conversation exported to: {0}', uri.fsPath));
            }
        } catch (err) {
            vscode.window.showErrorMessage(vscode.l10n.t('Export failed: {0}', (err as Error).message));
        }
    }

    // ---------- Pi 客户端管理 ----------

    private async _ensureClient(): Promise<void> {
        this._post({ type: 'connecting' });
        try {
            const client = await this._clientManager.ensureConnected(this._extensionPath);

            // 恢复历史消息
            await this._restoreHistory(client);

            // 通知连接成功
            let folderName = vscode.workspace.workspaceFolders?.[0]?.name;
            if (!folderName) {
                try {
                    const state = await client.getState();
                    folderName = state.sessionId || vscode.l10n.t('unknown');
                } catch (err) {
                    logError(`getState for workspace name failed: ${(err as Error).message}`);
                    folderName = vscode.l10n.t('unknown');
                }
            }
            logInfo(vscode.l10n.t('Connected to pi · workspace "{0}"', folderName));
            this._post({
                type: 'notice',
                text: vscode.l10n.t('Connected to pi · workspace "{0}"', folderName)
            });

            // 加载模型列表
            await this._loadModels(client);
            await this._loadStats(client);

            // 加载会话列表
            await this._sessionManager.loadSessions(client);
            this._postSessionList();
        } catch (err) {
            const msg = (err as Error).message || String(err);
            logError(`Connection failed: ${msg}`);
            this._post({ type: 'models', models: [], current: null });
            this._post({ type: 'notice', text: vscode.l10n.t('Connection failed: {0}', msg) });
            this._post({ type: 'error', text: msg });
        }
    }

    private async _restoreHistory(client: PiRpcClient): Promise<void> {
        try {
            const messages = await client.getMessages();
            const items: Array<{ role: string; text: string }> = [];
            for (const m of messages) {
                const text = extractMessageText(m);
                if (text) { items.push({ role: m.role ?? 'assistant', text }); }
            }
            const recent = items.slice(-30);
            if (recent.length > 0) {
                this._post({ type: 'history', messages: recent });
            }
        } catch (err) { logError(`_restoreHistory failed: ${(err as Error).message}`); }
    }

    /** 会话统计（累计 tokens + 上下文占用）→ 顶栏状态指示 */
    private async _loadStats(client: PiRpcClient): Promise<void> {
        if (typeof client.getSessionStats !== 'function') { return; }
        try {
            const [stats, state] = await Promise.all([
                client.getSessionStats(),
                client.getState(),
            ]) as [PiSessionStats, { autoCompactionEnabled?: boolean }];
            const t = stats.tokens || {};
            this._post({
                type: 'stats',
                stats: {
                    input: t.input || 0,
                    output: t.output || 0,
                    cacheRead: t.cacheRead || 0,
                    cacheWrite: t.cacheWrite || 0,
                    contextPercent: stats.contextUsage?.percent ?? null,
                    contextWindow: stats.contextUsage?.contextWindow || 0,
                    autoCompact: Boolean(state.autoCompactionEnabled),
                },
            });
        } catch (err) { logError(`_loadStats failed: ${(err as Error).message}`); }
    }

    private async _loadModels(client: PiRpcClient): Promise<void> {
        try {
            const [models, state] = await Promise.all([
                client.getAvailableModels(),
                client.getState(),
            ]);
            this._post({
                type: 'models',
                models: models.map((m: PiModelInfo) => ({ provider: m.provider, id: m.id })),
                current: state.model
                    ? { provider: state.model.provider ?? '', id: state.model.id ?? '' }
                    : null,
            });
            let levels: string[] = [];
            if (typeof client.getAvailableThinkingLevels === 'function') {
                levels = await client.getAvailableThinkingLevels().catch((err) => { logError(`getAvailableThinkingLevels failed: ${(err as Error).message}`); return []; });
            }
            this._post({ type: 'thinking', levels, currentThinking: state.thinkingLevel ?? null });
            this._post({ type: 'permission', permissionMode: this._permissionMode() });
        } catch (err) { logError(`_loadModels failed: ${(err as Error).message}`); }
    }

    private _postSessionList(): void {
        const sessions = this._sessionManager.sessions.map((s) => ({
            id: s.id,
            file: s.file,
            createdAt: s.createdAt,
            messageCount: s.messageCount,
            name: s.name,
        }));
        this._post({
            type: 'sessions',
            sessions,
            current: this._sessionManager.currentSessionId || null,
        });
    }

    private _permissionMode(): string {
        return vscode.workspace.getConfiguration('pi-agent').get<string>('agent.permissionMode', 'ask');
    }

    private async _handleSetPermission(mode: string): Promise<void> {
        const target = vscode.workspace.workspaceFolders?.length
            ? vscode.ConfigurationTarget.Workspace
            : vscode.ConfigurationTarget.Global;
        try {
            await vscode.workspace.getConfiguration('pi-agent').update('agent.permissionMode', mode, target);
            // 配置变更监听会重启会话使权限模式生效
            this._post({ type: 'permission', permissionMode: mode });
            this._post({ type: 'notice', text: vscode.l10n.t('Permission mode: {0} (restarting session…)', permissionLabel(mode)) });
        } catch (err) {
            this._post({ type: 'notice', text: vscode.l10n.t('Failed to set permission mode: {0}', (err as Error).message) });
        }
    }

    /** 处理 pi 发来的 extension_ui_request（确认/选择/输入） */
    private async _handleExtensionUI(req: PiAgentEvent): Promise<void> {
        const client = this._clientManager.client;
        if (!client || !req.id) { return; }
        const autoConfirm = this._permissionMode() === 'autoConfirm';
        switch (req.method) {
            case 'confirm': {
                if (autoConfirm) {
                    respondExtensionUI(client, req.id, { confirmed: true });
                    this._post({ type: 'notice', text: vscode.l10n.t('Auto-confirmed: {0}', req.title || '') });
                    return;
                }
                const choice = await vscode.window.showWarningMessage(
                    `${req.title || vscode.l10n.t('Confirmation required')}${req.message ? '\n\n' + req.message : ''}`,
                    { modal: true },
                    vscode.l10n.t('Allow'), vscode.l10n.t('Deny')
                );
                respondExtensionUI(client, req.id, { confirmed: choice === vscode.l10n.t('Allow') });
                break;
            }
            case 'select': {
                const pick = await vscode.window.showQuickPick(req.options || [], {
                    title: req.title,
                    ignoreFocusOut: true,
                });
                if (pick === undefined) { respondExtensionUI(client, req.id, { cancelled: true }); }
                else { respondExtensionUI(client, req.id, { value: pick }); }
                break;
            }
            case 'input': {
                const value = await vscode.window.showInputBox({
                    prompt: req.title,
                    placeHolder: req.placeholder,
                    ignoreFocusOut: true,
                });
                if (value === undefined) { respondExtensionUI(client, req.id, { cancelled: true }); }
                else { respondExtensionUI(client, req.id, { value }); }
                break;
            }
            case 'editor': {
                const value = await vscode.window.showInputBox({
                    prompt: req.title,
                    value: req.prefill || '',
                    ignoreFocusOut: true,
                });
                if (value === undefined) { respondExtensionUI(client, req.id, { cancelled: true }); }
                else { respondExtensionUI(client, req.id, { value }); }
                break;
            }
            case 'notify': {
                const text = req.message || '';
                if (req.notifyType === 'error') { void vscode.window.showErrorMessage(text); }
                else if (req.notifyType === 'warning') { void vscode.window.showWarningMessage(text); }
                else { void vscode.window.showInformationMessage(text); }
                break;
            }
            default:
                // 其他请求若在等待响应，回 cancelled 避免 pi 挂起
                respondExtensionUI(client, req.id, { cancelled: true });
                break;
        }
    }

    private async _handleSetThinking(level: string): Promise<void> {
        const client = this._clientManager.client;
        if (!client || typeof client.setThinkingLevel !== 'function') { return; }
        try {
            await client.setThinkingLevel(level);
            this._post({ type: 'notice', text: vscode.l10n.t('Thinking level: {0}', level) });
            await this._loadModels(client);
        } catch (err) {
            this._post({ type: 'notice', text: vscode.l10n.t('Failed to change thinking level: {0}', (err as Error).message) });
        }
    }

    private async _handleSetModel(provider: string, modelId: string): Promise<void> {
        try {
            const client = this._clientManager.client;
            if (!client) { return; }
            await client.setModel(provider, modelId);
            this._post({ type: 'notice', text: vscode.l10n.t('Model switched: {0}', modelId) });
            await this._loadModels(client);
        } catch (err) {
            this._post({ type: 'notice', text: vscode.l10n.t('Failed to switch model: {0}', (err as Error).message) });
        }
    }

    // ---------- 会话管理 ----------

    private async _handleNewSession(): Promise<void> {
        const client = this._clientManager.client;
        if (!client) {
            this._post({ type: 'notice', text: vscode.l10n.t('Not connected; cannot create session') });
            return;
        }
        if (this._busy) {
            await this._clientManager.abort().catch((err) => { logError(`abort failed: ${(err as Error).message}`); });
        }
        const success = await this._sessionManager.createNewSession(client);
        if (success) {
            this._post({ type: 'clear' });
            this._busy = false;
            this._turnHadText = false;
            this._post({ type: 'setBusy', busy: false });
            this._postSessionList();
            this._post({ type: 'notice', text: vscode.l10n.t('New session created') });
        } else {
            this._post({ type: 'notice', text: vscode.l10n.t('Failed to create session') });
        }
    }

    private async _handleRenameSession(sessionId: string, currentName?: string): Promise<void> {
        const client = this._clientManager.client;
        if (!client) {
            this._post({ type: 'notice', text: vscode.l10n.t('Not connected; cannot rename session') });
            return;
        }
        const name = await vscode.window.showInputBox({
            prompt: vscode.l10n.t('Session name'),
            value: currentName || '',
            placeHolder: vscode.l10n.t('Enter a session name (leave empty to clear)'),
            ignoreFocusOut: true,
        });
        if (name === undefined) { return; }
        const before = this._sessionManager.currentSessionId;
        const ok = await this._sessionManager.renameSession(client, sessionId, name);
        if (ok) {
            // 若当前会话发生变化（切换/切回异常），重载历史保持一致
            if (this._sessionManager.currentSessionId !== before) {
                this._post({ type: 'clear' });
                this._busy = false;
                this._turnHadText = false;
                this._post({ type: 'setBusy', busy: false });
                await this._restoreHistory(client);
            }
            this._postSessionList();
            this._post({ type: 'notice', text: vscode.l10n.t('Session renamed') });
        } else {
            this._post({ type: 'notice', text: vscode.l10n.t('Rename failed') });
        }
    }

    private async _handleSwitchSession(sessionId: string): Promise<void> {
        const client = this._clientManager.client;
        if (!client) {
            this._post({ type: 'notice', text: vscode.l10n.t('Not connected; cannot switch session') });
            return;
        }
        const success = await this._sessionManager.switchSession(client, sessionId);
        if (success) {
            this._post({ type: 'clear' });
            this._busy = false;
            this._turnHadText = false;
            this._post({ type: 'setBusy', busy: false });
            // 恢复该会话的历史记录
            await this._restoreHistory(client);
            this._postSessionList();
            this._post({ type: 'notice', text: vscode.l10n.t('Switched to session: {0}', sessionId) });
        } else {
            this._post({ type: 'notice', text: vscode.l10n.t('Failed to switch session') });
        }
    }

    // ---------- 事件桥接（pi → webview） ----------

    private _onAgentEvent(event: PiAgentEvent): void {
        if (event.type === 'extension_ui_request') {
            void this._handleExtensionUI(event);
            return;
        }
        switch (event.type) {
            case 'agent_start':
                this._busy = true;
                this._turnHadText = false;
                this._lastUsage = undefined;
                this._post({ type: 'setBusy', busy: true });
                break;

            case 'message_update': {
                if (event.usage) { this._lastUsage = event.usage; }
                const ae = event.assistantMessageEvent;
                if (!ae) { break; }
                if (ae.type === 'thinking_start') {
                    this._post({ type: 'thinkingStart' });
                } else if (ae.type === 'thinking_delta' && ae.delta) {
                    // 累积思考内容
                    this._post({ type: 'thinkingDelta', text: ae.delta });
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
                this._turnHadText = false;
                this._post({
                    type: 'toolCall',
                    tool: event.toolName ?? 'tool',
                    detail: summarizeToolArgs(event.args),
                    toolCallId: event.toolCallId,
                });
                break;

            case 'tool_execution_update': {
                const partial = extractToolOutput(event.partialResult);
                if (partial) {
                    this._post({ type: 'toolUpdate', toolCallId: event.toolCallId, output: partial });
                }
                break;
            }

            case 'tool_execution_end': {
                const diff = event.result?.details?.diff;
                const output = extractToolOutput(event.result);
                this._post({
                    type: 'toolEnd',
                    tool: event.toolName ?? 'tool',
                    toolCallId: event.toolCallId,
                    isError: Boolean(event.isError),
                    durationMs: event.durationMs,
                    diff: typeof diff === 'string' && diff ? diff : undefined,
                    output: output || undefined,
                });
                break;
            }

            case 'auto_retry_start':
                this._post({
                    type: 'notice',
                    text: vscode.l10n.t('Auto-retry ({0}/{1}): {2}', event.attempt ?? '?', event.maxAttempts ?? '?', event.errorMessage ?? ''),
                });
                break;

            case 'agent_settled': {
                this._busy = false;
                this._turnHadText = false;
                this._post({ type: 'thinkingEnd' });
                const u = this._lastUsage;
                if (u && (u.input || u.output)) {
                    this._post({ type: 'notice', text: vscode.l10n.t('Usage this turn: {0} tokens', formatUsage(u)) });
                }
                this._post({ type: 'setBusy', busy: false });
                if (!event.aborted) { this._notifySettled(); }
                { const client = this._clientManager.client; if (client) { void this._loadStats(client); } }
                break;
            }

            default:
                break;
        }
    }

    /** 窗口失焦时，任务完成后弹通知 */
    private _notifySettled(): void {
        if (vscode.window.state.focused) { return; }
        const enabled = vscode.workspace.getConfiguration('pi-agent').get<boolean>('notifications.enabled', true);
        if (!enabled) { return; }
        void vscode.window.showInformationMessage(vscode.l10n.t('Pi finished the current turn'));
    }

    // ---------- 用户消息 ----------

    private async _handleUserMessage(userText: string) {
        if (this._busy) {
            vscode.window.showWarningMessage(vscode.l10n.t('Pi is working; wait for it to finish or click Stop'));
            return;
        }

        this._post({ type: 'addUserMessage', text: userText });
        this._busy = true;
        this._post({ type: 'setBusy', busy: true });

        try {
            const client = await this._clientManager.ensureConnected(this._extensionPath);
            const disposition = await client.prompt(this._withContext(userText));
            if (this._contexts.length) { this._contexts = []; this._postContexts(); }
            if (disposition === 'handled') {
                this._busy = false;
                this._post({ type: 'setBusy', busy: false });
            }
        } catch (err) {
            this._busy = false;
            this._post({ type: 'thinkingEnd' });
            this._post({ type: 'setBusy', busy: false });

            const msg = (err as Error).message || String(err);

            // 仅当进程确实崩溃时才重置客户端（类型判断，不依赖文案）
            if (isProcessError(err)) {
                await this._clientManager.stop();
                void this._ensureClient().catch((err) => { logError(`reconnect after crash failed: ${(err as Error).message}`); });
            }

            this._post({ type: 'error', text: msg });

            const isMissing = err instanceof PiNotFoundError;
            const hint = isMissing ? vscode.l10n.t('Copy install command') : vscode.l10n.t('Retry connection');
            void vscode.window.showErrorMessage(`Pi: ${msg}`, hint).then((action) => {
                if (action === vscode.l10n.t('Copy install command')) {
                    void vscode.env.clipboard.writeText(PI_INSTALL_HINT);
                    void vscode.window.showInformationMessage(vscode.l10n.t('Install command copied; run it in a terminal, then retry'));
                } else if (action === vscode.l10n.t('Retry connection')) {
                    void this._ensureClient().catch((e: unknown) => {
                        void vscode.window.showErrorMessage(`Pi: ${(e as Error).message}`);
                    });
                }
            });
        }
    }

    // ---------- 应用到编辑器 ----------

    private async _applyCode(code: string) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            await vscode.env.clipboard.writeText(code);
            vscode.window.showWarningMessage(vscode.l10n.t('No active editor; code copied to clipboard'));
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
                sel.isEmpty
                    ? vscode.l10n.t('Code inserted at cursor (Cmd+Z to undo)')
                    : vscode.l10n.t('Selection replaced with code (Cmd+Z to undo)')
            );
        }
    }

    // ---------- Webview 通信 ----------

    private _post(message: PostMessage) {
        void this._webview.postMessage(message);
    }

    public dispose() {
        if (ChatPanel.currentView === this) { ChatPanel.currentView = undefined; }
        void this._clientManager.stop().catch((err) => { logError(`dispose stop failed: ${(err as Error).message}`); });
        while (this._disposables.length) {
            const d = this._disposables.pop();
            if (d) { d.dispose(); }
        }
    }
}
