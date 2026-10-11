// ---------------------------------------------------------------------------
// ChatPanel - 主聊天面板（重构版）
// ---------------------------------------------------------------------------

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { getWebviewHtml } from './views/webviewTemplate';
import { getUiStrings } from './views/strings';
import { PiClientManager, PiStartError, PiNotFoundError } from './sdk/clientManager';
import { SessionManager } from './sdk/sessionManager';
import { summarizeToolArgs, formatUsage, validateMessage, extractToolOutput } from './utils/formatters';
import { buildContextBlock, stripContextBlock, ContextItem } from './utils/context';
import { PI_INSTALL_HINT, extractMessageText, extractMessageImages, PiAgentEvent, PiImageBlock, PiRpcClient, PiModelInfo, PiSessionStats, PiSlashCommand, PiUsage, respondExtensionUI } from './sdk/piTypes';
import { stateStore, setState, selectBusy, selectTurnHadText, selectContexts, selectLastUsage, selectPermissionMode } from './state';
import { logInfo, logError } from './utils/logger';
import { getVSCodeService } from './services';

/** VS Code 访问统一走服务容器（便于测试与替换） */
const vs = getVSCodeService();

/** 所有聊天面板（侧边栏 / 编辑器标签）共享同一 pi 客户端与会话管理器，
 *  避免多开时启动多个 pi 进程、争用同一会话文件。 */
const sharedClientManager = new PiClientManager();
const sharedSessionManager = new SessionManager();

/** 自动命名是全局副作用（共享会话 + 一次性生成），用模块级标志避免多面板同时触发 */
let autoNameInFlight = false;

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
    return vs.uri.file(path.join(extensionPath, 'media'));
}

// ---- 最小化的 vscode.git API 类型（内建 Git 扩展） ----
interface GitChange { uri: vscode.Uri; }
interface GitRepository {
    rootUri: vscode.Uri;
    inputBox: { value: string };
    state: {
        HEAD?: { name?: string; commit?: string };
        workingTreeChanges: GitChange[];
        indexChanges: GitChange[];
    };
    diff(cached?: boolean): Promise<string>;
    diffWithHEAD(): Promise<string>;
    log(options?: { maxEntries?: number }): Promise<Array<{ hash: string; message: string }>>;
}
interface GitAPI {
    repositories: GitRepository[];
    getRepository(uri: vscode.Uri): GitRepository | null;
}
interface GitExtension { getAPI(version: 1): GitAPI; }

async function getGitAPI(): Promise<GitAPI | undefined> {
    const ext = vs.extensions.getExtension<GitExtension>('vscode.git');
    if (!ext) { return undefined; }
    try {
        const exports = ext.isActive ? ext.exports : await ext.activate();
        return exports?.getAPI(1);
    } catch (err) {
        logError(`git extension activation failed: ${(err as Error).message}`);
        return undefined;
    }
}

function pickGitRepository(api: GitAPI): GitRepository | undefined {
    const active = vs.activeTextEditor?.document.uri;
    if (active) {
        const repo = api.getRepository(active);
        if (repo) { return repo; }
    }
    return api.repositories[0];
}

function clipDiff(diff: string, max = 12000): string {
    return diff.length > max ? diff.slice(0, max) + '\n… (truncated)' : diff;
}

export function buildCommitPrompt(diff: string, branch: string): string {
    return [
        'Write a git commit message for the following changes.',
        'Use Conventional Commits (e.g. "feat: …", "fix: …", "docs: …").',
        'Keep the subject under 72 characters. Output ONLY the commit message.',
        branch ? `Branch: ${branch}` : '',
        '',
        '```diff',
        clipDiff(diff),
        '```',
    ].filter(Boolean).join('\n');
}

export function buildPrPrompt(branch: string, log: string): string {
    return [
        'Write a pull request description in Markdown.',
        'Include a short summary and a bullet list of notable changes.',
        branch ? `Branch: ${branch}` : '',
        '',
        'Commits:',
        log || '(no commits found)',
    ].filter(Boolean).join('\n');
}

export function buildNamePrompt(text: string): string {
    return [
        'Summarize the following user request as a short session title.',
        'Use 3 to 6 words, no quotes, no trailing punctuation. Output only the title.',
        '',
        text.slice(0, 1000),
    ].join('\n');
}

// ---- 本回合改动追踪与还原 ----

export interface TurnChange {
    rel: string;
    existed: boolean;
    /** edit 的替换对；null 表示包含 write（覆盖写无法安全还原） */
    edits: Array<{ oldText: string; newText: string }> | null;
}

export function parseEdits(args: { edits?: unknown } | undefined): Array<{ oldText: string; newText: string }> {
    const raw = args?.edits;
    if (!Array.isArray(raw)) { return []; }
    const out: Array<{ oldText: string; newText: string }> = [];
    for (const e of raw) {
        if (e && typeof e === 'object') {
            const o = e as { oldText?: unknown; newText?: unknown };
            if (typeof o.oldText === 'string' && typeof o.newText === 'string') {
                out.push({ oldText: o.oldText, newText: o.newText });
            }
        }
    }
    return out;
}

export function isRevertible(change: TurnChange): boolean {
    if (!change.existed) { return true; }          // 本回合新建 -> 删除
    if (!change.edits) { return false; }           // 覆盖写 -> 无法安全还原
    return change.edits.every((e) => e.newText.length > 0);
}

/** 把 newText 反向替换回 oldText（倒序），失败返回 null */
export function revertEdits(content: string, edits: Array<{ oldText: string; newText: string }>): string | null {
    let out = content;
    for (let i = edits.length - 1; i >= 0; i--) {
        const { oldText, newText } = edits[i];
        const idx = out.indexOf(newText);
        if (idx === -1) { return null; }
        out = out.slice(0, idx) + oldText + out.slice(idx + newText.length);
    }
    return out;
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
    paths?: string[];
    path?: string;
    images?: ImageAttachment[];
}

type ImageAttachment = { type?: string; data?: string; mimeType?: string };

// 发送给 webview 的消息类型
interface PostMessage {
    type: string;
    text?: string;
    busy?: boolean;
    messages?: Array<{ role: string; text: string; images?: PiImageBlock[] }>;
    models?: Array<{ provider: string; id: string }>;
    current?: { provider: string; id: string } | string | null;
    tool?: string;
    detail?: string;
    isError?: boolean;
    sessions?: Array<{ id: string; file: string; createdAt: number; messageCount: number; name?: string; preview?: string }>;
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

export class ChatPanel {
    public static currentView: ChatPanel | undefined;
    public static readonly viewType = 'pi-agent.chatView';
    public static readonly editorViewType = 'pi-agent.chatEditor';
    private static _instances: ChatPanel[] = [];

