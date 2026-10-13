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
import { summarizeToolArgs, formatToolArgs, formatUsage, validateMessage, extractToolOutput } from './utils/formatters';
import { buildContextBlock, stripContextBlock, parseContextRefs, ContextItem, ContextRef, AUTO_CONTEXT_ID } from './utils/context';
import { PI_INSTALL_HINT, extractMessageText, extractMessageImages, PiAgentEvent, PiRawMessage, PiImageBlock, PiRpcClient, PiModelInfo, PiSessionStats, PiSlashCommand, PiUsage, respondExtensionUI } from './sdk/piTypes';
import { selectBusy, selectContexts, selectLastUsage, selectPermissionMode, selectTurnChanges, selectPendingNewSession } from './state';
import { TurnChange, ChatState } from './state/types';
import { ChatRuntime, ChatRuntimeRegistry } from './chatPanel/runtime';
import { logInfo, logError, showLogs } from './utils/logger';
import { getRecentFiles, addRecentFile } from './utils/recentFiles';
import { getVSCodeService } from './services';
import { WebviewMessage, PostMessage, ImageAttachment } from './chatPanel/types';
import { getGitAPI, pickGitRepository } from './chatPanel/git';
import { buildCommitPrompt, buildPrPrompt, buildNamePrompt } from './chatPanel/prompts';
import { parseEdits, isRevertible, revertEdits, editsToDiff, lineDiff } from './chatPanel/turnChanges';
import { planAssistantCompletion, planToolResultCompletion, missingSuffix } from './chatPanel/turnReconcile';

/** VS Code 访问统一走服务容器（便于测试与替换） */
const vs = getVSCodeService();

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

// ---- Git 集成、Prompt 构建、改动追踪、消息类型已解耦到 chatPanel/ 目录 ----

export class ChatPanel {
    public static currentView: ChatPanel | undefined;
    public static readonly viewType = 'pi-agent.chatView';
    public static readonly secondaryViewType = 'pi-agent.chatViewSecondary';
    public static readonly editorViewType = 'pi-agent.chatEditor';
    private static _instances: ChatPanel[] = [];
    /** 会话运行时注册表：一个会话 = 一个独立 pi 客户端 + 状态 */
    private static _registry = new ChatRuntimeRegistry();

    private readonly _webview: vscode.Webview;
    private readonly _extensionPath: string;
    private _disposables: vscode.Disposable[] = [];
    /** 本面板绑定的会话运行时（同一运行时 = 同一会话 + 镜像状态） */
    private _runtime: ChatRuntime;
    /** 本面板所属界面槽位（侧边栏 / 辅助侧边栏 / 编辑器面板），决定默认会话 */
    private readonly _surfaceKey: string;
    private _runtimeUnsub: (() => void) | undefined;
    private _contextWarned = false;
    private _commands: PiSlashCommand[] = [];
    private _fileList: string[] | undefined;
    private _fileListAt = 0;
    /** 最近一次发送的用户消息（错误气泡「重试」用） */
    private _lastUserMessage: { text: string; images?: ImageAttachment[] } | undefined;
    /** 工具调用 → 本次记录前的改动状态（工具失败时回滚本次记录） */
    private readonly _pendingTrack = new Map<string, { rel: string; prev: TurnChange | undefined }>();
    /** 最近一次连接是否因「pi 未安装」失败（自检清单用） */
    private _piMissing = false;
    private _disposed = false;

    // ---- 会话级状态：存在运行时上，同一会话的多个面板共享 ----
    private get _clientManager(): PiClientManager { return this._runtime.clientManager; }
    private get _sessionManager(): SessionManager { return this._runtime.sessionManager; }
    private _patch(partial: Partial<ChatState>): void {
        this._runtime.state = { ...this._runtime.state, ...partial };
    }

    private get _busy(): boolean { return selectBusy(this._runtime.state); }
    private set _busy(v: boolean) { this._patch({ busy: v }); }

    // 渲染台账必须是面板私有的：侧边栏与编辑器标签是两个独立 webview，
    // 共享「已经渲染过什么」会让第二个面板把内容当成已下发而整段丢弃。
    private _turnHadText = false;
    /** 本回合是否渲染过任何内容（正文/思考/工具/错误），用于收尾诊断 */
    private _turnRenderedAny = false;
    /** 当前助手消息已下发的正文（message_end 对账用） */
    private _msgText = '';
    /** 当前助手消息已下发的思考内容（message_end 对账用） */
    private _msgThinking = '';
    /** 当前文本块已下发的正文（text_end 对账用） */
    private _blockText = '';
    /** 当前思考块已下发的思考内容（thinking_end 对账用） */
    private _blockThinking = '';
    /** 本回合已渲染成卡片的 toolCallId */
    private readonly _renderedToolIds = new Set<string>();
    /**
     * 本回合消息里出现过的工具调用（id → 调用信息）。
     * message_end 总早于 tool_execution_start，所以这里只记账、不立刻渲染，
     * 等回合结束时再把「从没渲染过」的补上，避免重复建卡片。
     */
    private readonly _pendingToolCalls = new Map<string, { name: string; arguments?: unknown }>();

    /** 本回合改动追踪（会话级：同一会话多面板保持同步） */
    private get _turnChanges(): TurnChange[] { return selectTurnChanges(this._runtime.state); }
    private set _turnChanges(v: TurnChange[]) { this._patch({ turnChanges: v }); }

    /** clear() 时若未连接，标记连接后需创建新会话 */
    private get _pendingNewSession(): boolean { return selectPendingNewSession(this._runtime.state); }
    private set _pendingNewSession(v: boolean) { this._patch({ pendingNewSession: v }); }

    private get _contexts(): ContextItem[] { return selectContexts(this._runtime.state); }
    private set _contexts(v: ContextItem[]) { this._patch({ contexts: v }); }

    private get _lastUsage(): PiUsage | undefined { return selectLastUsage(this._runtime.state); }
    private set _lastUsage(v: PiUsage | undefined) { this._patch({ lastUsage: v }); }

    private constructor(webview: vscode.Webview, extensionPath: string, disposeEvent: vscode.Event<void>, surfaceKey = 'default') {
        this._webview = webview;
        this._extensionPath = extensionPath;
        this._surfaceKey = surfaceKey;
        // 每个界面槽位默认各自一个独立运行时（独立会话、可并行），互不镜像。
        this._runtime = ChatPanel._registry.forSurface(surfaceKey);
        ChatPanel._instances.push(this);

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

        // 订阅本面板绑定的会话运行时事件；换绑/销毁时退订
        this._subscribeRuntime(this._runtime);
    }

    /** 订阅给定运行时的事件（会先退订旧的），并把面板登记进运行时 */
    private _subscribeRuntime(runtime: ChatRuntime): void {
        this._runtimeUnsub?.();
        this._runtime = runtime;
        runtime.panels.add(this);
        this._runtimeUnsub = runtime.clientManager.onEvent((event: PiAgentEvent) => this._onAgentEvent(event));
    }

    /**
     * 把本面板切换到另一个会话运行时（"新建会话" / 切到别的会话时）。
     * 旧运行时若已无面板则被释放（停掉其 pi 进程）；默认运行时保留。
     */
    private _bindRuntime(runtime: ChatRuntime): void {
        if (this._runtime === runtime) { return; }
        const previous = this._runtime;
        previous.panels.delete(this);
        // 旧的 busy 超时属于上一个会话，换绑后必须清掉
        this._clearBusyTimeout();
        this._resetRenderLedger();
        // 换绑后旧会话的「重试」消息不应再保留
        this._lastUserMessage = undefined;
        this._subscribeRuntime(runtime);
        void ChatPanel._registry.release(previous);
    }

