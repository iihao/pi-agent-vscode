import * as vscode from 'vscode';
import { ChatPanel } from './chatPanel';
import { initLogger, setLogLevel, buildDiagnostics, logInfo, LogLevel } from './utils/logger';
import { initRecentFiles } from './utils/recentFiles';

export function activate(context: vscode.ExtensionContext) {
    const output = initLogger();
    applyLogLevel();
    initRecentFiles(context);
    logInfo('Pi Agent activated');

    // 注册侧边栏聊天视图（activitybar 图标 → 聊天面板）
    ChatPanel.registerViewProvider(context, context.extensionPath);

    // ---- 打开对话（聚焦侧边栏聊天视图）----
    const openChat = vscode.commands.registerCommand('pi-agent.openChat', () => {
        void ChatPanel.ensureView().catch((err: unknown) => {
            void vscode.window.showErrorMessage(`Pi: ${(err as Error).message}`);
        });
    });

    // ---- 解释选中代码 ----
    const explainCode = vscode.commands.registerCommand('pi-agent.explainCode', () =>
        askAboutSelection((ctx) => vscode.l10n.t(
            'Explain the code at {0} line {1} (current selection):\n\n```{2}\n{3}\n```\n\nDescribe its overall purpose, key logic, and potential issues.',
            ctx.relPath, ctx.lineRange, ctx.languageId, ctx.code
        )));

    // ---- 重构选中代码 ----
    const refactorCode = vscode.commands.registerCommand('pi-agent.refactorCode', () =>
        askAboutSelection((ctx) => vscode.l10n.t(
            'Refactor the code at {0} line {1} (current selection):\n\n```{2}\n{3}\n```\n\nRequirements: improve readability, fix potential issues, keep external behavior unchanged. Edit the files directly and explain the changes.',
            ctx.relPath, ctx.lineRange, ctx.languageId, ctx.code
        )));

    // ---- 生成代码 ----
    const generateCode = vscode.commands.registerCommand('pi-agent.generateCode', async () => {
        const description = await vscode.window.showInputBox({
            prompt: vscode.l10n.t('Describe the code you want to generate'),
            placeHolder: vscode.l10n.t('e.g. an HTTP request function with retry'),
            ignoreFocusOut: true,
        });
        if (!description) {
            return;
        }
        const editor = vscode.window.activeTextEditor;
        const locationHint = editor
            ? vscode.l10n.t('\n\nTarget file: {0} (language: {1})', vscode.workspace.asRelativePath(editor.document.uri), editor.document.languageId)
            : '';
        const panel = await ChatPanel.ensureView();
        await panel.askQuestion(vscode.l10n.t('Please implement: {0}{1}', description, locationHint));
    });

    // ---- 清空对话（同时开启全新 pi 会话）----
    const clearChat = vscode.commands.registerCommand('pi-agent.clearChat', () =>
        withPanel((panel) => panel.clear()));

    // ---- 新建对话 ----
    const newChat = vscode.commands.registerCommand('pi-agent.newChat', () =>
        withPanel((panel) => panel.newSession()));

    // ---- 聚焦输入框 ----
    const focusInput = vscode.commands.registerCommand('pi-agent.focusInput', () =>
        withPanel((panel) => panel.focusInput()));

    // ---- 编辑上一条消息 ----
    const editLastMessage = vscode.commands.registerCommand('pi-agent.editLastMessage', () =>
        withPanel((panel) => panel.editLastMessage()));

    // ---- 切换模型 ----
    const cycleModel = vscode.commands.registerCommand('pi-agent.cycleModel', () =>
        withPanel((panel) => panel.cycleModel()));

    // ---- 切换思考档位 ----
    const cycleThinkingLevel = vscode.commands.registerCommand('pi-agent.cycleThinkingLevel', () =>
        withPanel((panel) => panel.cycleThinkingLevel()));

    // ---- 压缩上下文 ----
    const compact = vscode.commands.registerCommand('pi-agent.compact', () =>
        withPanel((panel) => panel.compact()));

    // ---- 生成 commit message ----
    const generateCommitMessage = vscode.commands.registerCommand('pi-agent.generateCommitMessage', () =>
        withPanel((panel) => panel.generateCommitMessage()));

    // ---- 生成 PR 描述 ----
    const generatePullRequestDescription = vscode.commands.registerCommand('pi-agent.generatePullRequestDescription', () =>
        withPanel((panel) => panel.generatePullRequestDescription()));

    // ---- 撤销本回合改动 ----
    const revertLastTurn = vscode.commands.registerCommand('pi-agent.revertLastTurn', () =>
        withPanel((panel) => panel.revertLastTurn()));

    // ---- 克隆当前会话 ----
    const cloneSession = vscode.commands.registerCommand('pi-agent.cloneSession', () =>
        withPanel((panel) => panel.cloneSession()));

    // ---- 在编辑器标签打开 ----
    const openInEditor = vscode.commands.registerCommand('pi-agent.openInEditor', () => {
        ChatPanel.openInEditor(context.extensionPath, vscode.ViewColumn.Active);
    });

    // ---- 在侧边（分栏）打开 ----
    const openInEditorToSide = vscode.commands.registerCommand('pi-agent.openInEditorToSide', () => {
        ChatPanel.openInEditor(context.extensionPath, vscode.ViewColumn.Beside);
    });

    // ---- 附加编辑器上下文 ----
    const attachFile = vscode.commands.registerCommand('pi-agent.attachFile', () =>
        withPanel((panel) => panel.attachFile()));
    const attachSelection = vscode.commands.registerCommand('pi-agent.attachSelection', () =>
        withPanel((panel) => panel.attachSelection()));
    const attachFiles = vscode.commands.registerCommand('pi-agent.attachFiles', () =>
        withPanel((panel) => panel.attachFiles()));

    // ---- 重启会话（权限模式 / 可执行路径变更后生效）----
    const restartSession = vscode.commands.registerCommand('pi-agent.restartSession', () =>
        withPanel((panel) => panel.restartClient()));

    // ---- 导出诊断信息 ----
    const exportDiagnostics = vscode.commands.registerCommand('pi-agent.exportDiagnostics', async () => {
        const text = buildDiagnostics(context.extensionPath);
        const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
        const name = 'pi-agent-diagnostics-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.txt';
        const uri = await vscode.window.showSaveDialog({
            defaultUri: folder ? vscode.Uri.joinPath(folder, name) : vscode.Uri.file(name),
            filters: { 'Text': ['txt', 'log'] },
        });
        if (uri) {
            await vscode.workspace.fs.writeFile(uri, Buffer.from(text, 'utf8'));
            void vscode.window.showInformationMessage(vscode.l10n.t('Diagnostics exported to: {0}', uri.fsPath));
        }
    });

    // 配置变更：日志级别 / 可执行路径 / 权限模式
    const configWatcher = vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('pi-agent.diagnostics.level')) {
            applyLogLevel();
        }
        if (e.affectsConfiguration('pi-agent.pi.executable') ||
            e.affectsConfiguration('pi-agent.pi.arguments') ||
            e.affectsConfiguration('pi-agent.agent.permissionMode')) {
            void ChatPanel.currentView?.restartClient();
        }
    });

    // 状态栏按钮
    const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBar.text = '$(sparkle) Pi';
    statusBar.tooltip = vscode.l10n.t('Open Pi Agent (local pi agent)');
    statusBar.command = 'pi-agent.openChat';
    statusBar.show();

    context.subscriptions.push(
        openChat,
        explainCode,
        refactorCode,
        generateCode,
        clearChat,
        newChat,
        focusInput,
        editLastMessage,
        cycleModel,
        cycleThinkingLevel,
        compact,
        generateCommitMessage,
        generatePullRequestDescription,
        revertLastTurn,
        cloneSession,
        openInEditor,
        openInEditorToSide,
        attachFile,
        attachSelection,
        attachFiles,
        restartSession,
        exportDiagnostics,
        configWatcher,
        output,
        statusBar
    );
}