    private readonly _webview: vscode.Webview;
    private readonly _extensionPath: string;
    private _disposables: vscode.Disposable[] = [];
    private _clientManager: PiClientManager;
    private _sessionManager: SessionManager;
    private _contextWarned = false;
    private _commands: PiSlashCommand[] = [];
    private _fileList: string[] | undefined;
    private _fileListAt = 0;
    /** 本回合被 edit/write 修改的文件（绝对路径 -> 可还原信息） */
    private _turnChanges = new Map<string, TurnChange>();
    private _firstUserMessage: string | undefined;
    /** 已尝试自动命名的会话 id（避免失败后每回合重试） */
    private _autoNameTried = new Set<string>();
    private _disposed = false;

    // ---- 集中式状态：由 stateStore 支撑（getter/setter 代理，调用点无需改动） ----
    private get _busy(): boolean { return stateStore.select(selectBusy); }
    private set _busy(v: boolean) { setState({ busy: v }); }

    private get _turnHadText(): boolean { return stateStore.select(selectTurnHadText); }
    private set _turnHadText(v: boolean) { setState({ turnHadText: v }); }

    private get _contexts(): ContextItem[] { return stateStore.select(selectContexts); }
    private set _contexts(v: ContextItem[]) { setState({ contexts: v }); }

    private get _lastUsage(): PiUsage | undefined { return stateStore.select(selectLastUsage); }
    private set _lastUsage(v: PiUsage | undefined) { setState({ lastUsage: v }); }