    /** 重置本面板的渲染台账（换运行时/清空时用，避免把新内容当已下发丢弃） */
    private _resetRenderLedger(): void {
        this._turnHadText = false;
        this._turnRenderedAny = false;
        this._msgText = '';
        this._msgThinking = '';
        this._blockText = '';
        this._blockThinking = '';
        this._renderedToolIds.clear();
        this._pendingToolCalls.clear();
        this._pendingTrack.clear();
    }

    public static registerViewProvider(context: vscode.ExtensionContext, extensionPath: string): void {
        const makeProvider = (surfaceKey: string): vscode.WebviewViewProvider => ({
            resolveWebviewView: (view) => {
                view.webview.options = { enableScripts: true, localResourceRoots: [mediaRoot(extensionPath)] };
                const panel = new ChatPanel(view.webview, extensionPath, view.onDidDispose, surfaceKey);
                ChatPanel.currentView = panel;
                // 连接由 webview 的 ready 消息触发，确保 webview 消息监听器已就绪，
                // 避免 ESM 延迟执行导致 models/sessions 等消息被丢弃。
            },
        });
        context.subscriptions.push(
            // 主侧边栏（左）与辅助侧边栏（右）各自独立：各自一个会话、可并行运行
            vscode.window.registerWebviewViewProvider(ChatPanel.viewType, makeProvider(ChatPanel.viewType)),
            vscode.window.registerWebviewViewProvider(ChatPanel.secondaryViewType, makeProvider(ChatPanel.secondaryViewType))
        );
    }

    /** 在辅助侧边栏（右侧）打开聊天视图 */
    public static async openInSecondarySideBar(): Promise<void> {
        await vs.executeCommand(`${ChatPanel.secondaryViewType}.focus`);
    }

    /** 在编辑器标签打开聊天（编辑器面板是独立的一个界面槽位） */
    public static openInEditor(extensionPath: string, column: vscode.ViewColumn = vscode.ViewColumn.Active): ChatPanel {
        const panel = vscode.window.createWebviewPanel(
            ChatPanel.editorViewType,
            'Pi',
            column,
            { enableScripts: true, localResourceRoots: [mediaRoot(extensionPath)], retainContextWhenHidden: true }
        );
        try { panel.iconPath = vscode.Uri.file(path.join(extensionPath, 'assets', 'icon.png')); } catch { /* optional */ }
        const chat = new ChatPanel(panel.webview, extensionPath, panel.onDidDispose, ChatPanel.editorViewType);
        ChatPanel.currentView = chat;
        return chat;
    }

    /** 停止所有运行时的 pi 客户端（扩展停用时调用） */
    public static async stopSharedClient(): Promise<void> {
        await ChatPanel._registry.stopAll();
    }

    /**
     * 重启所有会话运行时的 pi 客户端（权限模式 / 可执行路径变更后），
     * 让每个已绑定的会话都重新连接并生效。
     */
    public static async restartAllClients(): Promise<void> {
        for (const runtime of ChatPanel._registry.all()) {
            await runtime.clientManager.stop().catch((err) => logError(`restart stop failed: ${(err as Error).message}`));
        }
        for (const panel of ChatPanel._instances) {
            panel._contextWarned = false;
            await panel._ensureClient().catch((err) => logError(`restart reconnect failed: ${(err as Error).message}`));
        }
    }

    /** 仅供测试：重置运行时注册表，避免用例间状态泄漏 */
    public static resetRuntimesForTest(): void {
        ChatPanel._registry = new ChatRuntimeRegistry();
    }

    /** 直接用给定 webview 创建面板（测试 / 自定义宿主用） */
    public static create(webview: vscode.Webview, extensionPath: string, disposeEvent: vscode.Event<void>, surfaceKey = 'default'): ChatPanel {
        return new ChatPanel(webview, extensionPath, disposeEvent, surfaceKey);
    }