function applyLogLevel(): void {
    const level = vscode.workspace.getConfiguration('pi-agent').get<LogLevel>('diagnostics.level', 'info');
    setLogLevel(level);
}

/** 命令入口统一取面板：优先复用当前面板，否则在侧边栏创建 */
async function withPanel(run: (panel: ChatPanel) => void | Promise<void>): Promise<void> {
    const panel = ChatPanel.currentView ?? await ChatPanel.ensureView();
    await run(panel);
}

/** 取当前选区并按需构造提问发送给面板（无选区时由 getSelectionContext 提示并中止） */
async function askAboutSelection(build: (ctx: SelectionContext) => string): Promise<void> {
    const ctx = getSelectionContext();
    if (!ctx) { return; }
    const panel = await ChatPanel.ensureView();
    await panel.askQuestion(build(ctx));
}

export interface SelectionContext {
    relPath: string;
    languageId: string;
    code: string;
    lineRange: string;
}

/** 获取当前编辑器选区上下文（无选区时提示并返回 undefined） */
export function getSelectionContext(): SelectionContext | undefined {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty) {
        vscode.window.showWarningMessage(vscode.l10n.t('Please select some code first'));
        return undefined;
    }
    const sel = editor.selection;
    const code = editor.document.getText(sel);
    const relPath = vscode.workspace.asRelativePath(editor.document.uri);
    const lineRange = sel.start.line === sel.end.line
        ? `${sel.start.line + 1}`
        : `${sel.start.line + 1}-${sel.end.line + 1}`;
    return {
        relPath,
        languageId: editor.document.languageId,
        code,
        lineRange,
    };
}

export function deactivate() {
    // 视图由 VSCode 自动销毁；停掉共享的 pi 客户端
    void ChatPanel.stopSharedClient();
}