    private constructor(webview: vscode.Webview, extensionPath: string, disposeEvent: vscode.Event<void>) {
        this._webview = webview;
        this._extensionPath = extensionPath;
        this._clientManager = sharedClientManager;
        this._sessionManager = sharedSessionManager;
        ChatPanel._instances.push(this);
        // 注意：状态 store 是全局共享的，不能在构造器里重置，否则新面板
        // 会把 busy 置回 false，导致正在运行时的消息绕过队列。

        const root = mediaRoot(extensionPath);
        const scriptUri = webview.asWebviewUri(vs.uri.joinPath(root, 'main.js')).toString();
        const styleUri = webview.asWebviewUri(vs.uri.joinPath(root, 'main.css')).toString();
        webview.html = getWebviewHtml(
            { cspSource: webview.cspSource, scriptUri, styleUri, locale: vs.language },
            getUiStrings()
        );

        disposeEvent(() => this.dispose(), null, this._disposables);

        webview.onDidReceiveMessage(
            (message: WebviewMessage) => this._handleWebviewMessage(message),
            null,
            this._disposables
        );

        // 订阅 pi 事件；把 unsubscribe 存入 _disposables，避免面板关闭后仍响应事件
        const unsubscribe = this._clientManager.onEvent((event: PiAgentEvent) => this._onAgentEvent(event));
        this._disposables.push({ dispose: unsubscribe });
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

    /** 在编辑器标签打开聊天（复用同一 pi 客户端 / 会话） */
    public static openInEditor(extensionPath: string, column: vscode.ViewColumn = vscode.ViewColumn.Active): ChatPanel {
        const panel = vscode.window.createWebviewPanel(
            ChatPanel.editorViewType,
            'Pi',
            column,
            { enableScripts: true, localResourceRoots: [mediaRoot(extensionPath)], retainContextWhenHidden: true }
        );
        try { panel.iconPath = vscode.Uri.file(path.join(extensionPath, 'assets', 'icon.png')); } catch { /* optional */ }
        const chat = new ChatPanel(panel.webview, extensionPath, panel.onDidDispose);
        ChatPanel.currentView = chat;
        return chat;
    }

    /** 停止共享的 pi 客户端（扩展停用时调用） */
    public static async stopSharedClient(): Promise<void> {
        await sharedClientManager.stop();
    }

    /** 直接用给定 webview 创建面板（测试 / 自定义宿主用） */
    public static create(webview: vscode.Webview, extensionPath: string, disposeEvent: vscode.Event<void>): ChatPanel {
        return new ChatPanel(webview, extensionPath, disposeEvent);
    }

    public static async ensureView(): Promise<ChatPanel> {
        await vs.executeCommand(`${ChatPanel.viewType}.focus`);
        // 最多等待约 5s：webview 在慢机器/高负载下创建可能超过 2s
        for (let i = 0; i < 100; i++) {
            if (ChatPanel.currentView) { return ChatPanel.currentView; }
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        throw new Error(vscode.l10n.t('Pi chat view could not be created, please retry'));
    }

    public clear() {
        void this._abortIfBusy();
        this._busy = false;
        this._turnHadText = false;
        this._contexts = [];
        this._contextWarned = false;
        this._firstUserMessage = undefined;
        this._resetTurnChanges();
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
        this._resetTurnChanges();
        this._post({ type: 'clear' });
        this._post({ type: 'setBusy', busy: false });
        this._postContexts();
        await this._ensureClient();
    }

    // ---------- 编辑器上下文 ----------

    /** 附加当前编辑器：有选区则附加选区，否则附加整个文件 */
    public attachActive(): void {
        const editor = vs.activeTextEditor;
        if (!editor) { this._post({ type: 'notice', text: vscode.l10n.t('No active editor') }); return; }
        if (!editor.selection.isEmpty) { this._addSelectionContext(editor); }
        else { this._addFileContext(editor); }
    }

    public attachFile(): void {
        const editor = vs.activeTextEditor;
        if (!editor) { this._post({ type: 'notice', text: vscode.l10n.t('No active editor') }); return; }
        this._addFileContext(editor);
    }

    public attachSelection(): void {
        const editor = vs.activeTextEditor;
        if (!editor || editor.selection.isEmpty) { this._post({ type: 'notice', text: vscode.l10n.t('Please select some code first') }); return; }
        this._addSelectionContext(editor);
    }

    /** 从工作区选择文件/文件夹并附加（弹出菜单的“Files & folders…”） */
    public async attachFiles(): Promise<void> {
        const uris = await vs.showOpenDialog({
            canSelectMany: true,
            canSelectFiles: true,
            canSelectFolders: true,
            defaultUri: vs.workspaceFolders?.[0]?.uri,
            openLabel: vscode.l10n.t('Attach'),
        });
        if (!uris || !uris.length) { return; }
        for (const uri of uris) { this._addUriContext(uri); }
    }

    /** 把选中的 Uri 作为路径引用附加（工作区内用相对路径） */
    private _addUriContext(uri: vscode.Uri): void {
        const inWorkspace = Boolean(vs.getWorkspaceFolder(uri));
        const path = inWorkspace ? vs.asRelativePath(uri, false) : uri.fsPath;
        this._addContext({ type: 'file', path });
    }

    private _addFileContext(editor: vscode.TextEditor): void {
        const rel = vs.asRelativePath(editor.document.uri);
        this._addContext({ type: 'file', path: rel });
    }

    private _addSelectionContext(editor: vscode.TextEditor): void {
        const sel = editor.selection;
        const rel = vs.asRelativePath(editor.document.uri);
        const lineRange = sel.start.line === sel.end.line
            ? `${sel.start.line + 1}`
            : `${sel.start.line + 1}-${sel.end.line + 1}`;
        // 只记录引用（路径 + 行号），不复制选区内容；由 pi 自行读取当前内容
        this._addContext({ type: 'selection', path: rel, lineRange });
    }

    private _addContext(item: Omit<ContextItem, 'id'>): void {
        const key = `${item.type}:${item.path}:${item.lineRange || ''}`;
        if (this._contexts.some((c) => `${c.type}:${c.path}:${c.lineRange || ''}` === key)) {
            this._post({ type: 'notice', text: vscode.l10n.t('Context already attached') });
            return;
        }
        const id = 'ctx-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
        this._contexts = [...this._contexts, { ...item, id }];
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

    /** 把附加的上下文以「引用」形式拼到 prompt 前（只给路径/行号，内容由 pi 读取） */
    private _withContext(text: string, extraBlocks: string[] = []): string {
        // 斜杠命令必须位于消息开头，不能前置 context 块
        if (text.startsWith('/')) { return text; }
        return buildContextBlock(this._contexts, text, extraBlocks);
    }

    /** 根据设置构建自动上下文块（编辑器 / 诊断 / Git） */
    private async _buildAutoContext(): Promise<string[]> {
        const cfg = vs.getConfiguration('pi-agent');
        if (!cfg.get<boolean>('context.autoAttach', false)) { return []; }
        const blocks: string[] = [];
        const editor = vs.activeTextEditor;
        if (editor) {
            const doc = editor.document;
            const rel = vs.asRelativePath(doc.uri, false);
            const lines: string[] = [
                `Active file: ${rel} (${doc.languageId}, ${doc.lineCount} lines${doc.isDirty ? ', modified' : ''})`,
                `Cursor: line ${editor.selection.active.line + 1}, col ${editor.selection.active.character + 1}`,
            ];
            if (!editor.selection.isEmpty) {
                lines.push(`Selection: lines ${editor.selection.start.line + 1}-${editor.selection.end.line + 1}`);
                lines.push('```' + doc.languageId, doc.getText(editor.selection), '```');
            }
            if (cfg.get<boolean>('context.includeDiagnostics', false)) {
                const diags = vs.languages.getDiagnostics(doc.uri);
                if (diags.length) {
                    lines.push('Diagnostics:');
                    for (const d of diags.slice(0, 20)) {
                        const sev = vscode.DiagnosticSeverity[d.severity] ?? 'info';
                        lines.push(`  ${rel}:${d.range.start.line + 1} - ${sev}: ${d.message}`);
                    }
                }
            }
            blocks.push('<editor-context>\n' + lines.join('\n') + '\n</editor-context>');
        }
        if (cfg.get<boolean>('context.includeGit', false)) {
            const api = await getGitAPI();
            const repo = api ? pickGitRepository(api) : undefined;
            if (repo) {
                const branch = repo.state.HEAD?.name || '(detached)';
                const changes = repo.state.workingTreeChanges.length + repo.state.indexChanges.length;
                blocks.push(`<git-context>\nBranch: ${branch}\nChanges: ${changes}\n</git-context>`);
            }
        }
        return blocks;
    }

    private _clearContexts(): void {
        if (this._contexts.length) { this._contexts = []; this._postContexts(); }
    }

    public async askQuestion(question: string) {
        await this._handleUserMessage(question);
    }

    // ---------- 命令入口（供 VS Code 命令调用） ----------

    public async newSession(): Promise<void> { await this._handleNewSession(); }
    public focusInput(): void { this._post({ type: 'focusInput' }); }
    public editLastMessage(): void { this._post({ type: 'editLast' }); }
    public async revertLastTurn(): Promise<void> { await this._revertTurn(); }

    /** 克隆当前会话分支为一个新会话 */
    public async cloneSession(): Promise<void> {
        const client = this._clientManager.client;
        if (!client || typeof client.clone !== 'function') {
            this._post({ type: 'notice', text: vscode.l10n.t('Not connected') });
            return;
        }
        await this._abortIfBusy();
        try {
            const res = await client.clone();
            if (res.cancelled) { return; }
            await this._sessionManager.loadSessions(client);
            this._post({ type: 'clear' });
            this._busy = false;
            this._turnHadText = false;
            this._firstUserMessage = undefined;
            this._resetTurnChanges();
            this._post({ type: 'setBusy', busy: false });
            await this._restoreHistory(client);
            this._postSessionList();
            this._post({ type: 'notice', text: vscode.l10n.t('Session cloned') });
        } catch (err) {
            this._post({ type: 'notice', text: vscode.l10n.t('Clone failed: {0}', (err as Error).message) });
        }
    }

    /** 首次回合结束后，按需用一次性生成给会话命名 */
    private async _maybeAutoName(): Promise<void> {
        if (autoNameInFlight) { return; }
        if (!vs.getConfiguration('pi-agent').get<boolean>('sessions.autoName', true)) { return; }
        const text = this._firstUserMessage;
        if (!text) { return; }
        const current = this._sessionManager.sessions.find((s) => s.id === this._sessionManager.currentSessionId);
        if (current?.name) { return; }
        const id = this._sessionManager.currentSessionId;
        if (!id || this._autoNameTried.has(id)) { return; }
        this._autoNameTried.add(id);
        const client = this._clientManager.client;
        if (!client || typeof client.setSessionName !== 'function') { return; }
        autoNameInFlight = true;
        try {
            const raw = await this._clientManager.runOneShot(this._extensionPath, buildNamePrompt(text));
            const clean = raw.split('\n')[0].replace(/^["'\s]+|["'\s]+$/g, '').slice(0, 60);
            if (clean) {
                await client.setSessionName(clean);
                await this._sessionManager.loadSessions(client);
                this._postSessionList();
            }
        } catch (err) {
            logError(`auto-name failed: ${(err as Error).message}`);
        } finally {
            autoNameInFlight = false;
        }
    }

    public async cycleModel(): Promise<void> {
        const client = this._clientManager.client;
        if (!client || typeof client.cycleModel !== 'function') {
            this._post({ type: 'notice', text: vscode.l10n.t('Not connected') });
            return;
        }
        try {
            const res = await client.cycleModel();
            if (res && res.model) { this._post({ type: 'notice', text: vscode.l10n.t('Model switched: {0}', res.model.id || '') }); }
            await this._loadModels(client);
        } catch (err) {
            this._post({ type: 'notice', text: vscode.l10n.t('Failed to switch model: {0}', (err as Error).message) });
        }
    }

    public async cycleThinkingLevel(): Promise<void> {
        const client = this._clientManager.client;
        if (!client || typeof client.cycleThinkingLevel !== 'function') {
            this._post({ type: 'notice', text: vscode.l10n.t('Not connected') });
            return;
        }
        try {
            const res = await client.cycleThinkingLevel();
            if (res && res.level) { this._post({ type: 'notice', text: vscode.l10n.t('Thinking level: {0}', res.level) }); }
            await this._loadModels(client);
        } catch (err) {
            this._post({ type: 'notice', text: vscode.l10n.t('Failed to change thinking level: {0}', (err as Error).message) });
        }
    }

    public async compact(): Promise<void> {
        const client = this._clientManager.client;
        if (!client || typeof client.compact !== 'function') {
            this._post({ type: 'notice', text: vscode.l10n.t('Not connected') });
            return;
        }
        if (this._busy) {
            this._post({ type: 'notice', text: vscode.l10n.t('Pi is working; wait for it to finish before compacting') });
            return;
        }
        const confirmed = await vs.showWarningMessage(
            vscode.l10n.t('Compact this session? Older turns are summarized and cannot be undone.'),
            { modal: true },
            vscode.l10n.t('Compact')
        );
        if (confirmed !== vscode.l10n.t('Compact')) { return; }
        try {
            this._post({ type: 'notice', text: vscode.l10n.t('Compacting session…') });
            const res = await client.compact();
            this._contextWarned = false;
            this._post({
                type: 'notice',
                text: vscode.l10n.t('Session compacted ({0} → {1} tokens)', res.tokensBefore ?? '?', res.estimatedTokensAfter ?? '?'),
            });
            await this._loadStats(client);
        } catch (err) {
            this._post({ type: 'notice', text: vscode.l10n.t('Compaction failed: {0}', (err as Error).message) });
        }
    }

    // ---------- Git 集成 ----------

    /** 用当前改动生成 commit message，写入 SCM 输入框 */
    public async generateCommitMessage(): Promise<void> {
        const api = await getGitAPI();
        if (!api) { this._post({ type: 'notice', text: vscode.l10n.t('Git extension not available') }); return; }
        const repo = pickGitRepository(api);
        if (!repo) { this._post({ type: 'notice', text: vscode.l10n.t('No Git repository found') }); return; }
        let diff = '';
        try { diff = await repo.diff(true); } catch (err) { logError(`git diff --cached failed: ${(err as Error).message}`); }
        if (!diff.trim()) { try { diff = await repo.diff(false); } catch (err) { logError(`git diff failed: ${(err as Error).message}`); } }
        if (!diff.trim()) { this._post({ type: 'notice', text: vscode.l10n.t('No changes to summarize') }); return; }
        const branch = repo.state.HEAD?.name || '';
        this._post({ type: 'notice', text: vscode.l10n.t('Generating commit message…') });
        try {
            const text = await this._clientManager.runOneShot(this._extensionPath, buildCommitPrompt(diff, branch));
            if (!text) { this._post({ type: 'notice', text: vscode.l10n.t('Generation returned nothing') }); return; }
            repo.inputBox.value = text;
            this._post({ type: 'notice', text: vscode.l10n.t('Commit message generated') });
        } catch (err) {
            this._post({ type: 'notice', text: vscode.l10n.t('Generation failed: {0}', (err as Error).message) });
        }
    }

    /** 用当前分支提交生成 PR 描述，打开为临时 Markdown 文档 */
    public async generatePullRequestDescription(): Promise<void> {
        const api = await getGitAPI();
        if (!api) { this._post({ type: 'notice', text: vscode.l10n.t('Git extension not available') }); return; }
        const repo = pickGitRepository(api);
        if (!repo) { this._post({ type: 'notice', text: vscode.l10n.t('No Git repository found') }); return; }
        const branch = repo.state.HEAD?.name || '';
        let log = '';
        try {
            const commits = await repo.log({ maxEntries: 30 });
            log = commits.map((c) => '- ' + c.message.split('\n')[0]).join('\n');
        } catch (err) { logError(`git log failed: ${(err as Error).message}`); }
        this._post({ type: 'notice', text: vscode.l10n.t('Generating pull request description…') });
        try {
            const text = await this._clientManager.runOneShot(this._extensionPath, buildPrPrompt(branch, log));
            if (!text) { this._post({ type: 'notice', text: vscode.l10n.t('Generation returned nothing') }); return; }
            const doc = await vs.openTextDocument({ content: text, language: 'markdown' });
            await vs.showTextDocument(doc, { preview: false });
        } catch (err) {
            this._post({ type: 'notice', text: vscode.l10n.t('Generation failed: {0}', (err as Error).message) });
        }
    }

    // ---------- 本回合改动审阅 / 撤销 ----------

    /** 丢弃本回合改动追踪（清空 / 新建 / 切换会话后不应再回滚旧会话的文件） */
    private _resetTurnChanges(): void {
        this._turnChanges.clear();
        this._post({ type: 'turnChanges', files: [] });
    }

    /** tool_execution_start 时记录 edit/write 目标（不读文件内容，避免读到半写入状态） */
    private _trackToolTarget(event: PiAgentEvent): void {
        const tool = (event.toolName || '').toLowerCase();
        if (tool !== 'edit' && tool !== 'write') { return; }
        const args = event.args as { path?: unknown; edits?: unknown } | undefined;
        const p = args && typeof args.path === 'string' ? args.path : '';
        if (!p) { return; }
        const root = vs.workspaceFolders?.[0]?.uri.fsPath;
        const abs = path.isAbsolute(p) ? p : path.join(root || process.cwd(), p);
        const rel = root ? path.relative(root, abs).split(path.sep).join('/') : p;
        const prev = this._turnChanges.get(abs);
        const existed = prev ? prev.existed : fs.existsSync(abs);
        let edits = prev ? prev.edits : [];
        if (tool === 'write') {
            edits = null;
        } else if (edits) {
            edits = edits.concat(parseEdits(args));
        }
        this._turnChanges.set(abs, { rel, existed, edits });
    }

    private _postTurnChanges(): void {
        const files = [...this._turnChanges.values()].map((v) => ({
            path: v.rel,
            status: v.existed ? 'modified' : 'created',
            revertible: isRevertible(v),
        }));
        this._post({ type: 'turnChanges', files });
    }

    /** 把本回合改动的文件恢复到改动前状态（新建的文件移到回收站） */
    private async _revertTurn(): Promise<void> {
        if (this._turnChanges.size === 0) {
            this._post({ type: 'notice', text: vscode.l10n.t('No changes to revert') });
            return;
        }
        const ok = await vs.showWarningMessage(
            vscode.l10n.t('Revert {0} file(s) to their state before this turn?', this._turnChanges.size),
            { modal: true },
            vscode.l10n.t('Revert')
        );
        if (ok !== vscode.l10n.t('Revert')) { return; }
        let done = 0;
        let skipped = 0;
        for (const [abs, change] of this._turnChanges) {
            try {
                if (!change.existed) {
                    await vs.fs.delete(vs.uri.file(abs), { useTrash: true });
                    done++;
                } else if (change.edits) {
                    const uri = vs.uri.file(abs);
                    const current = Buffer.from(await vs.fs.readFile(uri)).toString('utf8');
                    const reverted = revertEdits(current, change.edits);
                    if (reverted === null) { skipped++; continue; }
                    await vs.fs.writeFile(uri, Buffer.from(reverted, 'utf8'));
                    done++;
                } else {
                    skipped++;
                }
            } catch (err) {
                logError(`revert ${abs} failed: ${(err as Error).message}`);
                skipped++;
            }
        }
        this._turnChanges.clear();
        this._post({ type: 'turnChanges', files: [] });
        this._post({
            type: 'notice',
            text: skipped
                ? vscode.l10n.t('Reverted {0} file(s); {1} could not be reverted automatically', done, skipped)
                : vscode.l10n.t('Reverted {0} file(s)', done),
        });
    }

    private async _openWorkspaceFile(rel: string): Promise<void> {
        const root = vs.workspaceFolders?.[0]?.uri;
        if (!root) { return; }
        try {
            const doc = await vs.openTextDocument(vs.uri.joinPath(root, rel));
            await vs.showTextDocument(doc, { preview: true });
        } catch (err) {
            this._post({ type: 'notice', text: vscode.l10n.t('Cannot open {0}: {1}', rel, (err as Error).message) });
        }
    }

    // ---------- Webview 消息处理 ----------

    private async _handleWebviewMessage(message: WebviewMessage): Promise<void> {
        switch (message.type) {
            case 'sendMessage':
                if (message.text || (message.images && message.images.length)) {
                    const text = message.text || '';
                    if (text) {
                        const validation = validateMessage(text);
                        if (!validation.valid) {
                            this._post({ type: 'notice', text: validation.error || vscode.l10n.t('Invalid message') });
                            return;
                        }
                    }
                    await this._handleUserMessage(text, message.mode, message.images);
                }
                break;
            case 'runBash':
                if (message.text) { await this._runBash(message.text, message.id); }
                break;
            case 'requestFiles':
                void this._getWorkspaceFiles().then((files) => this._post({ type: 'files', files }));
                break;
            case 'dropFiles':
                if (message.paths && message.paths.length) {
                    const rel = this._resolveDroppedPaths(message.paths);
                    if (rel.length) { this._post({ type: 'insertMentions', paths: rel }); }
                }
                break;
            case 'openFile':
                if (message.path) { await this._openWorkspaceFile(message.path); }
                break;
            case 'revertTurn':
                await this._revertTurn();
                break;
            case 'abort':
                await this._clientManager.abort();
                // 停止后丢弃等待中的 steer / follow-up，避免它们意外继续
                await this._clearQueue();
                // 同步清空 webview 上的排队/steer 徽章（不依赖 pi 是否补发 queue_update）
                this._post({ type: 'queue', steering: [], followUp: [] });
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
                // 新面板可能复用共享状态：先把已有上下文 chip 回显给 webview
                this._postContexts();
                await this._ensureClient();
                break;
            case 'attachActive':
                this.attachActive();
                break;
            case 'attachFile':
                this.attachFile();
                break;
            case 'attachSelection':
                this.attachSelection();
                break;
            case 'attachWorkspace':
                await this.attachFiles();
                break;
            case 'removeContext':
                if (message.id) { this._removeContext(message.id); }
                break;
            case 'applyCode':
                if (message.code) { await this._applyCode(message.code); }
                break;
            case 'copyCode':
                if (message.code) {
                    await vs.clipboard.writeText(message.code);
                    vs.showInformationMessage(vscode.l10n.t('Code copied to clipboard'));
                }
                break;
            case 'openLink':
                if (message.href) {
                    // 仅放行常见安全 scheme：避免把 command:/vscode:/ms-* 等自定义协议交给系统
                    const scheme = (message.href.match(/^([a-z][a-z0-9+.-]*):/i)?.[1] || '').toLowerCase();
                    if (scheme === 'http' || scheme === 'https' || scheme === 'mailto') {
                        await vs.openExternal(vs.uri.parse(message.href));
                    }
                }
                break;
            case 'notify':
                if (message.text) {
                    void vs.showInformationMessage(message.text);
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
            const folder = vs.workspaceFolders?.[0]?.uri;
            const uri = await vs.showSaveDialog({
                defaultUri: folder ? vs.uri.joinPath(folder, fileName) : vs.uri.file(fileName),
                filters: { 'Markdown': ['md'], 'Text': ['txt'] }
            });
            if (uri) {
                await vs.fs.writeFile(uri, Buffer.from(markdown, 'utf8'));
                vs.showInformationMessage(vscode.l10n.t('Conversation exported to: {0}', uri.fsPath));
            }
        } catch (err) {
            vs.showErrorMessage(vscode.l10n.t('Export failed: {0}', (err as Error).message));
        }
    }

    // ---------- Pi 客户端管理 ----------

    private async _ensureClient(): Promise<void> {
        setState({ connecting: true, connected: false });
        this._post({ type: 'connecting' });
        try {
            const client = await this._clientManager.ensureConnected(this._extensionPath);

            // 用 pi 的真实状态校准 busy（面板可能在运行中途被重新打开）
            try {
                const st = await client.getState();
                this._busy = Boolean(st.isStreaming);
                this._post({ type: 'setBusy', busy: this._busy });
            } catch (err) { logError(`reconcile busy failed: ${(err as Error).message}`); }

            // 恢复历史消息
            await this._restoreHistory(client);

            // 通知连接成功
            let folderName = vs.workspaceFolders?.[0]?.name;
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

            // 加载模型列表与斜杠命令
            await this._loadModels(client);
            await this._loadCommands(client);
            await this._loadStats(client);

            // 加载会话列表
            await this._sessionManager.loadSessions(client);
            this._postSessionList();
            setState({ connected: true, connecting: false });
        } catch (err) {
            const msg = (err as Error).message || String(err);
            logError(`Connection failed: ${msg}`);
            setState({ connected: false, connecting: false });
            this._post({ type: 'models', models: [], current: null });
            this._post({ type: 'notice', text: vscode.l10n.t('Connection failed: {0}', msg) });
            this._post({ type: 'error', text: msg });
        }
    }

    private async _restoreHistory(client: PiRpcClient): Promise<void> {
        try {
            const messages = await client.getMessages();
            const items: Array<{ role: string; text: string; images?: PiImageBlock[] }> = [];
            for (const m of messages) {
                const text = extractMessageText(m);
                const images = extractMessageImages(m);
                // 历史里用户消息带 context 块，展示时剥离
                if (text || images.length) {
                    items.push({
                        role: m.role ?? 'assistant',
                        text: text ? stripContextBlock(text) : '',
                        images: images.length ? images : undefined,
                    });
                }
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
            const statsState = {
                input: t.input || 0,
                output: t.output || 0,
                cacheRead: t.cacheRead || 0,
                cacheWrite: t.cacheWrite || 0,
                contextPercent: stats.contextUsage?.percent ?? null,
                contextWindow: stats.contextUsage?.contextWindow || 0,
                autoCompact: Boolean(state.autoCompactionEnabled),
            };
            setState({ stats: statsState });
            this._post({ type: 'stats', stats: statsState });
            this._maybeWarnContext(stats.contextUsage?.percent ?? null);
        } catch (err) { logError(`_loadStats failed: ${(err as Error).message}`); }
    }

    /** 上下文接近满时提示压缩（阈值 85%，回落到 75% 以下后重置） */
    private _maybeWarnContext(percent: number | null | undefined): void {
        const threshold = 85;
        if (percent === null || percent === undefined) { return; }
        if (percent >= threshold && !this._contextWarned) {
            this._contextWarned = true;
            void vs.showWarningMessage(
                vscode.l10n.t('Context is {0}% full. Compact the session to free space.', Math.round(percent)),
                vscode.l10n.t('Compact')
            ).then((action) => {
                if (action === vscode.l10n.t('Compact')) { void this.compact(); }
            });
        } else if (percent < threshold - 10) {
            this._contextWarned = false;
        }
    }

    /** 加载 pi 的斜杠命令 / 提示模板 / 技能，供输入框补全 */
    private async _loadCommands(client: PiRpcClient): Promise<void> {
        if (typeof client.getCommands !== 'function') { return; }
        try {
            const commands = await client.getCommands();
            this._commands = commands.map((c) => ({ name: c.name, description: c.description, source: c.source }));
            this._post({ type: 'commands', commands: this._commands });
        } catch (err) {
            logError(`_loadCommands failed: ${(err as Error).message}`);
        }
    }

    private async _loadModels(client: PiRpcClient): Promise<void> {
        try {
            const [models, state] = await Promise.all([
                client.getAvailableModels(),
                client.getState(),
            ]);
            const modelList = models.map((m: PiModelInfo) => ({ provider: m.provider, id: m.id }));
            const currentModel = state.model
                ? { provider: state.model.provider ?? '', id: state.model.id ?? '' }
                : null;
            setState({ models: modelList, currentModel });
            this._post({ type: 'models', models: modelList, current: currentModel });
            let levels: string[] = [];
            if (typeof client.getAvailableThinkingLevels === 'function') {
                levels = await client.getAvailableThinkingLevels().catch((err) => { logError(`getAvailableThinkingLevels failed: ${(err as Error).message}`); return []; });
            }
            setState({ thinkingLevels: levels, currentThinking: state.thinkingLevel ?? null });
            this._post({ type: 'thinking', levels, currentThinking: state.thinkingLevel ?? null });
            this._post({ type: 'permission', permissionMode: this._permissionMode() });
        } catch (err) {
            const msg = (err as Error).message;
            logError(`_loadModels failed: ${msg}`);
            // 避免模型选择器一直停留在「连接中…」
            this._post({ type: 'modelsError' });
            this._post({ type: 'notice', text: vscode.l10n.t('Failed to load models: {0}', msg) });
        }
    }

    private _postSessionList(): void {
        const sessions = this._sessionManager.sessions.map((s) => ({
            id: s.id,
            file: s.file,
            createdAt: s.createdAt,
            messageCount: s.messageCount,
            name: s.name,
            preview: s.preview,
        }));
        setState({ sessions: this._sessionManager.sessions, currentSessionId: this._sessionManager.currentSessionId });
        this._post({
            type: 'sessions',
            sessions,
            current: this._sessionManager.currentSessionId || null,
        });
    }

    private _permissionMode(): string {
        const mode = vs.getConfiguration('pi-agent').get<string>('agent.permissionMode', 'ask');
        if (stateStore.select(selectPermissionMode) !== mode) { setState({ permissionMode: mode }); }
        return mode;
    }

    private async _handleSetPermission(mode: string): Promise<void> {
        const target = vs.workspaceFolders?.length
            ? vs.configurationTarget.Workspace
            : vs.configurationTarget.Global;
        try {
            await vs.getConfiguration('pi-agent').update('agent.permissionMode', mode, target);
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
                    this._respondUI(client, req.id, { confirmed: true });
                    this._post({ type: 'notice', text: vscode.l10n.t('Auto-confirmed: {0}', req.title || '') });
                    return;
                }
                const choice = await vs.showWarningMessage(
                    `${req.title || vscode.l10n.t('Confirmation required')}${req.message ? '\n\n' + req.message : ''}`,
                    { modal: true },
                    vscode.l10n.t('Allow'), vscode.l10n.t('Deny')
                );
                this._respondUI(client, req.id, { confirmed: choice === vscode.l10n.t('Allow') });
                break;
            }
            case 'select': {
                const pick = await vs.showQuickPick(req.options || [], {
                    title: req.title,
                    ignoreFocusOut: true,
                });
                if (pick === undefined) { this._respondUI(client, req.id, { cancelled: true }); }
                else { this._respondUI(client, req.id, { value: pick }); }
                break;
            }
            case 'input': {
                const value = await vs.showInputBox({
                    prompt: req.title,
                    placeHolder: req.placeholder,
                    ignoreFocusOut: true,
                });
                if (value === undefined) { this._respondUI(client, req.id, { cancelled: true }); }
                else { this._respondUI(client, req.id, { value }); }
                break;
            }
            case 'editor': {
                const value = await vs.showInputBox({
                    prompt: req.title,
                    value: req.prefill || '',
                    ignoreFocusOut: true,
                });
                if (value === undefined) { this._respondUI(client, req.id, { cancelled: true }); }
                else { this._respondUI(client, req.id, { value }); }
                break;
            }
            case 'notify': {
                const text = req.message || '';
                if (req.notifyType === 'error') { void vs.showErrorMessage(text); }
                else if (req.notifyType === 'warning') { void vs.showWarningMessage(text); }
                else { void vs.showInformationMessage(text); }
                break;
            }
            default:
                // 其他请求若在等待响应，回 cancelled 避免 pi 挂起
                this._respondUI(client, req.id, { cancelled: true });
                break;
        }
    }

    /** 回复 extension_ui_request；写入 stdin 失败时记日志，避免 pi 静默等待响应 */
    private _respondUI(client: PiRpcClient, id: string, response: { value?: string; confirmed?: boolean; cancelled?: boolean }): void {
        if (!respondExtensionUI(client, id, response)) {
            logError(`respondExtensionUI failed for request ${id}; pi may be waiting for a response`);
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

    /** 若正在运行则先中断当前回合（切换 / 新建 / 克隆会话前调用，避免后台继续流式） */
    private async _abortIfBusy(): Promise<void> {
        if (!this._busy) { return; }
        await this._clientManager.abort().catch((err) => { logError(`abort failed: ${(err as Error).message}`); });
    }

    private async _handleNewSession(): Promise<void> {
        const client = this._clientManager.client;
        if (!client) {
            this._post({ type: 'notice', text: vscode.l10n.t('Not connected; cannot create session') });
            return;
        }
        await this._abortIfBusy();
        const success = await this._sessionManager.createNewSession(client);
        if (success) {
            this._post({ type: 'clear' });
            this._busy = false;
            this._turnHadText = false;
            this._contextWarned = false;
            this._firstUserMessage = undefined;
            this._resetTurnChanges();
            this._post({ type: 'setBusy', busy: false });
            this._postContexts();
            this._postSessionList();
            // 不再发送 "New session created" 通知：清空后的欢迎页本身就是反馈
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
        const name = await vs.showInputBox({
            prompt: vscode.l10n.t('Session name'),
            value: currentName || '',
            placeHolder: vscode.l10n.t('Enter a session name (leave empty to clear)'),
            ignoreFocusOut: true,
        });
        if (name === undefined) { return; }
        // 重命名非当前会话需要先切过去；若正在运行则先中断，避免中途切换会话
        if (sessionId !== this._sessionManager.currentSessionId) { await this._abortIfBusy(); }
        const before = this._sessionManager.currentSessionId;
        const ok = await this._sessionManager.renameSession(client, sessionId, name);
        if (ok) {
            // 若当前会话发生变化（切换/切回异常），重载历史保持一致
            if (this._sessionManager.currentSessionId !== before) {
                this._post({ type: 'clear' });
                this._busy = false;
                this._turnHadText = false;
                this._resetTurnChanges();
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
        await this._abortIfBusy();
        const success = await this._sessionManager.switchSession(client, sessionId);
        if (success) {
            this._post({ type: 'clear' });
            this._busy = false;
            this._turnHadText = false;
            this._contextWarned = false;
            this._firstUserMessage = undefined;
            this._resetTurnChanges();
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
        if (this._disposed) { return; }
        if (event.type === 'extension_ui_request') {
            void this._handleExtensionUI(event);
            return;
        }
        switch (event.type) {
            case 'agent_start':
                this._busy = true;
                this._turnHadText = false;
                this._lastUsage = undefined;
                this._turnChanges.clear();
                this._post({ type: 'turnChanges', files: [] });
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
                this._trackToolTarget(event);
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

            case 'queue_update':
                this._post({
                    type: 'queue',
                    steering: event.steering ? [...event.steering] : [],
                    followUp: event.followUp ? [...event.followUp] : [],
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
                this._postTurnChanges();
                void this._maybeAutoName();
                // 统计刷新与是否 abort 无关，刷新后反映最新会话状态
                const settledClient = this._clientManager.client;
                if (settledClient) { void this._loadStats(settledClient); }
                break;
            }

            default:
                break;
        }
    }

    /** 窗口失焦时，任务完成后弹通知 */
    private _notifySettled(): void {
        if (vs.windowFocused()) { return; }
        const enabled = vs.getConfiguration('pi-agent').get<boolean>('notifications.enabled', true);
        if (!enabled) { return; }
        void vs.showInformationMessage(vscode.l10n.t('Pi finished the current turn'));
    }

    /** 清空等待中的 steer / follow-up 队列 */
    private async _clearQueue(): Promise<void> {
        const client = this._clientManager.client;
        if (!client || typeof client.clearQueue !== 'function') { return; }
        try { await client.clearQueue(); } catch (err) { logError(`clearQueue failed: ${(err as Error).message}`); }
    }

    /** 工作区文件列表（供 `@` 提及补全），带 30s 缓存 */
    private async _getWorkspaceFiles(): Promise<string[]> {
        const now = Date.now();
        if (this._fileList && now - this._fileListAt < 30000) { return this._fileList; }
        try {
            const exclude = '{**/node_modules/**,**/.git/**,**/out/**,**/dist/**,**/.vscode-test/**,**/media/**,**/.next/**,**/build/**,**/target/**}';
            const uris = await vs.findFiles('**/*', exclude, 5000);
            this._fileList = uris
                .map((u) => vs.asRelativePath(u, false))
                .sort((a, b) => a.localeCompare(b));
            this._fileListAt = now;
        } catch (err) {
            logError(`findFiles failed: ${(err as Error).message}`);
            this._fileList = [];
        }
        return this._fileList;
    }

    /** 把拖入的路径解析为工作区相对路径（丢弃工作区外的路径） */
    private _resolveDroppedPaths(paths: string[]): string[] {
        const out: string[] = [];
        const seen = new Set<string>();
        for (const raw of paths) {
            const p = raw.trim();
            if (!p || p.startsWith('#')) { continue; }
            let rel: string | undefined;
            if (p.startsWith('file://')) {
                try {
                    const uri = vs.uri.parse(p);
                    if (vs.getWorkspaceFolder(uri)) { rel = vs.asRelativePath(uri, false); }
                } catch { rel = undefined; }
            } else if (path.isAbsolute(p)) {
                const uri = vs.uri.file(p);
                if (vs.getWorkspaceFolder(uri)) { rel = vs.asRelativePath(uri, false); }
            } else {
                rel = p.replace(/\\/g, '/');
            }
            if (rel && !seen.has(rel)) { seen.add(rel); out.push(rel); }
        }
        return out;
    }

    /** 直接执行 shell 命令（`!` 前缀），不经过模型回合 */
    private async _runBash(command: string, id?: string): Promise<void> {
        if (this._permissionMode() === 'restricted') {
            this._post({ type: 'bashResult', id, command, isError: true, output: vscode.l10n.t('Read-only mode: shell commands are disabled') });
            return;
        }
        const client = this._clientManager.client;
        if (!client || typeof client.bash !== 'function') {
            this._post({ type: 'bashResult', id, command, isError: true, output: vscode.l10n.t('Not connected') });
            return;
        }
        try {
            const res = await client.bash(command);
            this._post({
                type: 'bashResult',
                id,
                command,
                output: res.output,
                exitCode: res.exitCode,
                cancelled: res.cancelled,
                truncated: res.truncated,
                isError: !res.cancelled && res.exitCode !== undefined && res.exitCode !== 0,
            });
            const c2 = this._clientManager.client;
            if (c2) { void this._loadStats(c2); }
        } catch (err) {
            this._post({ type: 'bashResult', id, command, isError: true, output: (err as Error).message });
        }
    }

    // ---------- 用户消息 ----------

    private async _handleUserMessage(userText: string, mode?: string, images?: ImageAttachment[]) {
        if (userText && !this._firstUserMessage) { this._firstUserMessage = userText; }
        if (this._busy) {
            await this._enqueueWhileBusy(userText, mode, images);
            return;
        }

        this._post({ type: 'addUserMessage', text: userText, images: images && images.length ? images : undefined });
        this._busy = true;
        this._post({ type: 'setBusy', busy: true });

        try {
            const client = await this._clientManager.ensureConnected(this._extensionPath);
            const extra = await this._buildAutoContext();
            const disposition = await client.prompt(this._withContext(userText, extra), images);
            this._clearContexts();
            if (disposition === 'handled') {
                // pi 未启动新一轮（如扩展命令已处理），立即结束 busy
                this._busy = false;
                this._post({ type: 'setBusy', busy: false });
            } else if (disposition === 'queued') {
                // 已排队：当前回合结束后 pi 会自动处理，busy 保持到 agent_settled
                this._post({ type: 'notice', text: vscode.l10n.t('Message queued; pi will handle it after the current turn') });
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
            void vs.showErrorMessage(`Pi: ${msg}`, hint).then((action) => {
                if (action === vscode.l10n.t('Copy install command')) {
                    void vs.clipboard.writeText(PI_INSTALL_HINT);
                    void vs.showInformationMessage(vscode.l10n.t('Install command copied; run it in a terminal, then retry'));
                } else if (action === vscode.l10n.t('Retry connection')) {
                    void this._ensureClient().catch((e: unknown) => {
                        void vs.showErrorMessage(`Pi: ${(e as Error).message}`);
                    });
                }
            });
        }
    }

    /** 忙碌时：steer 立刻插入当前回合；否则排队为 follow-up */
    private async _enqueueWhileBusy(userText: string, mode?: string, images?: ImageAttachment[]): Promise<void> {
        try {
            const client = await this._clientManager.ensureConnected(this._extensionPath);
            const extra = await this._buildAutoContext();
            const message = this._withContext(userText, extra);
            const steering = mode === 'steer';
            if (steering && typeof client.steer === 'function') {
                await client.steer(message, images);
            } else if (typeof client.followUp === 'function') {
                await client.followUp(message, images);
            } else {
                // 客户端不支持 steer/followUp 时回退到带 streamingBehavior 的 prompt
                await client.prompt(message, images, steering ? 'steer' : 'followUp');
            }
            this._clearContexts();
            this._post({ type: 'addUserMessage', text: userText, pending: steering ? 'steering' : 'queued', images: images && images.length ? images : undefined });
        } catch (err) {
            this._post({ type: 'notice', text: vscode.l10n.t('Failed to queue message: {0}', (err as Error).message) });
        }
    }

    // ---------- 应用到编辑器 ----------

    private async _applyCode(code: string) {
        const editor = vs.activeTextEditor;
        if (!editor) {
            await vs.clipboard.writeText(code);
            vs.showWarningMessage(vscode.l10n.t('No active editor; code copied to clipboard'));
            return;
        }
        const sel = editor.selection;
        const edit = new vscode.WorkspaceEdit();
        if (!sel.isEmpty) {
            edit.replace(editor.document.uri, sel, code);
        } else {
            edit.insert(editor.document.uri, sel.active, code);
        }
        const applied = await vs.applyEdit(edit);
        if (applied) {
            vs.showInformationMessage(
                sel.isEmpty
                    ? vscode.l10n.t('Code inserted at cursor (Cmd+Z to undo)')
                    : vscode.l10n.t('Selection replaced with code (Cmd+Z to undo)')
            );
        } else {
            vs.showWarningMessage(vscode.l10n.t('Failed to apply code to the editor'));
        }
    }

    // ---------- Webview 通信 ----------

    private _post(message: PostMessage) {
        if (this._disposed) { return; }
        void this._webview.postMessage(message);
    }

    public dispose() {
        this._disposed = true;
        // 不在这里停 pi 客户端：可能有其他面板仍在使用（共享）
        ChatPanel._instances = ChatPanel._instances.filter((p) => p !== this);
        if (ChatPanel.currentView === this) {
            ChatPanel.currentView = ChatPanel._instances[ChatPanel._instances.length - 1];
        }
        while (this._disposables.length) {
            const d = this._disposables.pop();
            if (d) { d.dispose(); }
        }
    }
}