    public static async ensureView(): Promise<ChatPanel> {
        await vs.executeCommand(`${ChatPanel.viewType}.focus`);
        // 最多等待约 5s：webview 在慢机器/高负载下创建可能超过 2s
        for (let i = 0; i < 100; i++) {
            if (ChatPanel.currentView) { return ChatPanel.currentView; }
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        throw new Error(vscode.l10n.t('Pi chat view could not be created within 5 seconds. Please check if the extension is properly activated and try again.'));
    }

    public async clear(): Promise<void> {
        // 先等流式中止落盘，再切会话；否则 pi 侧可能报「正在流式时不能新建会话」
        await this._abortIfBusy();
        this._busy = false;
        this._turnHadText = false;
        // 保留当前编辑器自动附件（仍在输入框里代表当前文件），只清掉手动附加
        this._contexts = this._contexts.filter((c) => c.auto);
        this._contextWarned = false;
        this._runtime.firstUserMessage = undefined;
        this._resetTurnChanges();
        this._post({ type: 'clear' });
        this._post({ type: 'setBusy', busy: false });
        this._postContexts();
        const client = this._clientManager.client;
        if (this._clientManager.isConnected && client) {
            try {
                const ok = await this._sessionManager.createNewSession(client);
                if (ok) { this._postSessionList(); }
            } catch (err) {
                logError(`clear/newSession failed: ${(err as Error).message}`);
                this._post({ type: 'notice', text: vscode.l10n.t('Failed to create new session: {0}', (err as Error).message) });
            }
        } else {
            // 未连接时标记待建会话，连接后 _ensureClient 会自动创建
            this._pendingNewSession = true;
            this._post({ type: 'notice', text: vscode.l10n.t('Not connected; will create a new session when Pi connects') });
        }
    }

    /** 重启 pi 客户端（权限模式/可执行路径变更后生效） */
    public async restartClient(): Promise<void> {
        await this._clientManager.stop();
        this._busy = false;
        this._turnHadText = false;
        this._contexts = this._contexts.filter((c) => c.auto);
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
        this._addContext({ type: 'file', path: this._displayPath(uri) });
    }

    /** 构建「+ 添加上下文」弹出菜单数据并下发 */
    private _postAttachMenu(): void {
        const seen = new Set<string>();
        const openEditors: Array<{ path: string; label: string; range?: string }> = [];
        const active = vs.activeTextEditor;
        if (active && active.document.uri.scheme === 'file') {
            const file = this._displayPath(active.document.uri);
            seen.add(file);
            if (!active.selection.isEmpty) {
                const sel = active.selection;
                const range = sel.start.line === sel.end.line
                    ? `${sel.start.line + 1}`
                    : `${sel.start.line + 1}-${sel.end.line + 1}`;
                openEditors.push({ path: file, label: this._baseName(file), range });
            }
            openEditors.push({ path: file, label: this._baseName(file) });
        }
        for (const uri of vs.openEditorUris()) {
            if (uri.scheme !== 'file') { continue; }
            const file = this._displayPath(uri);
            if (seen.has(file)) { continue; }
            seen.add(file);
            openEditors.push({ path: file, label: this._baseName(file) });
        }
        const recentFiles = getRecentFiles()
            .filter((p) => !seen.has(p))
            .slice(0, 6)
            .map((p) => ({ path: p, label: this._baseName(p) }));
        this._post({ type: 'attachMenu', openEditors, recentFiles });
    }

    /** 路径展示：工作区内用相对路径，否则绝对路径 */
    private _displayPath(uri: vscode.Uri): string {
        return vs.getWorkspaceFolder(uri) ? vs.asRelativePath(uri, false) : uri.fsPath;
    }

    private _baseName(file: string): string {
        const parts = file.split(/[\\/]/);
        return parts[parts.length - 1] || file;
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
        addRecentFile(item.path);
        this._postContexts();
    }

    private _removeContext(id: string): void {
        const target = this._contexts.find((c) => c.id === id);
        // 叉掉自动附件后，该文档在本会话中不再自动加回（切换文档后恢复）
        if (target?.auto) { this._runtime.autoContextDismissedDoc = target.path; }
        this._contexts = this._contexts.filter((c) => c.id !== id);
        this._postContexts();
        // 移除的是手动条目时，若当前活动文件已无 chip，把自动附件补回
        if (target && !target.auto) { ChatPanel.syncAutoContext(); }
    }

    private _postContexts(): void {
        ChatPanel.broadcastContexts(this._runtime);
    }

    /** 把某个运行时的上下文广播给绑定它的所有面板（同会话 chip 保持一致） */
    public static broadcastContexts(runtime: ChatRuntime): void {
        const contexts = runtime.state.contexts.map((c) => ({
            id: c.id, type: c.type, path: c.path, lineRange: c.lineRange, auto: c.auto,
        }));
        for (const panel of runtime.panels) {
            panel._post({ type: 'contexts', contexts });
        }
    }

    /** 某个编辑器对应的引用：有选区则选区，否则整个文件 */
    private static _editorRefFor(editor: vscode.TextEditor): ContextRef {
        const rel = vs.asRelativePath(editor.document.uri);
        if (editor.selection.isEmpty) { return { type: 'file', path: rel }; }
        const sel = editor.selection;
        const lineRange = sel.start.line === sel.end.line
            ? `${sel.start.line + 1}`
            : `${sel.start.line + 1}-${sel.end.line + 1}`;
        return { type: 'selection', path: rel, lineRange };
    }

    /**
     * 同步「当前编辑器」自动附件（默认开启，类似 Claude Code）：
     * - 有活动编辑器（file scheme）时，默认附加选区/文件，作为输入框 chip；
     * - 无活动编辑器时保留已有附件（焦点可能在聊天 webview 上），仅当文件已关闭才移除；
     * - 用户叉掉后该文档不再自动加回，切换文档后恢复；
     * - 自动附件用保留 id，不覆盖用户手动附加的同一引用。
     */
    public static syncAutoContext(): void {
        const enabled = vs.getConfiguration('pi-agent').get<boolean>('context.autoAttachActiveEditor', true);
        const editor = enabled ? vs.activeTextEditor : undefined;
        const ref = (editor && editor.document.uri.scheme === 'file')
            ? ChatPanel._editorRefFor(editor)
            : undefined;
        // 无活动编辑器时才需要「文件是否还打开着」这个集合
        const openPaths = ref ? undefined : new Set(vs.openEditorUris().map((u) => vs.asRelativePath(u)));
        for (const runtime of ChatPanel._registry.all()) {
            ChatPanel._syncRuntimeAutoContext(runtime, enabled, ref, openPaths);
        }
    }

    /** 对单个运行时的上下文同步自动附件（每个会话/输入框各自维护） */
    private static _syncRuntimeAutoContext(
        runtime: ChatRuntime,
        enabled: boolean,
        ref: ContextRef | undefined,
        openPaths: Set<string> | undefined,
    ): void {
        const contexts = runtime.state.contexts;
        const autoItem = contexts.find((c) => c.auto);
        const withoutAuto = contexts.filter((c) => !c.auto);
        const setContexts = (next: ContextItem[]): void => {
            runtime.state = { ...runtime.state, contexts: next };
            ChatPanel.broadcastContexts(runtime);
        };

        if (!ref) {
            // 无活动编辑器：保留自动附件，除非自动附加被关闭或其文件已不在打开的标签里。
            if (autoItem) {
                const stillOpen = enabled && Boolean(openPaths?.has(autoItem.path));
                if (!stillOpen) { setContexts(withoutAuto); }
            }
            return;
        }

        // 切换文档后恢复自动附加：dismiss 只作用于叉掉时的那个文档
        if (runtime.autoContextDismissedDoc && runtime.autoContextDismissedDoc !== ref.path) {
            runtime.autoContextDismissedDoc = undefined;
        }
        if (runtime.autoContextDismissedDoc === ref.path) {
            if (autoItem) { setContexts(withoutAuto); }
            return;
        }

        const refKey = `${ref.type}:${ref.path}:${ref.lineRange || ''}`;
        // 用户已手动附加同一引用：不重复添加，并清掉可能存在的自动条目
        const dup = withoutAuto.some((c) => `${c.type}:${c.path}:${c.lineRange || ''}` === refKey);
        if (dup) {
            if (autoItem) { setContexts(withoutAuto); }
            return;
        }

        const autoKey = autoItem ? `${autoItem.type}:${autoItem.path}:${autoItem.lineRange || ''}` : undefined;
        if (refKey === autoKey) { return; } // 无变化

        setContexts([...withoutAuto, { ...ref, id: AUTO_CONTEXT_ID, auto: true }]);
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
        // 保留自动附件（仍代表当前编辑器），只清掉手动附加的引用
        const manual = this._contexts.filter((c) => !c.auto);
        if (manual.length) {
            this._contexts = this._contexts.filter((c) => c.auto);
            this._postContexts();
        }
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
            this._runtime.firstUserMessage = undefined;
            this._resetTurnChanges();
            this._post({ type: 'setBusy', busy: false });
            await this._restoreHistory(client);
            this._postSessionList();
            this._post({ type: 'notice', text: vscode.l10n.t('Session cloned') });
        } catch (err) {
            this._post({ type: 'notice', text: vscode.l10n.t('Clone failed: {0}', (err as Error).message) });
        }
    }

    /** 首次回合结束后，按需用一次性生成给会话命名（按会话隔离） */
    private async _maybeAutoName(): Promise<void> {
        const runtime = this._runtime;
        if (runtime.autoNameInFlight) { return; }
        if (!vs.getConfiguration('pi-agent').get<boolean>('sessions.autoName', true)) { return; }
        const text = runtime.firstUserMessage;
        if (!text) { return; }
        const current = this._sessionManager.sessions.find((s) => s.id === this._sessionManager.currentSessionId);
        if (current?.name) { return; }
        const id = this._sessionManager.currentSessionId;
        if (!id || runtime.autoNameTried.has(id)) { return; }
        runtime.autoNameTried.add(id);
        const client = this._clientManager.client;
        if (!client || typeof client.setSessionName !== 'function') { return; }
        runtime.autoNameInFlight = true;
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
            runtime.autoNameInFlight = false;
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
        // 压缩是破坏性且不可撤销，但由明确的入口（占用圈 / 命令 / 命令面板）触发，
        // 不再弹二次确认；用会话运行时的 in-flight 标志防重复触发。
        const runtime = this._runtime;
        if (runtime.compactInFlight) { return; }
        runtime.compactInFlight = true;
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
        } finally {
            runtime.compactInFlight = false;
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
        this._turnChanges = [];
        this._pendingTrack.clear();
        this._runtime.revertSnapshot.clear();
        this._post({ type: 'turnChanges', turnFiles: [] });
    }

    /** tool_execution_start 时记录 edit/write 目标（不读文件内容，避免读到半写入状态） */
    private _trackToolTarget(event: PiAgentEvent): void {
        const tool = (event.toolName || '').toLowerCase();
        if (tool !== 'edit' && tool !== 'write') { return; }
        const args = event.args as { path?: unknown; edits?: unknown; content?: unknown } | undefined;
        const p = args && typeof args.path === 'string' ? args.path : '';
        if (!p) { return; }
        const root = vs.workspaceFolders?.[0]?.uri.fsPath;
        const abs = path.isAbsolute(p) ? p : path.join(root || process.cwd(), p);
        const rel = root ? path.relative(root, abs).split(path.sep).join('/') : p;
        const list = [...this._turnChanges];
        const idx = list.findIndex((c) => c.rel === rel);
        const prev = idx >= 0 ? list[idx] : undefined;
        const existed = prev ? prev.existed : fs.existsSync(abs);
        let edits = prev ? prev.edits : [];
        let before = prev?.before;
        let written = prev?.written;
        if (tool === 'write') {
            edits = null;
            // 首次触碰：快照文件原内容（用于生成 diff / 还原）
            if (!prev) {
                try { before = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : undefined; } catch { before = undefined; }
            }
            if (typeof args?.content === 'string') { written = args.content; }
        } else if (edits) {
            edits = edits.concat(parseEdits(args));
        }
        const entry: TurnChange = { rel, existed, edits, before, written };
        // 记住本次调用前的状态：工具失败时回滚本次记录
        if (event.toolCallId) {
            this._pendingTrack.set(event.toolCallId, { rel, prev });
        }
        if (idx >= 0) { list[idx] = entry; } else { list.push(entry); }
        this._turnChanges = list;
    }

