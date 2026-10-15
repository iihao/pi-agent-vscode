import * as vscode from 'vscode';
import { ChatPanel } from './chatPanel';
import { initLogger, setLogLevel, buildDiagnostics, logInfo, LogLevel } from './utils/logger';
import { initRecentFiles } from './utils/recentFiles';

/** Debounce timer for auto-attachment sync */
let autoContextTimer: NodeJS.Timeout | undefined;

/** Debounced syncAutoContext (fires on every selection change, so it needs throttling) */
function scheduleSyncAutoContext(): void {
    if (autoContextTimer) { clearTimeout(autoContextTimer); }
    autoContextTimer = setTimeout(() => {
        autoContextTimer = undefined;
        ChatPanel.syncAutoContext();
    }, 150);
}

export function activate(context: vscode.ExtensionContext) {
    const output = initLogger();
    applyLogLevel();
    initRecentFiles(context);
    logInfo('Pi Agent activated');

    // Register the sidebar chat view (activity bar icon -> chat panel)
    ChatPanel.registerViewProvider(context, context.extensionPath);

    // Active editor / selection change -> sync the composer's auto file attachment (on by default)
    ChatPanel.syncAutoContext();
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(() => scheduleSyncAutoContext()),
        vscode.window.onDidChangeTextEditorSelection(() => scheduleSyncAutoContext()),
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('pi-agent.context.autoAttachActiveEditor')) {
                ChatPanel.syncAutoContext();
            }
        }),
    );

    // ---- Open the chat (focus the sidebar chat view) ----
    const openChat = vscode.commands.registerCommand('pi-agent.openChat', () => {
        void ChatPanel.ensureView().catch((err: unknown) => {
            void vscode.window.showErrorMessage(`Pi: ${(err as Error).message}`);
        });
    });

    // ---- Explain the selected code ----
    const explainCode = vscode.commands.registerCommand('pi-agent.explainCode', () =>
        askAboutSelection((ctx) => vscode.l10n.t(
            'Explain the code at {0} line {1} (current selection):\n\n```{2}\n{3}\n```\n\nDescribe its overall purpose, key logic, and potential issues.',
            ctx.relPath, ctx.lineRange, ctx.languageId, ctx.code
        )));

    // ---- Refactor the selected code ----
    const refactorCode = vscode.commands.registerCommand('pi-agent.refactorCode', () =>
        askAboutSelection((ctx) => vscode.l10n.t(
            'Refactor the code at {0} line {1} (current selection):\n\n```{2}\n{3}\n```\n\nRequirements: improve readability, fix potential issues, keep external behavior unchanged. Edit the files directly and explain the changes.',
            ctx.relPath, ctx.lineRange, ctx.languageId, ctx.code
        )));

    // ---- Generate code ----
    const generateCode = vscode.commands.registerCommand('pi-agent.generateCode', async () => {
        const description = await vscode.window.showInputBox({
            prompt: vscode.l10n.t('Describe the code you want to generate'),
            placeHolder: vscode.l10n.t('e.g. an HTTP request function with retry'),
            ignoreFocusOut: true,
        });
        if (!description) {
            void vscode.window.showInformationMessage(vscode.l10n.t('Code generation cancelled'));
            return;
        }
        const editor = vscode.window.activeTextEditor;
        const locationHint = editor
            ? vscode.l10n.t('\n\nTarget file: {0} (language: {1})', vscode.workspace.asRelativePath(editor.document.uri), editor.document.languageId)
            : '';
        const panel = await ChatPanel.ensureView();
        await panel.askQuestion(vscode.l10n.t('Please implement: {0}{1}', description, locationHint));
    });

    // ---- Clear the chat (also starts a fresh pi session) ----
    const clearChat = vscode.commands.registerCommand('pi-agent.clearChat', () =>
        withPanel((panel) => panel.clear()));

    // ---- New chat ----
    const newChat = vscode.commands.registerCommand('pi-agent.newChat', () =>
        withPanel((panel) => panel.newSession()));

    // ---- Focus the composer ----
    const focusInput = vscode.commands.registerCommand('pi-agent.focusInput', () =>
        withPanel((panel) => panel.focusInput()));

    // ---- Edit the last message ----
    const editLastMessage = vscode.commands.registerCommand('pi-agent.editLastMessage', () =>
        withPanel((panel) => panel.editLastMessage()));

    // ---- Cycle model ----
    const cycleModel = vscode.commands.registerCommand('pi-agent.cycleModel', () =>
        withPanel((panel) => panel.cycleModel()));

    // ---- Cycle thinking level ----
    const cycleThinkingLevel = vscode.commands.registerCommand('pi-agent.cycleThinkingLevel', () =>
        withPanel((panel) => panel.cycleThinkingLevel()));

    // ---- Compact the context ----
    const compact = vscode.commands.registerCommand('pi-agent.compact', () =>
        withPanel((panel) => panel.compact()));

    // ---- Generate a commit message ----
    const generateCommitMessage = vscode.commands.registerCommand('pi-agent.generateCommitMessage', () =>
        withPanel((panel) => panel.generateCommitMessage()));

    // ---- Generate a pull request description ----
    const generatePullRequestDescription = vscode.commands.registerCommand('pi-agent.generatePullRequestDescription', () =>
        withPanel((panel) => panel.generatePullRequestDescription()));

    // ---- Revert this turn's changes ----
    const revertLastTurn = vscode.commands.registerCommand('pi-agent.revertLastTurn', () =>
        withPanel((panel) => panel.revertLastTurn()));

    // ---- Clone the current session ----
    const cloneSession = vscode.commands.registerCommand('pi-agent.cloneSession', () =>
        withPanel((panel) => panel.cloneSession()));

    // ---- Open in an editor tab ----
    const openInEditor = vscode.commands.registerCommand('pi-agent.openInEditor', () => {
        ChatPanel.openInEditor(context.extensionPath, vscode.ViewColumn.Active);
    });

    // ---- Open beside (split) ----
    const openInEditorToSide = vscode.commands.registerCommand('pi-agent.openInEditorToSide', () => {
        ChatPanel.openInEditor(context.extensionPath, vscode.ViewColumn.Beside);
    });

    // ---- Open in the secondary side bar (right) ----
    const openInSecondarySideBar = vscode.commands.registerCommand('pi-agent.openInSecondarySideBar', () => {
        void ChatPanel.openInSecondarySideBar().catch((err: unknown) => {
            void vscode.window.showErrorMessage(`Pi: ${(err as Error).message}`);
        });
    });

    // ---- Manage model providers ----
    const manageProviders = vscode.commands.registerCommand('pi-agent.manageProviders', () =>
        withPanel((panel) => panel.manageProviders()));

    // ---- Attach editor context ----
    const attachFile = vscode.commands.registerCommand('pi-agent.attachFile', () =>
        withPanel((panel) => panel.attachFile()));
    const attachSelection = vscode.commands.registerCommand('pi-agent.attachSelection', () =>
        withPanel((panel) => panel.attachSelection()));
    const attachFiles = vscode.commands.registerCommand('pi-agent.attachFiles', () =>
        withPanel((panel) => panel.attachFiles()));

    // ---- Reload the session from disk (new pi process; only this session is touched) ----
    const restartSession = vscode.commands.registerCommand('pi-agent.restartSession', () =>
        withPanel(async (panel) => { await panel.restartClient(); }));

    // ---- Export diagnostics ----
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

    // Config changes: log level / executable / permission mode
    const configWatcher = vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('pi-agent.diagnostics.level')) {
            applyLogLevel();
        }
        if (e.affectsConfiguration('pi-agent.context.autoAttachActiveEditor')) {
            ChatPanel.syncAutoContext();
        }
        if (e.affectsConfiguration('pi-agent.pi.executable') ||
            e.affectsConfiguration('pi-agent.pi.arguments') ||
            e.affectsConfiguration('pi-agent.agent.permissionMode')) {
            // Tell the user the config change will restart the session
            if (ChatPanel.currentView) {
                void vscode.window.showInformationMessage(
                    vscode.l10n.t('Configuration changed; restarting Pi session…')
                );
            }
            // Restart every session runtime, not just the one bound to the current panel
            // (each running turn is aborted first, so nothing is killed mid-write)
            void ChatPanel.restartAllClients();
        }
    });

    // Status bar button
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
        openInSecondarySideBar,
        manageProviders,
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

/** Command entry point: reuse the current panel, otherwise create one in the sidebar */
async function withPanel(run: (panel: ChatPanel) => void | Promise<void>): Promise<void> {
    const panel = ChatPanel.currentView ?? await ChatPanel.ensureView();
    await run(panel);
}

/** Take the current selection, build a question from it and send it (getSelectionContext warns and aborts when nothing is selected) */
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

/** Get the current editor selection context (warns and returns undefined when nothing is selected) */
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
    // VS Code disposes the views; stop the shared pi client here
    if (autoContextTimer) {
        clearTimeout(autoContextTimer);
        autoContextTimer = undefined;
    }
    void ChatPanel.stopSharedClient();
}