    /** 工具结束：成功则确认记录，失败则撤销本次调用写入的改动记录 */
    private _settleToolTrack(event: PiAgentEvent): void {
        if (!event.toolCallId) { return; }
        const pending = this._pendingTrack.get(event.toolCallId);
        if (!pending) { return; }
        this._pendingTrack.delete(event.toolCallId);
        if (!event.isError) { return; }
        const list = [...this._turnChanges];
        const idx = list.findIndex((c) => c.rel === pending.rel);
        if (idx < 0) { return; }
        if (pending.prev) { list[idx] = pending.prev; } else { list.splice(idx, 1); }
        this._turnChanges = list;
    }

    private _postTurnChanges(): void {
        this._post({ type: 'turnChanges', turnFiles: this._turnChangeFiles() });
    }

    /** 本回合改动还原结果（逐文件） */
    private static readonly TURN_REVERT_RESULT_LIVE_MS = 4500; // 全部成功后自动隐藏延时

    /** 撤销给定文件集合（不传则撤销全部），返回逐文件结果 */
    private async _doRevert(changes: TurnChange[]): Promise<Array<{ path: string; result: 'reverted' | 'deleted' | 'failed' | 'skipped'; error?: string }>> {
        const results: Array<{ path: string; result: 'reverted' | 'deleted' | 'failed' | 'skipped'; error?: string }> = [];
        const root = vs.workspaceFolders?.[0]?.uri.fsPath || process.cwd();

        for (const change of changes) {
            const abs = path.isAbsolute(change.rel) ? change.rel : path.join(root, change.rel);
            try {
                // 撤销前先快照当前（回合后）状态，供再撤回使用
                let snapshot: { content: string | null; existed: boolean };
                try {
                    if (fs.existsSync(abs)) {
                        snapshot = { content: Buffer.from(await vs.fs.readFile(vs.uri.file(abs))).toString('utf8'), existed: true };
                    } else {
                        snapshot = { content: null, existed: false };
                    }
                } catch {
                    snapshot = { content: null, existed: false };
                }

                if (!change.existed) {
                    await vs.fs.delete(vs.uri.file(abs), { useTrash: true });
                    this._runtime.revertSnapshot.set(change.rel, snapshot);
                    results.push({ path: change.rel, result: 'deleted' });
                } else if (change.edits) {
                    const uri = vs.uri.file(abs);
                    const current = Buffer.from(await vs.fs.readFile(uri)).toString('utf8');
                    const reverted = revertEdits(current, change.edits);
                    if (reverted === null) {
                        results.push({ path: change.rel, result: 'failed',
                            error: vscode.l10n.t('Content changed since the turn; the edit no longer matches') });
                        logError(`revert ${abs}: edit no longer matches current content`);
                        continue;
                    }
                    await vs.fs.writeFile(uri, Buffer.from(reverted, 'utf8'));
                    this._runtime.revertSnapshot.set(change.rel, snapshot);
                    results.push({ path: change.rel, result: 'reverted' });
                } else if (change.before !== undefined) {
                    // write：用快照还原整个文件
                    const uri = vs.uri.file(abs);
                    await vs.fs.writeFile(uri, Buffer.from(change.before, 'utf8'));
                    this._runtime.revertSnapshot.set(change.rel, snapshot);
                    results.push({ path: change.rel, result: 'reverted' });
                } else {
                    results.push({ path: change.rel, result: 'skipped',
                        error: vscode.l10n.t('Overwritten files cannot be reverted automatically') });
                }
            } catch (err) {
                const msg = (err as Error).message;
                results.push({ path: change.rel, result: 'failed', error: msg });
                logError(`revert ${abs} failed: ${msg}`);
            }
        }
        return results;
    }

    /** 计算行内卡片展示数据（保留未撤销的文件，标记已撤销/失败的文件） */
    private _turnChangeFiles(): Array<{ path: string; status: 'created' | 'modified'; revertible: boolean; state: 'pending' | 'reverted' | 'deleted' | 'failed' | 'skipped'; diff?: string }> {
        return this._turnChanges.map((v) => ({
            path: v.rel,
            status: v.existed ? 'modified' : 'created',
            revertible: isRevertible(v),
            state: 'pending',
            diff: this._diffFor(v),
        }));
    }

    /** 该文件本回合的 diff：edit 用参数重建，write 用「快照 → 写入内容」；算一次后缓存。 */
    private _diffFor(v: TurnChange): string | undefined {
        if (v.diff !== undefined) { return v.diff || undefined; }
        let diff: string | undefined;
        if (v.edits && v.edits.length) {
            diff = editsToDiff(v.edits);
        } else if (v.written !== undefined) {
            diff = lineDiff(v.before ?? '', v.written);
        }
        v.diff = diff ?? '';
        return diff;
    }

    /**
     * 把本回合改动的文件恢复到改动前状态。无弹窗确认，逐文件反馈结果，
     * 由 webview 在卡片上原地展示：成功打勾、失败标红并说明原因。
     * @param onlyRel 仅撤销指定文件；不传则撤销全部
     */
    private async _revertTurn(onlyRel?: string): Promise<void> {
        if (this._turnChanges.length === 0) {
            this._post({ type: 'notice', text: vscode.l10n.t('No changes to revert') });
            return;
        }

        const targets = onlyRel
            ? this._turnChanges.filter((c) => c.rel === onlyRel)
            : this._turnChanges;
        if (targets.length === 0) { return; }

        const results = await this._doRevert(targets);

        if (onlyRel) {
            // 单文件撤销：从待撤销列表中移除该文件，其余保留
            this._turnChanges = this._turnChanges.filter((c) => c.rel !== onlyRel);
        } else {
            this._turnChanges = [];
        }

        this._post({
            type: 'turnRevertResult',
            results,
            turnFiles: this._turnChangeFiles(),
            canUndo: this._runtime.revertSnapshot.size > 0,
            autoHideMs: ChatPanel.TURN_REVERT_RESULT_LIVE_MS,
        });
    }

    /** 「再撤回」：把上次撤销恢复回去，让用户无惧误操作 */
    private async _undoRevert(): Promise<void> {
        if (this._runtime.revertSnapshot.size === 0) {
            this._post({ type: 'notice', text: vscode.l10n.t('Nothing to restore') });
            return;
        }
        const root = vs.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
        let restored = 0;
        for (const [rel, snap] of this._runtime.revertSnapshot) {
            const abs = path.isAbsolute(rel) ? rel : path.join(root, rel);
            try {
                if (snap.existed && snap.content !== null) {
                    await vs.fs.writeFile(vs.uri.file(abs), Buffer.from(snap.content, 'utf8'));
                } else {
                    // 撤销前该文件不存在（本回合新建），恢复 = 删除
                    await vs.fs.delete(vs.uri.file(abs), { useTrash: true });
                }
                restored++;
            } catch (err) {
                logError(`undo revert ${abs} failed: ${(err as Error).message}`);
            }
        }
        this._runtime.revertSnapshot.clear();
        this._post({
            type: 'turnUndoResult',
            restored,
            text: vscode.l10n.t('Restored {0} file(s) to the state right after the turn', restored),
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
            case 'revertTurnFile':
                if (message.path) { await this._revertTurn(message.path); }
                break;
            case 'undoRevert':
                await this._undoRevert();
                break;
            case 'abort':
                await this._clientManager.abort();
                // 停止后丢弃等待中的 steer / follow-up，避免它们意外继续
                await this._clearQueue();
                // 同步清空 webview 上的排队/steer 徽章（不依赖 pi 是否补发 queue_update）
                this._post({ type: 'queue', steering: [], followUp: [] });
                break;
            case 'errorAction':
                // 错误气泡上的按钮：重发上一条消息 / 打开日志（切模型在 webview 侧本地完成）
                if (message.action === 'retry') {
                    const last = this._lastUserMessage;
                    if (last) { await this._handleUserMessage(last.text, undefined, last.images); }
                } else if (message.action === 'logs') {
                    showLogs();
                }
                break;
            case 'setupAction':
                if (message.action) { await this._handleSetupAction(message.action); }
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
                // 新面板可能复用共享状态：先同步自动附件并把上下文 chip 回显给 webview
                ChatPanel.syncAutoContext();
                this._postContexts();
                await this._ensureClient();
                break;
            case 'attachActive':
                this.attachActive();
                break;
            case 'attachWorkspace':
                await this.attachFiles();
                break;
            case 'requestAttachMenu':
                this._postAttachMenu();
                break;
            case 'attachPath':
                if (message.path) {
                    // 用菜单传入的 path + range 直接生成引用，不依赖当前活动编辑器
                    if (message.range) { this._addContext({ type: 'selection', path: message.path, lineRange: message.range }); }
                    else { this._addContext({ type: 'file', path: message.path }); }
                }
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
            case 'compact':
                await this.compact();
                break;
            case 'clear':
                await this.clear();
                break;
            case 'cloneSession':
                await this.cloneSession();
                break;
            case 'focusSearch':
                this._post({ type: 'focusSearch' });
                break;
            case 'showHelp':
                this._post({ type: 'showHelp' });
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
        this._patch({ connecting: true, connected: false });
        this._post({ type: 'connecting' });
        this._postSetupStatus();
        // 如果正在流式输出（如编辑器面板 ready 消息到达时用户已发送消息），
        // 不能清空 webview，否则会抹掉正在渲染的内容。
        if (!this._busy) {
            // 清空现有聊天内容，避免重连时历史消息重复追加
            this._post({ type: 'clear' });
        } else {
            logInfo('_ensureClient: skipping clear (turn in progress)');
        }
        try {
            const client = await this._clientManager.ensureConnected(this._extensionPath, this._runtime.startOptions);

            // 用 pi 的真实状态校准 busy（面板可能在运行中途被重新打开）
            try {
                const st = await client.getState();
                this._runtime.sessionId = st.sessionId;
                // 记录会话文件：客户端重启后复用同一会话，而不是又开一个新的
                if (st.sessionFile) {
                    this._runtime.sessionFile = st.sessionFile;
                    this._runtime.startOptions = { sessionFile: st.sessionFile };
                }
                this._busy = Boolean(st.isStreaming);
                this._post({ type: 'setBusy', busy: this._busy });
            } catch (err) { logError(`reconcile busy failed: ${(err as Error).message}`); }

            // clear() 时若未连接，连接后自动创建新会话
            if (this._pendingNewSession) {
                this._pendingNewSession = false;
                try {
                    const ok = await this._sessionManager.createNewSession(client);
                    if (ok) { this._postSessionList(); }
                } catch (err) {
                    logError(`pending new session failed: ${(err as Error).message}`);
                }
            }

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
            this._piMissing = false;
            this._patch({ connected: true, connecting: false });
            this._postSetupStatus();
        } catch (err) {
            const msg = (err as Error).message || String(err);
            this._piMissing = err instanceof PiNotFoundError;
            logError(`Connection failed: ${msg}`);
            this._patch({ connected: false, connecting: false });
            this._postSetupStatus();
            this._post({ type: 'models', models: [], current: null });
            this._post({ type: 'notice', text: vscode.l10n.t('Connection failed: {0}', msg) });
            this._postError(msg);
        }
    }

    private async _restoreHistory(client: PiRpcClient): Promise<void> {
        try {
            const messages = await client.getMessages();
            const items: Array<{ role: string; text: string; images?: PiImageBlock[]; attachments?: Array<{ type: string; path: string; lineRange?: string }> }> = [];
            for (const m of messages) {
                const text = extractMessageText(m);
                const images = extractMessageImages(m);
                // 历史里用户消息带 context 块：剥掉后展示，并解析出附件用于回显
                const refs = text ? parseContextRefs(text) : [];
                if (text || images.length) {
                    items.push({
                        role: m.role ?? 'assistant',
                        text: text ? stripContextBlock(text) : '',
                        images: images.length ? images : undefined,
                        attachments: refs.length ? refs.map((r) => ({ type: r.type, path: r.path, lineRange: r.lineRange })) : undefined,
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
            this._patch({ stats: statsState });
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
            this._patch({ models: modelList, currentModel });
            this._post({ type: 'models', models: modelList, current: currentModel });
            let levels: string[] = [];
            if (typeof client.getAvailableThinkingLevels === 'function') {
                levels = await client.getAvailableThinkingLevels().catch((err) => { logError(`getAvailableThinkingLevels failed: ${(err as Error).message}`); return []; });
            }
            this._patch({ thinkingLevels: levels, currentThinking: state.thinkingLevel ?? null });
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
        this._runtime.sessionId = this._sessionManager.currentSessionId;
        const sessions = this._sessionManager.sessions.map((s) => ({
            id: s.id,
            file: s.file,
            createdAt: s.createdAt,
            messageCount: s.messageCount,
            name: s.name,
            preview: s.preview,
        }));
        this._patch({ sessions: this._sessionManager.sessions, currentSessionId: this._sessionManager.currentSessionId });
        this._post({
            type: 'sessions',
            sessions,
            current: this._sessionManager.currentSessionId || null,
        });
    }

    private _permissionMode(): string {
        const mode = vs.getConfiguration('pi-agent').get<string>('agent.permissionMode', 'ask');
        if (selectPermissionMode(this._runtime.state) !== mode) { this._patch({ permissionMode: mode }); }
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
                const text = typeof req.message === 'string' ? req.message : '';
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

    /** abort 恢复超时：agent_settled 未到达时强制解锁 */
    private static readonly ABORT_RECOVERY_MS = 30 * 1000; // 30 秒

    /** 若正在运行则先中断当前回合（切换 / 新建 / 克隆会话前调用，避免后台继续流式） */
    private async _abortIfBusy(): Promise<void> {
        if (!this._busy) { return; }
        await this._clientManager.abort().catch((err) => { logError(`abort failed: ${(err as Error).message}`); });
        // abort 后 busy 状态由 agent_settled 事件处理；若事件未到达，强制恢复超时兜底
        this._clearBusyTimeout();
        this._busyTimeout = setTimeout(() => {
            if (this._busy) {
                logError('Abort recovery timeout reached; force resetting busy state');
                this._busy = false;
                this._post({ type: 'toolSettle' });
                this._post({ type: 'setBusy', busy: false });
                this._postError(vscode.l10n.t('Pi turn was aborted and did not settle within {0} seconds; you can send a new message', ChatPanel.ABORT_RECOVERY_MS / 1000));
            }
        }, ChatPanel.ABORT_RECOVERY_MS);
    }

    /**
     * 仅当本面板是本运行时的唯一使用者时才中止当前回合。
     * 侧边栏 / 辅助侧边栏共享同一会话时，在其中一个里新建或切换会话
     * 不应打断另一个仍在运行的回合。
     */
    private async _abortIfSole(): Promise<void> {
        if (this._runtime.panels.size <= 1) { await this._abortIfBusy(); }
    }

    private async _handleNewSession(): Promise<void> {
        // 「新建会话」= 为这个界面槽位开一个全新的会话运行时，其他界面不受影响。
        await this._abortIfSole();
        const runtime = ChatPanel._registry.create({ continueRecent: false });
        ChatPanel._registry.bindSurface(this._surfaceKey, runtime);
        this._bindRuntime(runtime);
        this._post({ type: 'clear' });
        this._busy = false;
        this._contextWarned = false;
        this._resetTurnChanges();
        this._post({ type: 'setBusy', busy: false });
        this._postContexts();
        await this._ensureClient();
        // _ensureClient 会加载会话列表并回填 runtime.sessionId
    }

    private async _handleRenameSession(sessionId: string, currentName?: string): Promise<void> {
        // 若该会话由另一个运行时持有，走那个运行时重命名，
        // 避免同一会话文件被两个 pi 进程同时打开。
        const owner = ChatPanel._registry.bySessionId(sessionId) ?? this._runtime;
        const client = owner.clientManager.client;
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
        if (name === undefined) {
            void vs.showInformationMessage(vscode.l10n.t('Rename cancelled'));
            return;
        }
        // 重命名非当前会话需要先切过去；若正在运行则先中断，避免中途切换会话
        if (sessionId !== owner.sessionManager.currentSessionId && owner.state.busy) {
            await owner.clientManager.abort().catch((err) => logError(`abort before rename failed: ${(err as Error).message}`));
        }
        const before = owner.sessionManager.currentSessionId;
        const ok = await owner.sessionManager.renameSession(client, sessionId, name);
        if (ok) {
            // 若 owner 的当前会话被意外切换（切换/切回异常），让绑定它的面板重载历史
            if (owner.sessionManager.currentSessionId !== before) {
                for (const panel of owner.panels) {
                    panel._post({ type: 'clear' });
                    panel._busy = false;
                    panel._clearBusyTimeout();
                    panel._resetTurnChanges();
                    panel._post({ type: 'setBusy', busy: false });
                    await panel._restoreHistory(client);
                }
            }
            // 刷新所有运行时的会话列表（同一会话目录）并重渲染
            for (const rt of ChatPanel._registry.all()) {
                const c = rt.clientManager.client;
                if (c) { await rt.sessionManager.loadSessions(c).catch(() => { /* 忽略 */ }); }
                for (const panel of rt.panels) { panel._postSessionList(); }
            }
            this._post({ type: 'notice', text: vscode.l10n.t('Session renamed') });
        } else {
            this._post({ type: 'notice', text: vscode.l10n.t('Rename failed. Please check the session file permissions and try again.') });
        }
    }

    private async _handleSwitchSession(sessionId: string): Promise<void> {
        // 会话文件：各运行时共用同一会话目录，用当前面板的列表即可
        const session = this._sessionManager.sessions.find((s) => s.id === sessionId);
        if (!session || !session.file) {
            this._post({ type: 'notice', text: vscode.l10n.t('Failed to switch session. The session may no longer exist or the file may be corrupted.') });
            return;
        }
        // 已在目标会话：无操作
        if (this._runtime.sessionId === sessionId) { return; }

        // 共享同一会话时不中止他人的回合
        await this._abortIfSole();

        // 已有运行时在跑该会话 → 直接切过去（与那边的面板共享、镜像）
        const existing = ChatPanel._registry.bySessionId(sessionId);
        if (existing) {
            ChatPanel._registry.bindSurface(this._surfaceKey, existing);
            this._bindRuntime(existing);
            this._post({ type: 'clear' });
            this._busy = existing.state.busy;
            this._post({ type: 'setBusy', busy: this._busy });
            this._postContexts();
            await this._ensureClient();
            this._post({ type: 'notice', text: vscode.l10n.t('Switched to session: {0}', sessionId) });
            return;
        }

        // 否则为该会话新建一个运行时（打开指定会话文件）
        const runtime = ChatPanel._registry.create({ sessionFile: session.file });
        runtime.sessionId = sessionId;
        runtime.sessionFile = session.file;
        ChatPanel._registry.bindSurface(this._surfaceKey, runtime);
        this._bindRuntime(runtime);
        this._post({ type: 'clear' });
        this._busy = false;
        this._contextWarned = false;
        this._resetTurnChanges();
        this._post({ type: 'setBusy', busy: false });
        this._postContexts();
        await this._ensureClient();
        this._post({ type: 'notice', text: vscode.l10n.t('Switched to session: {0}', sessionId) });
    }

    // ---------- 事件桥接（pi → webview） ----------

    private _onAgentEvent(event: PiAgentEvent): void {
        if (this._disposed) {
            logInfo(`_onAgentEvent: skipped (disposed=${this._disposed}) type=${event.type}`);
            return;
        }
        if (event.type === 'extension_ui_request') {
            void this._handleExtensionUI(event);
            return;
        }
        // 诊断：记录所有非 thinking/text 事件类型，便于发现未知事件
        if (event.type !== 'agent_start' && event.type !== 'message_update'
            && event.type !== 'agent_settled' && event.type !== 'queue_update'
            && event.type !== 'auto_retry_start') {
            logInfo(`_onAgentEvent: type=${event.type}, tool=${event.toolName ?? '-'}`);
        }
        switch (event.type) {
            case 'agent_start':
                this._busy = true;
                this._turnHadText = false;
                this._resetTurnLedger();
                this._lastUsage = undefined;
                this._turnChanges = [];
                this._runtime.revertSnapshot.clear();   // 新回合开始，旧的再撤回快照失效
                this._post({ type: 'turnChanges', turnFiles: [] });
                this._post({ type: 'setBusy', busy: true });
                break;

            case 'message_update': {
                if (event.usage) { this._lastUsage = event.usage; }
                const ae = event.assistantMessageEvent;
                if (!ae) { break; }
                if (ae.type === 'thinking_start') {
                    this._blockThinking = '';
                    this._post({ type: 'thinkingStart' });
                } else if (ae.type === 'thinking_delta' && ae.delta) {
                    this._blockThinking += ae.delta;
                    this._msgThinking += ae.delta;
                    this._post({ type: 'thinkingDelta', text: ae.delta });
                } else if (ae.type === 'thinking_end') {
                    // 兜底：增量丢失时用 thinking_end 的完整内容补齐，保证思考内容不丢
                    this._fillThinking(
                        typeof ae.thinking === 'string' && ae.thinking
                            ? ae.thinking
                            : (typeof ae.content === 'string' ? ae.content : ''),
                    );
                    this._post({ type: 'thinkingEnd' });
                } else if (ae.type === 'text_start') {
                    this._blockText = '';
                } else if (ae.type === 'text_delta' && ae.delta) {
                    this._blockText += ae.delta;
                    this._msgText += ae.delta;
                    this._postAssistantChunk(ae.delta);
                } else if (ae.type === 'text' && ae.delta) {
                    // pi SDK 有时直接发送完整文本（非流式），而非 text_delta 流
                    this._blockText += ae.delta;
                    this._msgText += ae.delta;
                    this._postAssistantChunk(ae.delta);
                } else if (ae.type === 'text_end') {
                    // 兜底：增量丢失时用 text_end 的完整内容补齐，保证正文不丢
                    this._fillText(typeof ae.content === 'string' ? ae.content : '');
                    this._blockText = '';
                    if (this._turnHadText) {
                        this._turnHadText = false;
                        this._post({ type: 'assistantEnd' });
                    }
                } else {
                    // 未知事件类型，记录日志以便诊断
                    logInfo(`message_update: unrecognized assistantMessageEvent type: ${ae.type}`);
                }
                break;
            }

            case 'message_start': {
                // 新的一条助手消息开始：重置按消息统计的台账
                const started = event.message;
                if (started && typeof started !== 'string' && started.role === 'assistant') {
                    this._msgText = '';
                    this._msgThinking = '';
                    this._blockText = '';
                    this._blockThinking = '';
                }
                break;
            }

            case 'message_end': {
                // pi 的权威消息：补齐任何没渲染出去的内容，并透出失败原因
                const done = event.message;
                if (!done || typeof done === 'string') { break; }
                if (done.role === 'assistant') { this._completeAssistantMessage(done); }
                else if (done.role === 'toolResult') { this._completeToolResult(done); }
                break;
            }

            case 'tool_execution_start':
                if (event.toolCallId) { this._renderedToolIds.add(event.toolCallId); }
                // 注意：不要重置 _turnHadText！
                // _turnHadText 跟踪的是"本回合是否已发出 assistantStart"，
                // 工具运行不应该影响它。text_end 依赖这个标志来决定是否发 assistantEnd。
                // 如果这里重置，工具运行后 text_end 会跳过 assistantEnd，导致流永远悬空。
                this._trackToolTarget(event);
                this._post({
                    type: 'toolCall',
                    tool: event.toolName ?? 'tool',
                    detail: summarizeToolArgs(event.args),
                    toolArgs: formatToolArgs(event.args) || undefined,
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
                // 失败的工具不算作本回合改动（回滚它写入的追踪记录）
                this._settleToolTrack(event);
                const details = event.result?.details;
                const diff = details?.diff;
                const output = extractToolOutput(event.result);
                this._post({
                    type: 'toolEnd',
                    tool: event.toolName ?? 'tool',
                    toolCallId: event.toolCallId,
                    isError: Boolean(event.isError),
                    durationMs: event.durationMs,
                    diff: typeof diff === 'string' && diff ? diff : undefined,
                    output: output || undefined,
                    truncated: Boolean(details?.truncation?.truncated),
                    fullOutputPath: details?.fullOutputPath,
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
                this._clearBusyTimeout();
                // 兜底：如果 text_end 被错过（如 tool_execution_start 曾错误重置 _turnHadText），
                // 确保关闭助手流，避免 webview 侧流式光标永久悬停。
                if (this._turnHadText) {
                    this._turnHadText = false;
                    this._post({ type: 'assistantEnd' });
                    logError('agent_settled: assistant stream was still open (text_end missed); forced assistantEnd');
                }
                this._turnHadText = false;
                this._post({ type: 'thinkingEnd' });
                // 兜底：消息里有、却从没渲染过的工具调用（例如事件丢失）补上
                this._settlePendingToolCalls();
                // 兜底：仍停在「运行中」的工具卡片必须收尾，避免永久转圈
                this._post({ type: 'toolSettle' });
                const u = this._lastUsage;
                if (u && (u.input || u.output)) {
                    this._post({ type: 'notice', text: vscode.l10n.t('Usage this turn: {0} tokens', formatUsage(u)) });
                } else if (!this._turnRenderedAny) {
                    // 诊断：本回合确实什么都没渲染出来（请求失败 / 只思考无输出）
                    logError('agent_settled: nothing was rendered this turn (no text, thinking, tool or error)');
                }
                this._resetTurnLedger();
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

    /** 下发一段助手正文：必要时先开气泡，保证任何一段内容都不会被 webview 丢掉 */
    private _postAssistantChunk(text: string): void {
        if (!text) { return; }
        if (!this._turnHadText) {
            this._turnHadText = true;
            this._post({ type: 'assistantStart' });
        }
        this._turnRenderedAny = true;
        this._post({ type: 'assistantChunk', text });
    }

    /** 用权威内容补齐当前文本块（流式增量缺失时），宁可重复也不漏 */
    private _fillText(full: string): void {
        const missing = missingSuffix(full, this._blockText);
        if (!missing.suffix) { return; }
        if (missing.mismatch) {
            logError('text reconcile: streamed text is not a prefix of pi\'s message; re-sending the authoritative block');
        }
        this._blockText += missing.suffix;
        this._msgText += missing.suffix;
        this._postAssistantChunk(missing.suffix);
    }

    /** 用权威内容补齐当前思考块（流式增量缺失时） */
    private _fillThinking(full: string): void {
        const missing = missingSuffix(full, this._blockThinking);
        if (!missing.suffix) { return; }
        if (missing.mismatch) {
            logError('thinking reconcile: streamed thinking is not a prefix of pi\'s message; re-sending the authoritative block');
        }
        this._blockThinking += missing.suffix;
        this._msgThinking += missing.suffix;
        this._turnRenderedAny = true;
        this._post({ type: 'thinkingDelta', text: missing.suffix });
    }

    /**
     * 一条助手消息结束：以 pi 的权威消息为准补齐正文 / 思考 / 工具调用 / 失败原因。
     * 这是「插件只改变呈现形式、不改变内容」的兜底保证。
     */
    private _completeAssistantMessage(m: PiRawMessage): void {
        const completion = planAssistantCompletion(
            m,
            { text: this._msgText, thinking: this._msgThinking },
            this._renderedToolIds,
        );
        if (completion.thinkingSuffix) {
            if (completion.thinkingMismatch) {
                logError('assistant message reconcile: thinking mismatch; re-sending the authoritative content');
            }
            this._msgThinking += completion.thinkingSuffix;
            this._turnRenderedAny = true;
            this._post({ type: 'thinkingDelta', text: completion.thinkingSuffix });
        }
        if (completion.textSuffix) {
            if (completion.textMismatch) {
                logError('assistant message reconcile: text mismatch; re-sending the authoritative content');
            }
            this._msgText += completion.textSuffix;
            this._postAssistantChunk(completion.textSuffix);
        }
        for (const tc of completion.toolCalls) {
            // 只记账：tool_execution_start 之后才会执行，回合结束时统一对账
            this._pendingToolCalls.set(tc.id, { name: tc.name, arguments: tc.arguments });
        }
        if (completion.error || completion.aborted) {
            this._turnRenderedAny = true;
            if (completion.aborted) {
                // 用户主动停止（stopReason=aborted）：不是失败，给个中性提示即可，
                // 不要弹出带「重试/切换模型/查看日志」的错误气泡。
                this._post({ type: 'notice', text: vscode.l10n.t('Stopped') });
            } else {
                logError(`pi turn failed: ${completion.error}`);
                this._postError(completion.error as string);
            }
        }
    }

    /** 一条工具结果消息结束：补齐没渲染过的工具卡片与结果（重复下发是幂等的）
     *  注意：tool_execution_start 一定先于工具结果，所以这里建卡片不会重复。 */
    private _completeToolResult(m: PiRawMessage): void {
        const completion = planToolResultCompletion(m, this._renderedToolIds);
        if (!completion) { return; }
        const output = extractToolOutput({ content: completion.content, details: completion.details });
        const diff = completion.details?.diff;
        if (completion.needCard) {
            this._renderedToolIds.add(completion.toolCallId);
            this._turnRenderedAny = true;
            logError(`tool result reconcile: rendered a tool call that was never streamed (${completion.toolName})`);
            this._post({
                type: 'toolCall',
                tool: completion.toolName,
                detail: '',
                toolCallId: completion.toolCallId,
            });
        }
        this._turnRenderedAny = true;
        this._post({
            type: 'toolEnd',
            tool: completion.toolName,
            toolCallId: completion.toolCallId,
            isError: completion.isError,
            durationMs: completion.durationMs,
            diff: typeof diff === 'string' && diff ? diff : undefined,
            output: output || undefined,
            truncated: Boolean(completion.details?.truncation?.truncated),
            fullOutputPath: completion.details?.fullOutputPath,
        });
    }

    /** 回合结束：把「消息里有、但从没渲染过」的工具调用补成卡片（内容不丢） */
    private _settlePendingToolCalls(): void {
        for (const [id, call] of this._pendingToolCalls) {
            if (this._renderedToolIds.has(id)) { continue; }
            this._renderedToolIds.add(id);
            this._turnRenderedAny = true;
            logError(`tool reconcile: rendered a tool call that was never streamed (${call.name})`);
            this._post({
                type: 'toolCall',
                tool: call.name,
                detail: summarizeToolArgs(call.arguments),
                toolArgs: formatToolArgs(call.arguments) || undefined,
                toolCallId: id,
            });
        }
    }

    /** 回合结束：清空渲染台账，下一回合重新对账 */
    private _resetTurnLedger(): void {
        this._msgText = '';
        this._msgThinking = '';
        this._blockText = '';
        this._blockThinking = '';
        this._renderedToolIds.clear();
        this._pendingToolCalls.clear();
        this._turnRenderedAny = false;
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
                fullOutputPath: res.fullOutputPath,
                isError: !res.cancelled && res.exitCode !== undefined && res.exitCode !== 0,
            });
            const c2 = this._clientManager.client;
            if (c2) { void this._loadStats(c2); }
        } catch (err) {
            this._post({ type: 'bashResult', id, command, isError: true, output: (err as Error).message });
        }
    }

    // ---------- 用户消息 ----------

    /** busy 状态超时保护：pi 进程异常时自动解锁，避免用户永久无法发送消息 */
    private _busyTimeout: NodeJS.Timeout | undefined;
    private static readonly BUSY_TIMEOUT_MS = 10 * 60 * 1000; // 10 分钟

    private _startBusyTimeout(): void {
        this._clearBusyTimeout();
        this._busyTimeout = setTimeout(() => {
            if (this._busy) {
                logError('Busy timeout reached; force resetting busy state');
                this._busy = false;
                this._post({ type: 'toolSettle' });
                this._post({ type: 'setBusy', busy: false });
                this._postError(vscode.l10n.t('Pi turn timed out after 10 minutes; you can send a new message'));
            }
        }, ChatPanel.BUSY_TIMEOUT_MS);
    }

    private _clearBusyTimeout(): void {
        if (this._busyTimeout) {
            clearTimeout(this._busyTimeout);
            this._busyTimeout = undefined;
        }
    }

    /** 当前输入框里的上下文附件（用于消息回显告知用户本条带了附件） */
    private _currentAttachments(): Array<{ type: string; path: string; lineRange?: string }> {
        return this._contexts.map((c) => ({ type: c.type, path: c.path, lineRange: c.lineRange }));
    }

    private async _handleUserMessage(userText: string, mode?: string, images?: ImageAttachment[]) {
        if (userText && !this._runtime.firstUserMessage) { this._runtime.firstUserMessage = userText; }
        // 记录最近一条用户消息，供错误气泡「重试」重发
        this._lastUserMessage = { text: userText, images };
        if (this._busy) {
            await this._enqueueWhileBusy(userText, mode, images);
            return;
        }

        const attachments = this._currentAttachments();
        this._post({
            type: 'addUserMessage',
            text: userText,
            attachments: attachments.length ? attachments : undefined,
            images: images && images.length ? images : undefined,
        });
        this._busy = true;
        this._startBusyTimeout();
        this._post({ type: 'setBusy', busy: true });

        try {
            const client = await this._clientManager.ensureConnected(this._extensionPath);
            const extra = await this._buildAutoContext();
            const disposition = await client.prompt(this._withContext(userText, extra), images);
            this._clearContexts();
            if (disposition === 'handled') {
                // pi 未启动新一轮（如扩展命令已处理），立即结束 busy
                this._busy = false;
                this._clearBusyTimeout();
                this._post({ type: 'setBusy', busy: false });
            } else if (disposition === 'queued') {
                // 已排队：当前回合结束后 pi 会自动处理，busy 保持到 agent_settled
                this._post({ type: 'notice', text: vscode.l10n.t('Message queued; pi will handle it after the current turn') });
            }
        } catch (err) {
            this._busy = false;
            this._clearBusyTimeout();
            this._post({ type: 'thinkingEnd' });
            this._post({ type: 'setBusy', busy: false });

            const msg = (err as Error).message || String(err);

            // 仅当进程确实崩溃时才重置客户端（类型判断，不依赖文案）
            if (isProcessError(err)) {
                await this._clientManager.stop();
                void this._ensureClient().catch((err) => { logError(`reconnect after crash failed: ${(err as Error).message}`); });
            }

            this._postError(msg);

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
        const steering = mode === 'steer';
        const attachments = this._currentAttachments();
        // 先展示用户消息（带 pending 状态），避免排队失败时消息丢失
        this._post({
            type: 'addUserMessage',
            text: userText,
            pending: steering ? 'steering' : 'queued',
            attachments: attachments.length ? attachments : undefined,
            images: images && images.length ? images : undefined,
        });
        try {
            const client = await this._clientManager.ensureConnected(this._extensionPath);
            const extra = await this._buildAutoContext();
            const message = this._withContext(userText, extra);
            if (steering && typeof client.steer === 'function') {
                await client.steer(message, images);
            } else if (typeof client.followUp === 'function') {
                await client.followUp(message, images);
            } else {
                // 客户端不支持 steer/followUp 时回退到带 streamingBehavior 的 prompt
                await client.prompt(message, images, steering ? 'steer' : 'followUp');
            }
            this._clearContexts();
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

    /** 错误气泡的可操作按钮（有可重试的消息时才提供重试 / 切模型） */
    private _errorActions(): Array<{ id: string; label: string }> {
        const actions: Array<{ id: string; label: string }> = [];
        if (this._lastUserMessage) {
            actions.push({ id: 'retry', label: vscode.l10n.t('Retry') });
            actions.push({ id: 'model', label: vscode.l10n.t('Switch model') });
        }
        actions.push({ id: 'logs', label: vscode.l10n.t('Show logs') });
        return actions;
    }

    /** 以可操作错误气泡的形式报告错误 */
    private _postError(text: string): void {
        this._post({ type: 'error', text, actions: this._errorActions() });
    }

    /** 首次环境自检：pi 是否安装 / 是否连接 / 是否有模型 / 工作区是否受信 */
    private _postSetupStatus(): void {
        const status = {
            connecting: this._runtime.state.connecting,
            connected: this._runtime.state.connected,
            piFound: this._runtime.state.connected || !this._piMissing,
            hasModels: this._runtime.state.models.length > 0,
            workspaceTrusted: vscode.workspace.isTrusted,
        };
        this._post({ type: 'setup', setup: status });
    }

    /** 首次环境自检清单上的一键动作 */
    private async _handleSetupAction(action: string): Promise<void> {
        switch (action) {
            case 'install': {
                await vs.clipboard.writeText(PI_INSTALL_HINT);
                const term = vscode.window.createTerminal('Pi setup');
                term.show();
                term.sendText(PI_INSTALL_HINT);
                void vs.showInformationMessage(vscode.l10n.t('Install command copied — run it in the terminal, then Retry'));
                break;
            }
            case 'pi': {
                // 开一个终端运行 pi，让用户登录 / 选模型
                const term = vscode.window.createTerminal('Pi');
                term.show();
                term.sendText('pi');
                break;
            }
            case 'retry':
                await this._ensureClient();
                break;
            case 'trust':
                try { await vs.executeCommand('workbench.trust.manage'); } catch { /* 忽略 */ }
                break;
            case 'logs':
                showLogs();
                break;
            default:
                break;
        }
    }

    public dispose() {
        this._disposed = true;
        // 退出本面板的运行时；若该运行时已无其他面板则停掉其 pi 进程
        this._runtimeUnsub?.();
        this._runtimeUnsub = undefined;
        this._runtime.panels.delete(this);
        void ChatPanel._registry.release(this._runtime);
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
