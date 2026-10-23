// ---------------------------------------------------------------------------
// ChatPanel - main chat panel (refactored)
// ---------------------------------------------------------------------------

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { getWebviewHtml } from './views/webviewTemplate';
import { getUiStrings } from './views/strings';
import { PiClientManager, PiStartError, PiNotFoundError } from './sdk/clientManager';
import { SessionManager } from './sdk/sessionManager';
import { summarizeToolArgs, formatToolArgs, formatUsage, validateMessage, extractToolOutput } from './utils/formatters';
import { buildContextBlock, stripContextBlock, parseContextRefs, ContextItem, ContextRef, AUTO_CONTEXT_ID } from './utils/context';
import { PI_INSTALL_HINT, extractMessageText, extractMessageImages, PiAgentEvent, PiRawMessage, PiRpcClient, PiModelInfo, PiSessionStats, PiSlashCommand, PiUsage, PiSessionEntry, PiToolResultBlock, respondExtensionUI } from './sdk/piTypes';
import { selectBusy, selectContexts, selectLastUsage, selectPermissionMode, selectTurnChanges, selectPendingNewSession } from './state';
import { TurnChange, ChatState } from './state/types';
import { ChatRuntime, ChatRuntimeRegistry } from './chatPanel/runtime';
import { logInfo, logError, showLogs } from './utils/logger';
import { getRecentFiles, addRecentFile } from './utils/recentFiles';
import { getVSCodeService } from './services';
import { WebviewMessage, PostMessage, ImageAttachment, HistoryItem } from './chatPanel/types';
import { getGitAPI, pickGitRepository } from './chatPanel/git';
import { buildCommitPrompt, buildPrPrompt, buildNamePrompt } from './chatPanel/prompts';
import { parseEdits, isRevertible, revertEditsDetailed, editsToDiff, lineDiff } from './chatPanel/turnChanges';
import { planAssistantCompletion, planToolResultCompletion, missingSuffix } from './chatPanel/turnReconcile';
import { KNOWN_PROVIDERS, providerLabel } from './chatPanel/providers';
import { preferredModel, rememberModel } from './chatPanel/modelPreference';

/** All VS Code access goes through the service container (easier to test and swap) */
const vs = getVSCodeService();

/**
 * Cap on replayed transcript items. A very long session would otherwise create
 * tens of thousands of DOM nodes on every reconnect; the full log always stays
 * on disk, and anything dropped is reported to the user instead of vanishing.
 * 1500 is deliberately well below what a browser can technically render: the
 * cost is not the node count but the per-item markdown + highlight parse on
 * reconnect, which should stay inside a blink even on slow machines.
 */
const HISTORY_MAX_ITEMS = 1500;

/** Whether an error is a "pi process / connection" problem (checked by type/code, not localized text) */
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

/** Directory holding the built webview assets */
function mediaRoot(extensionPath: string): vscode.Uri {
    return vs.uri.file(path.join(extensionPath, 'media'));
}

// ---- Git integration, prompt builders, change tracking and message types live under chatPanel/ ----

export class ChatPanel {
    public static currentView: ChatPanel | undefined;
    public static readonly viewType = 'pi-agent.chatView';
    public static readonly secondaryViewType = 'pi-agent.chatViewSecondary';
    public static readonly editorViewType = 'pi-agent.chatEditor';
    private static _instances: ChatPanel[] = [];
    /** Session runtime registry: one session = one independent pi client + state */
    private static _registry = new ChatRuntimeRegistry();

    private readonly _webview: vscode.Webview;
    private readonly _extensionPath: string;
    private _disposables: vscode.Disposable[] = [];
    /** Session runtime this panel is bound to (same runtime = same session + shared state) */
    private _runtime: ChatRuntime;
    /** Surface slot this panel belongs to (sidebar / secondary sidebar / editor panel); decides its default session */
    private readonly _surfaceKey: string;
    private _runtimeUnsub: (() => void) | undefined;
    private _contextWarned = false;
    private _commands: PiSlashCommand[] = [];
    private _fileList: string[] | undefined;
    private _fileListAt = 0;
    /** Last user message sent (for the error bubble's "Retry") */
    private _lastUserMessage: { text: string; images?: ImageAttachment[] } | undefined;
    /**
     * Tool call -> the change record as it was before that call, so a failed tool can
     * roll its record back. Runtime-scoped (see `ChatRuntime.pendingToolTracks`): the
     * records it guards are shared, and the panel that writes them can change mid-tool.
     */
    private get _pendingTrack(): Map<string, { rel: string; prev: TurnChange | undefined }> {
        return this._runtime.pendingToolTracks;
    }
    /** Whether the last connect failed because pi is not installed (for the setup checklist) */
    private _piMissing = false;
    /** Credential status of the current provider (from `pi auth check`) */
    private _authStatus: { provider?: string; ready?: boolean; reason?: string } = {};
    private _disposed = false;

    // ---- Session-level state lives on the runtime and is shared by panels on the same session ----
    private get _clientManager(): PiClientManager { return this._runtime.clientManager; }
    private get _sessionManager(): SessionManager { return this._runtime.sessionManager; }
    private _patch(partial: Partial<ChatState>): void {
        this._runtime.state = { ...this._runtime.state, ...partial };
    }

    private get _busy(): boolean { return selectBusy(this._runtime.state); }
    private set _busy(v: boolean) { this._patch({ busy: v }); }

    /**
     * Whether this webview currently holds transcript content for the bound
     * runtime. Session state is shared between panels, so "is a turn running"
     * cannot answer it: one panel may be mid-turn while another (just opened,
     * or switched to a session it has never rendered) has an empty webview.
     * Cleared whenever the transcript is wiped, set when content is rendered.
     */
    private _webviewSynced = false;

    /**
     * Bumped on every transcript wipe. An in-flight `_restoreHistory` carries
     * the epoch it started under: if the webview was cleared while the session
     * log was still being read (a New chat / reload landed mid-replay), the
     * loaded items belong to a transcript the webview no longer shows and the
     * replay must be dropped, not appended.
     */
    private _transcriptEpoch = 0;

    /**
     * Wipe the transcript and record that the webview no longer has content.
     *
     * `boot` tells the webview whether the transcript state is still unknown
     * afterwards: true when the transcript is about to be rebuilt from disk (so
     * it keeps showing only the empty state's identity until the replay), false
     * when we already know the session is empty (New chat / `/clear`), which
     * lets the full empty state appear right away.
     */
    private _clearTranscript(boot = true): void {
        this._webviewSynced = false;
        this._transcriptEpoch++;
        this._post({ type: 'clear', boot });
    }

    /**
     * Post to every panel bound to this session. For runtime-level state
     * (session list, turn-change reset) whose presentation must not diverge
     * between two views of one session; per-turn streaming posts stay
     * panel-local because each panel holds its own render ledger.
     */
    private _postRuntime(message: PostMessage): void {
        for (const panel of this._runtime.panels) { panel._post(message); }
    }

    /**
     * Session-level transcript reset: every view of this session, not just the
     * panel the user acted in. A new/cloned/reloaded session is a change to the
     * shared runtime; leaving a sibling panel showing the old transcript makes
     * two views of one session disagree about what the conversation is.
     */
    private _broadcastClearTranscript(boot = true): void {
        for (const panel of this._runtime.panels) { panel._clearTranscript(boot); }
    }

    /**
     * Replay the session file into every panel that was just cleared but not
     * filled yet — the panel that ran `_ensureClient` has already replayed
     * itself, the others would otherwise sit in their boot state forever.
     */
    private async _replayPendingPanels(): Promise<void> {
        const client = this._clientManager.client;
        if (!client) { return; }
        for (const panel of this._runtime.panels) {
            if (!panel._webviewSynced) { await panel._restoreHistory(client); }
        }
    }

    /**
     * Set the shared busy state and tell every panel bound to this runtime.
     * Busy lives on the runtime, so reconciling it from pi (a reconnect) would
     * otherwise leave the other panels' webviews showing a stale state.
     */
    private _broadcastBusy(busy: boolean): void {
        this._busy = busy;
        for (const panel of this._runtime.panels) { panel._post({ type: 'setBusy', busy }); }
    }

    // The render ledger must be panel-private: the sidebar and the editor tab are
    // separate webviews, and sharing "what was already rendered" makes the second
    // panel treat content as already sent and drop the whole thing.
    private _turnHadText = false;
    /** Whether anything was rendered this turn (text/thinking/tool/error), for end-of-turn diagnostics */
    private _turnRenderedAny = false;
    /** Text already sent for the current assistant message (for message_end reconciliation) */
    private _msgText = '';
    /** Thinking already sent for the current assistant message (for message_end reconciliation) */
    private _msgThinking = '';
    /** Text already sent for the current text block (for text_end reconciliation) */
    private _blockText = '';
    /** Thinking already sent for the current thinking block (for thinking_end reconciliation) */
    private _blockThinking = '';
    /** toolCallIds rendered as cards this turn */
    private readonly _renderedToolIds = new Set<string>();
    /**
     * Tool calls seen in this turn's messages (id -> call info).
     * message_end always precedes tool_execution_start, so we only record here and
     * do not render immediately; at turn end we add the ones that were never
     * rendered, avoiding duplicate cards.
     */
    private readonly _pendingToolCalls = new Map<string, { name: string; arguments?: unknown }>();

    /** This turn's change tracking (session-level so panels on one session stay in sync) */
    private get _turnChanges(): TurnChange[] { return selectTurnChanges(this._runtime.state); }
    private set _turnChanges(v: TurnChange[]) { this._patch({ turnChanges: v }); }

    /** Set when clear() runs while disconnected: create a session once connected */
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
        // Each surface slot gets its own runtime by default (own session, run in parallel), never mirrored.
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

        // Subscribe to the bound session runtime's events; unsubscribe on rebind / dispose
        this._subscribeRuntime(this._runtime);
    }

    /** Subscribe to a runtime's events (unsubscribing the old one first) and register this panel with it */
    private _subscribeRuntime(runtime: ChatRuntime): void {
        this._runtimeUnsub?.();
        this._runtime = runtime;
        runtime.panels.add(this);
        this._runtimeUnsub = runtime.clientManager.onEvent((event: PiAgentEvent) => this._onAgentEvent(event));
    }

    /**
     * Move this panel to another session runtime ("new chat" / switching sessions).
     * A previous runtime with no panels left is released (its pi process stopped).
     */
    private _bindRuntime(runtime: ChatRuntime): void {
        if (this._runtime === runtime) { return; }
        const previous = this._runtime;
        previous.panels.delete(this);
        // The old busy timeout belongs to the previous session and must be cleared on rebind
        this._clearBusyTimeout();
        this._resetRenderLedger();
        // After rebinding, the previous session's "retry" message must not carry over
        this._lastUserMessage = undefined;
        // …nor the fact that the previous session's turn was stopped: a failure in the
        // new session is a failure.
        this._stopRequested = false;
        this._subscribeRuntime(runtime);
        void ChatPanel._registry.release(previous);
    }

    /** Reset this panel's render ledger (on runtime switch / clear, so new content isn't treated as already sent) */
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
                // The connection is triggered by the webview's ready message, making sure
                // its message listeners are ready so models/sessions messages aren't dropped
                // by the deferred ESM execution.
            },
        });
        context.subscriptions.push(
            // Sidebar (left) and secondary side bar (right) are independent: own session each, run in parallel
            vscode.window.registerWebviewViewProvider(ChatPanel.viewType, makeProvider(ChatPanel.viewType)),
            vscode.window.registerWebviewViewProvider(ChatPanel.secondaryViewType, makeProvider(ChatPanel.secondaryViewType))
        );
    }

    /** Open the chat view in the secondary side bar (right) */
    public static async openInSecondarySideBar(): Promise<void> {
        await vs.executeCommand(`${ChatPanel.secondaryViewType}.focus`);
    }

    /** Open the chat in an editor tab (the editor panel is its own surface slot) */
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

    /** Stop every runtime's pi client (called on deactivate) */
    public static async stopSharedClient(): Promise<void> {
        await ChatPanel._registry.stopAll();
    }

    /**
     * Restart every session runtime's pi client (after permission mode /
     * executable changes) so each bound session reconnects and picks it up.
     *
     * Settings are global, so all runtimes are affected — but no running turn is
     * killed silently: each one is aborted first so its entries reach the session
     * file, and every panel is told the turn ended.
     */
    public static async restartAllClients(): Promise<void> {
        for (const runtime of ChatPanel._registry.all()) {
            if (selectBusy(runtime.state)) { await runtime.abortForRestart(); }
            await runtime.clientManager.stop().catch((err) => logError(`restart stop failed: ${(err as Error).message}`));
        }
        for (const panel of ChatPanel._instances) {
            panel._contextWarned = false;
            panel._busy = false;
            panel._post({ type: 'setBusy', busy: false });
            await panel._ensureClient().catch((err) => logError(`restart reconnect failed: ${(err as Error).message}`));
        }
    }

    /** Test-only: reset the runtime registry so state doesn't leak between cases */
    public static resetRuntimesForTest(): void {
        ChatPanel._registry = new ChatRuntimeRegistry();
    }

    /** Create a panel from a given webview (tests / custom hosts) */
    public static create(webview: vscode.Webview, extensionPath: string, disposeEvent: vscode.Event<void>, surfaceKey = 'default'): ChatPanel {
        return new ChatPanel(webview, extensionPath, disposeEvent, surfaceKey);
    }

    public static async ensureView(): Promise<ChatPanel> {
        await vs.executeCommand(`${ChatPanel.viewType}.focus`);
        // Wait up to ~5s: webview creation can take over 2s on slow or loaded machines
        for (let i = 0; i < 100; i++) {
            if (ChatPanel.currentView) { return ChatPanel.currentView; }
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        throw new Error(vscode.l10n.t('Pi chat view could not be created within 5 seconds. Please check if the extension is properly activated and try again.'));
    }

    public async clear(): Promise<void> {
        // Let the abort settle before switching sessions, otherwise pi may reject a new session while streaming
        await this._abortIfBusy();
        this._busy = false;
        this._turnHadText = false;
        // Keep the active-editor auto attachment (it still represents the current file) and clear only manual ones
        this._contexts = this._contexts.filter((c) => c.auto);
        this._contextWarned = false;
        this._runtime.firstUserMessage = undefined;
        this._resetTurnChanges();
        // The new session is empty by definition: no boot state, the empty state
        // can be shown straight away — in every panel of this session
        this._broadcastClearTranscript(false);
        this._broadcastBusy(false);
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
            // When disconnected, mark a pending session; _ensureClient creates it on connect
            this._pendingNewSession = true;
            this._post({ type: 'notice', text: vscode.l10n.t('Not connected; will create a new session when Pi connects') });
        }
    }

    /**
     * Reload this session: replace the pi process and rebuild the transcript from
     * the session file. Only this session is affected — every runtime owns its own
     * pi process, so other sessions (running or not) are untouched.
     *
     * Returns false when the user cancels at the confirmation.
     */
    public async restartClient(): Promise<boolean> {
        // Replacing the process mid-turn throws the turn away (including anything
        // not yet written to the session file), so never do that by accident. The
        // button stays usable while busy though: reloading is the escape hatch
        // when pi is wedged.
        if (this._busy) {
            const stopAndReload = vscode.l10n.t('Stop and reload');
            const choice = await vs.showWarningMessage(
                vscode.l10n.t('Pi is working. Reloading stops the current turn; everything already saved to the session file is kept.'),
                { modal: true },
                stopAndReload,
            );
            if (choice !== stopAndReload) { return false; }
            await this._runtime.abortForRestart();
        }
        await this._clientManager.stop();
        this._busy = false;
        this._turnHadText = false;
        this._contexts = this._contexts.filter((c) => c.auto);
        this._resetTurnChanges();
        this._broadcastClearTranscript();
        this._broadcastBusy(false);
        this._postContexts();
        await this._ensureClient();
        await this._replayPendingPanels();
        return true;
    }

    // ---------- Editor context ----------

    /** Attach the active editor: the selection if there is one, otherwise the whole file */
    /**
     * Guard shared by the three attach commands. A context item is a *path
     * reference* — pi reads it from disk — so non-file editors (untitled
     * buffers, diff views, output panels) cannot be attached at all; silently
     * turning their uri into a path only produced references nothing can read.
     */
    private _attachableEditor(): vscode.TextEditor | undefined {
        const editor = vs.activeTextEditor;
        if (!editor) {
            this._post({ type: 'notice', text: vscode.l10n.t('No active editor') });
            return undefined;
        }
        if (editor.document.uri.scheme !== 'file') {
            this._post({ type: 'notice', text: vscode.l10n.t('Only file editors can be attached') });
            return undefined;
        }
        return editor;
    }

    public attachActive(): void {
        const editor = this._attachableEditor();
        if (!editor) { return; }
        if (!editor.selection.isEmpty) { this._addSelectionContext(editor); }
        else { this._addFileContext(editor); }
    }

    public attachFile(): void {
        const editor = this._attachableEditor();
        if (!editor) { return; }
        this._addFileContext(editor);
    }

    public attachSelection(): void {
        const editor = this._attachableEditor();
        if (!editor) { return; }
        if (editor.selection.isEmpty) { this._post({ type: 'notice', text: vscode.l10n.t('Please select some code first') }); return; }
        this._addSelectionContext(editor);
    }

    /** Pick files/folders from the workspace and attach them (the menu's "Files & folders...") */
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

    /** Attach the picked Uri as a path reference (relative inside the workspace) */
    private _addUriContext(uri: vscode.Uri): void {
        this._addContext({ type: 'file', path: this._displayPath(uri) });
    }

    /** Build and send the "add context" popover data */
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

    /** Path display: relative inside the workspace, absolute otherwise */
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
        // Record only the reference (path + line range), not the selection text; pi reads the current content itself
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
        // After removing the auto attachment, that document is not auto-added again in this session (until the document changes)
        if (target?.auto) { this._runtime.autoContextDismissedDoc = target.path; }
        this._contexts = this._contexts.filter((c) => c.id !== id);
        this._postContexts();
        // When a manual entry is removed, restore the auto attachment if the active file has no chip
        if (target && !target.auto) { ChatPanel.syncAutoContext(); }
    }

    private _postContexts(): void {
        ChatPanel.broadcastContexts(this._runtime);
    }

    /** Broadcast a runtime's contexts to every panel bound to it (same-session chips stay in sync) */
    public static broadcastContexts(runtime: ChatRuntime): void {
        const contexts = runtime.state.contexts.map((c) => ({
            id: c.id, type: c.type, path: c.path, lineRange: c.lineRange, auto: c.auto,
        }));
        for (const panel of runtime.panels) {
            panel._post({ type: 'contexts', contexts });
        }
    }

    /** The reference for an editor: the selection if there is one, otherwise the whole file */
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
     * Sync the "active editor" auto attachment (on by default, like Claude Code):
     * - with an active file-scheme editor, attach the selection/file as a composer chip;
     * - with no active editor, keep the existing attachment (focus may be on the chat
     *   webview) and only remove it once the file is closed;
     * - after the user removes it, that document is not auto-added again until it changes;
     * - the auto attachment uses a reserved id and never overrides a user's manual one.
     */
    public static syncAutoContext(): void {
        const enabled = vs.getConfiguration('pi-agent').get<boolean>('context.autoAttachActiveEditor', true);
        const editor = enabled ? vs.activeTextEditor : undefined;
        const ref = (editor && editor.document.uri.scheme === 'file')
            ? ChatPanel._editorRefFor(editor)
            : undefined;
        // The "is the file still open" set is only needed when there is no active editor
        const openPaths = ref ? undefined : new Set(vs.openEditorUris().map((u) => vs.asRelativePath(u)));
        for (const runtime of ChatPanel._registry.all()) {
            ChatPanel._syncRuntimeAutoContext(runtime, enabled, ref, openPaths);
        }
    }

    /** Sync the auto attachment for one runtime's contexts (each session / composer keeps its own) */
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
            // No active editor: keep the auto attachment unless auto-attach is off or its file is no longer open.
            if (autoItem) {
                const stillOpen = enabled && Boolean(openPaths?.has(autoItem.path));
                if (!stillOpen) { setContexts(withoutAuto); }
            }
            return;
        }

        // Auto-attach resumes after switching documents: a dismissal only applies to that document
        if (runtime.autoContextDismissedDoc && runtime.autoContextDismissedDoc !== ref.path) {
            runtime.autoContextDismissedDoc = undefined;
        }
        if (runtime.autoContextDismissedDoc === ref.path) {
            if (autoItem) { setContexts(withoutAuto); }
            return;
        }

        const refKey = `${ref.type}:${ref.path}:${ref.lineRange || ''}`;
        // The user already attached the same reference: don't duplicate, and drop any auto entry
        const dup = withoutAuto.some((c) => `${c.type}:${c.path}:${c.lineRange || ''}` === refKey);
        if (dup) {
            if (autoItem) { setContexts(withoutAuto); }
            return;
        }

        const autoKey = autoItem ? `${autoItem.type}:${autoItem.path}:${autoItem.lineRange || ''}` : undefined;
        if (refKey === autoKey) { return; } // no change

        setContexts([...withoutAuto, { ...ref, id: AUTO_CONTEXT_ID, auto: true }]);
    }

    /** Prefix the prompt with the attached contexts as references (path / line range only; pi reads the content) */
    private _withContext(text: string, extraBlocks: string[] = []): string {
        // A slash command must start the message, so no context block may precede it
        if (text.startsWith('/')) { return text; }
        return buildContextBlock(this._contexts, text, extraBlocks);
    }

    /** Build the auto-context blocks from settings (editor / diagnostics / Git) */
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
        // Keep the auto attachment (it still represents the active editor) and clear only manual references
        const manual = this._contexts.filter((c) => !c.auto);
        if (manual.length) {
            this._contexts = this._contexts.filter((c) => c.auto);
            this._postContexts();
        }
    }

    public async askQuestion(question: string) {
        await this._handleUserMessage(question);
    }

    // ---------- Command entry points (called by VS Code commands) ----------

    public async newSession(): Promise<void> { await this._handleNewSession(); }
    public focusInput(): void { this._post({ type: 'focusInput' }); }
    public editLastMessage(): void { this._post({ type: 'editLast' }); }
    public async revertLastTurn(): Promise<void> { await this._revertTurn(); }

    /** Clone the current session branch into a new session */
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
            this._broadcastClearTranscript();
            this._busy = false;
            this._turnHadText = false;
            this._runtime.firstUserMessage = undefined;
            this._resetTurnChanges();
            this._broadcastBusy(false);
            await this._restoreHistory(client);
            await this._replayPendingPanels();
            this._postSessionList();
            this._post({ type: 'notice', text: vscode.l10n.t('Session cloned') });
        } catch (err) {
            this._post({ type: 'notice', text: vscode.l10n.t('Clone failed: {0}', (err as Error).message) });
        }
    }

    /** After the first turn, optionally name the session with a one-shot generation (per session) */
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
        const client = this._clientManager.client;
        if (!client || typeof client.setSessionName !== 'function') { return; }
        // Only burn the attempt once we know this can actually succeed: marking
        // it tried while the client was momentarily missing would leave the
        // session unnamed forever
        runtime.autoNameTried.add(id);
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
            if (res && res.model) {
                const model = res.model;
                if (model.provider && model.id) { rememberModel(model.provider, model.id); }
                this._post({ type: 'notice', text: vscode.l10n.t('Model switched: {0}', model.id || '') });
            }
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
        // Compaction is destructive and irreversible, but is triggered from explicit
        // entry points (usage ring / command / command palette), so there is no second
        // confirmation; a per-runtime in-flight flag prevents duplicate triggers.
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

    // ---------- Git integration ----------

    /** Generate a commit message from the current changes and write it into the SCM input box */
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

    /** Generate a PR description from the current branch's commits and open it as a temporary Markdown document */
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

    // ---------- This turn's change review / revert ----------

    /** Drop this turn's change tracking (after clear / new / switch, old-session files must not be reverted) */
    private _resetTurnChanges(): void {
        this._turnChanges = [];
        this._pendingTrack.clear();
        this._runtime.revertSnapshot.clear();
        this._postRuntime({ type: 'turnChanges', turnFiles: [] });
    }

    /** Record edit/write targets at tool_execution_start (without reading the file, to avoid a half-written state) */
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
            // First touch: snapshot the original file content (for the diff / revert)
            if (!prev) {
                try { before = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : undefined; } catch { before = undefined; }
            }
            if (typeof args?.content === 'string') { written = args.content; }
        } else if (edits) {
            edits = edits.concat(parseEdits(args));
        }
        const entry: TurnChange = { rel, existed, edits, before, written };
        // Remember the state before this call so a failing tool rolls back this record
        if (event.toolCallId) {
            this._pendingTrack.set(event.toolCallId, { rel, prev });
        }
        if (idx >= 0) { list[idx] = entry; } else { list.push(entry); }
        this._turnChanges = list;
    }

    /** Tool end: confirm the record on success, roll back this call's change record on failure */
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

    /** Per-file results of reverting this turn's changes */
    private static readonly TURN_REVERT_RESULT_LIVE_MS = 4500; // auto-hide delay after full success

    /** Revert the given files (all when omitted) and return per-file results */
    private async _doRevert(changes: TurnChange[]): Promise<Array<{ path: string; result: 'reverted' | 'deleted' | 'failed' | 'skipped'; error?: string }>> {
        const results: Array<{ path: string; result: 'reverted' | 'deleted' | 'failed' | 'skipped'; error?: string }> = [];
        const root = vs.workspaceFolders?.[0]?.uri.fsPath || process.cwd();

        for (const change of changes) {
            const abs = path.isAbsolute(change.rel) ? change.rel : path.join(root, change.rel);
            try {
                // Snapshot the current (post-turn) state before reverting, for undoing the revert
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
                    const outcome = revertEditsDetailed(current, change.edits);
                    if (!outcome.ok) {
                        // "changed since" and "cannot be determined" are different
                        // problems: the first is pi's history, the second is a file
                        // whose edited text now occurs in several places
                        const error = outcome.reason === 'ambiguous'
                            ? vscode.l10n.t('The replaced text now occurs in several places; revert this file by hand')
                            : vscode.l10n.t('Content changed since the turn; the edit no longer matches');
                        results.push({ path: change.rel, result: 'failed', error });
                        logError(`revert ${abs}: ${outcome.reason}`);
                        continue;
                    }
                    await vs.fs.writeFile(uri, Buffer.from(outcome.content, 'utf8'));
                    this._runtime.revertSnapshot.set(change.rel, snapshot);
                    results.push({ path: change.rel, result: 'reverted' });
                } else if (change.before !== undefined) {
                    // write: restore the whole file from the snapshot
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

    /** Build the inline card data (keep unreverted files, mark reverted / failed ones) */
    private _turnChangeFiles(): Array<{ path: string; status: 'created' | 'modified'; revertible: boolean; state: 'pending' | 'reverted' | 'deleted' | 'failed' | 'skipped'; diff?: string }> {
        return this._turnChanges.map((v) => ({
            path: v.rel,
            status: v.existed ? 'modified' : 'created',
            revertible: isRevertible(v),
            state: 'pending',
            diff: this._diffFor(v),
        }));
    }

    /** This turn's diff for a file: edit is rebuilt from the args, write diffs "snapshot -> written content"; cached after one computation. */
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
     * Restore this turn's changed files to their pre-turn state. No modal
     * confirmation; results are reported per file and shown in place on the card by
     * the webview (check on success, red plus a reason on failure).
     * @param onlyRel revert only this file; omit to revert everything
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
            // Single-file revert: drop this file from the pending list, keep the rest
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

    /** Undo the revert: restore what was just reverted, so mistakes are not scary */
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
                    // The file did not exist before the revert (created this turn), so restoring means deleting
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

    private async _openWorkspaceFile(target: string): Promise<void> {
        // Truncated tool output lives outside the workspace (absolute path),
        // while turn-change rows are workspace-relative. Joining an absolute
        // path onto the root produced a file that can never exist.
        const root = vs.workspaceFolders?.[0]?.uri;
        const uri = path.isAbsolute(target)
            ? vs.uri.file(target)
            : (root ? vs.uri.joinPath(root, target) : undefined);
        if (!uri) { return; }
        try {
            const doc = await vs.openTextDocument(uri);
            await vs.showTextDocument(doc, { preview: true });
        } catch (err) {
            this._post({ type: 'notice', text: vscode.l10n.t('Cannot open {0}: {1}', target, (err as Error).message) });
        }
    }

    // ---------- Webview message handling ----------

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
                this._stopRequested = true;
                await this._clientManager.abort();
                // The Stop button must arm the same recovery fallback as the
                // programmatic stops: if agent_settled never arrives (a wedged
                // pi), the UI would otherwise stay locked with no way out
                if (this._busy) { this._armAbortRecovery(); }
                // After stopping, drop pending steer / follow-up so they don't unexpectedly continue
                await this._clearQueue();
                // Clear the queue/steer badges in every panel of this session
                // (not relying on pi re-sending queue_update)
                for (const panel of this._runtime.panels) { panel._post({ type: 'queue', steering: [], followUp: [] }); }
                break;
            case 'errorAction':
                // Error-bubble buttons ("switch model" is handled locally in the webview)
                if (message.action === 'retry') {
                    const last = this._lastUserMessage;
                    if (last) { await this._handleUserMessage(last.text, undefined, last.images); }
                } else if (message.action === 'logs') {
                    showLogs();
                } else if (message.action === 'connect') {
                    await this._connectProvider();
                } else if (message.action === 'login') {
                    const term = vscode.window.createTerminal(vscode.l10n.t('Pi login'));
                    term.show();
                    term.sendText('pi');
                    void vs.showInformationMessage(vscode.l10n.t('In pi, type /login to sign in with OAuth'));
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
            case 'refreshSessions': {
                // Re-read the session directory: another pi process (a terminal, a
                // second window) may have created, renamed or appended sessions.
                const client = this._clientManager.client;
                if (client && this._clientManager.isConnected) {
                    await this._sessionManager.loadSessions(client);
                    this._postSessionList();
                }
                break;
            }
            case 'renameSession':
                if (message.sessionId) { await this._handleRenameSession(message.sessionId, message.currentName); }
                break;
            case 'ready':
                // A new panel may reuse shared state: sync the auto attachment and echo context chips to the webview first
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
                    // Build the reference from the menu's path + range, independent of the active editor
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
            case 'copyText':
                // Ctrl/Cmd+C on a transcript selection: the webview's native copy
                // never reaches the document, so the shortcut is served by the same
                // clipboard path the copy buttons use. No toast — a keyboard copy
                // that silently works is the expected behavior.
                if (message.text) {
                    try { await vs.clipboard.writeText(message.text); }
                    catch (err) { logError(`copy failed: ${(err as Error).message}`); }
                }
                break;
            case 'openLink':
                if (message.href) {
                    // Only allow common safe schemes; never hand command:/vscode:/ms-* to the OS
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

    // ---------- Pi client management ----------

    private async _ensureClient(): Promise<void> {
        this._patch({ connecting: true, connected: false });
        this._post({ type: 'connecting' });
        this._postSetupStatus();
        // If a turn is streaming (e.g. the user sent a message before the editor
        // panel's ready arrived), do not clear the webview or the rendering is wiped.
        // A replay into content that is already there would duplicate it, so the
        // clear and the replay always go together.
        if (this._webviewSynced) {
            logInfo('_ensureClient: keeping the existing transcript');
        } else {
            // Clear so the replayed history isn't appended to anything
            this._clearTranscript();
        }
        try {
            const client = await this._clientManager.ensureConnected(this._extensionPath, this._runtime.startOptions);

            // Reconcile busy from pi's real state (the panel may reopen mid-run)
            try {
                const st = await client.getState();
                this._runtime.sessionId = st.sessionId;
                // Record the session file: reuse the same session after a client restart instead of starting a new one
                if (st.sessionFile) {
                    this._runtime.sessionFile = st.sessionFile;
                    this._runtime.startOptions = { sessionFile: st.sessionFile };
                }
                this._broadcastBusy(Boolean(st.isStreaming));
            } catch (err) { logError(`reconcile busy failed: ${(err as Error).message}`); }

            // If clear() ran while disconnected, create a new session on connect
            if (this._pendingNewSession) {
                this._pendingNewSession = false;
                try {
                    const ok = await this._sessionManager.createNewSession(client);
                    if (ok) { this._postSessionList(); }
                } catch (err) {
                    logError(`pending new session failed: ${(err as Error).message}`);
                }
            }

            // Restore history (into the webview we just cleared)
            if (!this._webviewSynced) { await this._restoreHistory(client); }

            // Announce a successful connection
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

            // Load models and slash commands
            await this._loadModels(client);
            await this._applyPreferredModel(client);
            await this._loadCommands(client);
            await this._loadStats(client);

            // Load the session list
            await this._sessionManager.loadSessions(client);
            this._postSessionList();
            this._piMissing = false;
            this._patch({ connected: true, connecting: false });
            this._postSetupStatus();
            // Check the current provider's credentials asynchronously (posts a more accurate setup status)
            void this._refreshAuthStatus();
        } catch (err) {
            // A restart that landed while this connect was in flight is not this
            // panel's failure: the panel that restarted reconnects and posts the real
            // state, so reporting "start was cancelled" as an error bubble (and
            // flashing "no models") would only be noise.
            if (err instanceof PiStartError && err.cancelled) {
                logInfo('connect superseded by a restart; the newer connect owns the state');
                return;
            }
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

    /**
     * Replay the current session's transcript into a webview that was just cleared.
     *
     * Prefers pi's own session log (`get_entries`) over `get_messages()`: the
     * latter returns the *model context*, so everything before the last
     * compaction is already gone and no tool call, tool result, diff or thinking
     * block is in it. Replaying the log keeps a reloaded panel looking like the
     * one that was streamed.
     */
    private async _restoreHistory(client: PiRpcClient): Promise<void> {
        // The transcript this replay belongs to (see _transcriptEpoch)
        const epoch = this._transcriptEpoch;
        // Still ours to fill: not wiped since the read started, and nothing live
        // arrived in the meantime
        const stillPending = (): boolean => epoch === this._transcriptEpoch && !this._webviewSynced;
        try {
            const items = await this._historyItems(client);
            if (!stillPending()) {
                // Either the user sent into the still-loading panel / a turn started,
                // or a clear replaced the transcript mid-read: appending history below
                // live content, or into a *new* session's view, would scramble it —
                // drop this replay instead of interleaving. The full history stays in
                // the session file and arrives on the next reload.
                logInfo('history replay dropped: the transcript changed while the log was loading');
                return;
            }
            const capped = this._capHistory(items);
            // Posted even when empty: the webview treats this as the authoritative
            // transcript state, and needs it to leave its boot state.
            this._post({ type: 'history', items: capped.items, hidden: capped.hidden });
        } catch (err) {
            logError(`_restoreHistory failed: ${(err as Error).message}`);
            // Still settle the webview: without a `history` it would keep showing the
            // bare boot state (logo and title only, no quick actions) for the rest of
            // the session. Only while this replay is still the panel's current one —
            // a newer load settles the new transcript itself.
            if (stillPending()) { this._post({ type: 'history', items: [], hidden: 0 }); }
        } finally {
            // Either way the webview now reflects this runtime, so a later
            // reconnect must not replay on top of it — but never re-mark a
            // transcript that was replaced under this one.
            if (epoch === this._transcriptEpoch) { this._webviewSynced = true; }
        }
    }

    /** Build the transcript to replay, preferring pi's full session log */
    private async _historyItems(client: PiRpcClient): Promise<HistoryItem[]> {
        const getEntries = client.getEntries;
        if (typeof getEntries !== 'function') {
            logInfo('get_entries is unavailable (older pi build): replaying get_messages instead');
            return this._historyFromMessages(client);
        }
        let entries: PiSessionEntry[] | undefined;
        let leafId: string | undefined;
        try {
            ({ entries, leafId } = await getEntries.call(client));
        } catch (err) {
            // Never leave the panel empty just because the log could not be read
            logError(`get_entries failed, falling back to get_messages: ${(err as Error).message}`);
            return this._historyFromMessages(client);
        }
        if (!Array.isArray(entries) || !entries.length) { return this._historyFromMessages(client); }
        const items: HistoryItem[] = [];
        for (const entry of this._branchEntries(entries, leafId)) {
            if (entry.type === 'compaction') {
                // Keep the checkpoint visible instead of silently dropping the summarized range
                items.push({ kind: 'compaction', text: entry.summary, timestamp: entry.timestamp });
                continue;
            }
            if (entry.type !== 'message' || !entry.message) { continue; }
            const m = entry.message;

            if (m.role === 'user') {
                const text = extractMessageText(m) || '';
                const images = extractMessageImages(m);
                if (!text && !images.length) { continue; }
                // History user messages carry a context block: strip it for display and echo the refs instead
                const refs = text ? parseContextRefs(text) : [];
                items.push({
                    kind: 'user',
                    timestamp: entry.timestamp,
                    text: text ? stripContextBlock(text) : '',
                    images: images.length ? images : undefined,
                    attachments: refs.length ? refs.map((r) => ({ type: r.type, path: r.path, lineRange: r.lineRange })) : undefined,
                });
                continue;
            }

            if (m.role === 'assistant') {
                if (!Array.isArray(m.content)) { continue; }
                for (const raw of m.content) {
                    const block = raw as { type?: string; text?: string; thinking?: string; id?: string; name?: string; arguments?: unknown };
                    if (block.type === 'thinking' && typeof block.thinking === 'string' && block.thinking.trim()) {
                        items.push({ kind: 'thinking', text: block.thinking, timestamp: entry.timestamp });
                    } else if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
                        items.push({ kind: 'assistant', text: block.text, timestamp: entry.timestamp });
                    } else if (block.type === 'toolCall') {
                        items.push({
                            kind: 'tool',
                            timestamp: entry.timestamp,
                            tool: block.name ?? 'tool',
                            toolCallId: block.id,
                            detail: summarizeToolArgs(block.arguments) || undefined,
                            args: formatToolArgs(block.arguments) || undefined,
                        });
                    }
                }
                continue;
            }

            if (m.role === 'toolResult') {
                items.push({
                    kind: 'toolResult',
                    timestamp: entry.timestamp,
                    toolCallId: m.toolCallId,
                    tool: m.toolName,
                    isError: Boolean(m.isError),
                    durationMs: m.durationMs,
                    diff: m.details?.diff,
                    output: extractToolOutput({ content: m.content as PiToolResultBlock[] | string | undefined, details: m.details }) || undefined,
                    truncated: Boolean(m.details?.truncation?.truncated),
                    fullOutputPath: m.details?.fullOutputPath,
                });
            }
        }
        return items;
    }

    /**
     * The current branch: follow `parentId` from the leaf back to the root.
     * Entries form a tree (fork / clone / context edits), so replaying the raw
     * file order would also show branches the user has since left.
     */
    private _branchEntries(entries: PiSessionEntry[], leafId?: string): PiSessionEntry[] {
        const byId = new Map<string, PiSessionEntry>();
        for (const e of entries) { if (e.id) { byId.set(e.id, e); } }
        let cursor: PiSessionEntry | undefined = (leafId ? byId.get(leafId) : undefined) ?? entries[entries.length - 1];
        const path: PiSessionEntry[] = [];
        const seen = new Set<string>();
        while (cursor) {
            if (cursor.id) {
                if (seen.has(cursor.id)) { break; }   // corrupt / cyclic log: stop instead of looping forever
                seen.add(cursor.id);
            }
            path.push(cursor);
            cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
        }
        return path.reverse();
    }

    /** Fallback for pi builds without `get_entries` (text bubbles only) */
    private async _historyFromMessages(client: PiRpcClient): Promise<HistoryItem[]> {
        const messages = await client.getMessages();
        const items: HistoryItem[] = [];
        for (const m of messages) {
            const text = extractMessageText(m);
            const images = extractMessageImages(m);
            if (!text && !images.length) { continue; }
            const refs = text ? parseContextRefs(text) : [];
            items.push({
                kind: m.role === 'user' ? 'user' : 'assistant',
                text: text ? stripContextBlock(text) : '',
                images: images.length ? images : undefined,
                attachments: refs.length ? refs.map((r) => ({ type: r.type, path: r.path, lineRange: r.lineRange })) : undefined,
            });
        }
        return items;
    }

    /**
     * Bound a replay, cutting at a turn boundary so a tool result never loses
     * the tool call it belongs to (which would leave a card spinning forever).
     */
    private _capHistory(items: HistoryItem[]): { items: HistoryItem[]; hidden: number } {
        if (items.length <= HISTORY_MAX_ITEMS) { return { items, hidden: 0 }; }
        let start = items.length - HISTORY_MAX_ITEMS;
        while (start < items.length && items[start].kind !== 'user') { start++; }
        if (start >= items.length) { start = items.length - HISTORY_MAX_ITEMS; }
        return { items: items.slice(start), hidden: start };
    }

    /** Session stats (cumulative tokens + context usage) -> header indicator */
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

    /** Warn to compact when context is nearly full (85% threshold, reset below 75%) */
    private _maybeWarnContext(percent: number | null | undefined): void {
        const threshold = 85;
        if (percent === null || percent === undefined) { return; }
        // Host-level popup: once per session, not once per panel of it
        if (!this._isEventOwner) { return; }
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

    /** Load pi's slash commands / prompt templates / skills for composer completion */
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
            // Keep the model picker from being stuck on "Connecting..." forever
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
        this._postRuntime({
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
            // The config watcher restarts the session so the permission mode takes effect
            this._post({ type: 'permission', permissionMode: mode });
            this._post({ type: 'notice', text: vscode.l10n.t('Permission mode: {0} (reloading session…)', permissionLabel(mode)) });
        } catch (err) {
            this._post({ type: 'notice', text: vscode.l10n.t('Failed to set permission mode: {0}', (err as Error).message) });
        }
    }

    /** Handle an extension_ui_request from pi (confirm / select / input) */
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
                // Other requests awaiting a response get cancelled so pi doesn't hang
                this._respondUI(client, req.id, { cancelled: true });
                break;
        }
    }

    /** Reply to an extension_ui_request; log a stdin write failure so pi doesn't wait silently */
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

    /**
     * Make a brand-new session use the model the user picked in the composer.
     *
     * pi's `set_model` is session-scoped, and a new session starts on the first
     * entry of the model list, so without this the composer would announce one
     * model while the session answered with another.
     *
     * Sessions that already ran are left alone: pi restores their model from the
     * session log, and overriding it would silently rewrite what that
     * conversation actually used. A fresh session is recognisable without asking
     * pi anything — the session file only appears once the first entry is
     * written, so its absence means nothing has run yet.
     */
    private async _applyPreferredModel(client: PiRpcClient): Promise<void> {
        const file = this._runtime.sessionFile;
        if (file && fs.existsSync(file)) { return; }
        const preferred = preferredModel();
        if (!preferred) { return; }
        try {
            const state = await client.getState();
            if (state.model?.provider === preferred.provider && state.model?.id === preferred.id) { return; }
            // The remembered model may not exist here (another workspace's provider set)
            const available = await client.getAvailableModels();
            if (!available.some((m) => m.provider === preferred.provider && m.id === preferred.id)) { return; }
            logInfo(`new session: applying the preferred model ${preferred.provider}/${preferred.id}`);
            await client.setModel(preferred.provider, preferred.id);
            await this._loadModels(client);
        } catch (err) {
            // Not worth interrupting the session over: the composer keeps showing
            // whatever the session actually uses
            logError(`applying the preferred model failed: ${(err as Error).message}`);
        }
    }

    private async _handleSetModel(provider: string, modelId: string): Promise<void> {
        try {
            const client = this._clientManager.client;
            if (!client) { return; }
            await client.setModel(provider, modelId);
            rememberModel(provider, modelId);
            this._post({ type: 'notice', text: vscode.l10n.t('Model switched: {0}', modelId) });
            await this._loadModels(client);
        } catch (err) {
            this._post({ type: 'notice', text: vscode.l10n.t('Failed to switch model: {0}', (err as Error).message) });
        }
    }

    // ---------- Session management ----------

    /** Abort recovery timeout: force-unlock when agent_settled never arrives */
    private static readonly ABORT_RECOVERY_MS = 30 * 1000; // 30 seconds

    /** Abort the running turn first (before switch / new / clone, so streaming doesn't continue in the background) */
    private async _abortIfBusy(): Promise<void> {
        if (!this._busy) { return; }
        this._stopRequested = true;
        await this._clientManager.abort().catch((err) => { logError(`abort failed: ${(err as Error).message}`); });
        // busy is cleared by the agent_settled event after an abort; the recovery timeout is a fallback if it never arrives
        this._armAbortRecovery();
    }

    /** Fallback for a stop whose agent_settled never arrives (see `_abortIfBusy`) */
    /**
     * Abort-recovery fallback (see `_abortIfBusy`).
     *
     * There is deliberately no timeout on how long a turn may run: a long turn is
     * normal (a big refactor, a slow model, a build the agent is polling), and cutting
     * the UI loose while pi is still working lets the user send into a running turn.
     * Recovery is explicit instead — **Stop** aborts and force-unlocks after 30s, and
     * **Reload Session** replaces the process.
     */
    private _armAbortRecovery(): void {
        this._clearBusyTimeout();
        const timer = setTimeout(() => {
            this._runtime.abortRecovery = undefined;
            if (!this._busy) { return; }
            logError('Abort recovery timeout reached; force resetting busy state');
            this._busy = false;
            // busy is runtime-level: every panel of this session is still showing a
            // running turn and must be unlocked — not just the one that stopped it —
            // and each of them needs to know why its composer became writable again
            for (const panel of this._runtime.panels) {
                panel._post({ type: 'toolSettle' });
                panel._post({ type: 'setBusy', busy: false });
                panel._post({ type: 'notice', text: vscode.l10n.t('Pi turn was aborted and did not settle within {0} seconds; you can send a new message', ChatPanel.ABORT_RECOVERY_MS / 1000) });
            }
        }, ChatPanel.ABORT_RECOVERY_MS);
        this._runtime.abortRecovery = { cancel: () => clearTimeout(timer) };
    }

    /**
     * Abort the current turn only when this panel is the sole user of its runtime.
     * When the sidebar / secondary sidebar share a session, creating or switching
     * sessions in one must not interrupt the other's running turn.
     */
    private async _abortIfSole(): Promise<void> {
        if (this._runtime.panels.size <= 1) { await this._abortIfBusy(); }
    }

    private async _handleNewSession(): Promise<void> {
        // "New chat" = start a brand-new session runtime for this surface slot; other surfaces are unaffected.
        await this._abortIfSole();
        const runtime = ChatPanel._registry.create({ continueRecent: false });
        ChatPanel._registry.bindSurface(this._surfaceKey, runtime);
        this._bindRuntime(runtime);
        this._clearTranscript();
        this._busy = false;
        this._contextWarned = false;
        this._resetTurnChanges();
        this._post({ type: 'setBusy', busy: false });
        this._postContexts();
        await this._ensureClient();
        // _ensureClient loads the session list and fills in runtime.sessionId
    }

    private async _handleRenameSession(sessionId: string, currentName?: string): Promise<void> {
        // If another runtime holds this session, rename through that runtime so the
        // same session file is never opened by two pi processes at once.
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
        // Renaming a non-current session needs a switch first; abort if running, to avoid switching mid-turn
        if (sessionId !== owner.sessionManager.currentSessionId && owner.state.busy) {
            await owner.clientManager.abort().catch((err) => logError(`abort before rename failed: ${(err as Error).message}`));
        }
        const before = owner.sessionManager.currentSessionId;
        const ok = await owner.sessionManager.renameSession(client, sessionId, name);
        if (ok) {
            // If the owner's current session changed unexpectedly (switch-back error), reload history for its panels
            if (owner.sessionManager.currentSessionId !== before) {
                for (const panel of owner.panels) {
                    panel._clearTranscript();
                    panel._busy = false;
                    panel._clearBusyTimeout();
                    panel._resetTurnChanges();
                    panel._post({ type: 'setBusy', busy: false });
                    await panel._restoreHistory(client);
                }
            }
            // Refresh every runtime's session list (same session directory) and re-render
            for (const rt of ChatPanel._registry.all()) {
                const c = rt.clientManager.client;
                if (c) { await rt.sessionManager.loadSessions(c).catch(() => { /* ignore */ }); }
                for (const panel of rt.panels) { panel._postSessionList(); }
            }
            this._post({ type: 'notice', text: vscode.l10n.t('Session renamed') });
        } else {
            this._post({ type: 'notice', text: vscode.l10n.t('Rename failed. Please check the session file permissions and try again.') });
        }
    }

    private async _handleSwitchSession(sessionId: string): Promise<void> {
        // Session file: runtimes share one session directory, so the current panel's list is enough
        const session = this._sessionManager.sessions.find((s) => s.id === sessionId);
        if (!session || !session.file) {
            this._post({ type: 'notice', text: vscode.l10n.t('Failed to switch session. The session may no longer exist or the file may be corrupted.') });
            return;
        }
        // Already on the target session: nothing to do
        if (this._runtime.sessionId === sessionId) { return; }

        // When sharing a session, do not abort the other panel's turn
        await this._abortIfSole();

        // A runtime already runs this session -> switch to it (share and mirror with that panel)
        const existing = ChatPanel._registry.bySessionId(sessionId);
        if (existing) {
            ChatPanel._registry.bindSurface(this._surfaceKey, existing);
            this._bindRuntime(existing);
            this._clearTranscript();
            this._busy = existing.state.busy;
            this._post({ type: 'setBusy', busy: this._busy });
            this._postContexts();
            await this._ensureClient();
            this._post({ type: 'notice', text: vscode.l10n.t('Switched to session: {0}', sessionId) });
            return;
        }

        // Otherwise create a runtime for this session (opening the given session file)
        const runtime = ChatPanel._registry.create({ sessionFile: session.file });
        runtime.sessionId = sessionId;
        runtime.sessionFile = session.file;
        ChatPanel._registry.bindSurface(this._surfaceKey, runtime);
        this._bindRuntime(runtime);
        this._clearTranscript();
        this._busy = false;
        this._contextWarned = false;
        this._resetTurnChanges();
        this._post({ type: 'setBusy', busy: false });
        this._postContexts();
        await this._ensureClient();
        this._post({ type: 'notice', text: vscode.l10n.t('Switched to session: {0}', sessionId) });
    }

    // ---------- Event bridge (pi -> webview) ----------

    private _onAgentEvent(event: PiAgentEvent): void {
        if (this._disposed) {
            logInfo(`_onAgentEvent: skipped (disposed=${this._disposed}) type=${event.type}`);
            return;
        }
        if (event.type === 'extension_ui_request') {
            // pi asks exactly one question per request id; every panel of a shared
            // session receives the event, so only the owner shows the dialog (two
            // modals and two stdin responses would otherwise pile up on pi)
            if (this._isEventOwner) { void this._handleExtensionUI(event); }
            return;
        }
        // Diagnostics: log every non thinking/text event type to surface unknown events
        if (event.type !== 'agent_start' && event.type !== 'message_update'
            && event.type !== 'agent_settled' && event.type !== 'queue_update'
            && event.type !== 'auto_retry_start') {
            logInfo(`_onAgentEvent: type=${event.type}, tool=${event.toolName ?? '-'}`);
        }
        switch (event.type) {
            case 'agent_start':
                this._busy = true;
                this._turnHadText = false;
                // A new run: any earlier stop is history
                this._stopRequested = false;
                // This panel is rendering the turn from now on
                this._webviewSynced = true;
                this._resetTurnLedger();
                this._lastUsage = undefined;
                this._turnChanges = [];
                this._runtime.revertSnapshot.clear();   // A new turn starts, so the old undo-of-revert snapshot is stale
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
                    // Fallback: backfill from thinking_end's full content when deltas were lost, so thinking isn't dropped
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
                    // The pi SDK sometimes sends the full text (non-streaming) instead of text_delta chunks
                    this._blockText += ae.delta;
                    this._msgText += ae.delta;
                    this._postAssistantChunk(ae.delta);
                } else if (ae.type === 'text_end') {
                    // Fallback: backfill from text_end's full content when deltas were lost, so text isn't dropped
                    this._fillText(typeof ae.content === 'string' ? ae.content : '');
                    this._blockText = '';
                    if (this._turnHadText) {
                        this._turnHadText = false;
                        this._post({ type: 'assistantEnd' });
                    }
                } else {
                    // Unknown event type: log it for diagnostics
                    logInfo(`message_update: unrecognized assistantMessageEvent type: ${ae.type}`);
                }
                break;
            }

            case 'message_start': {
                // A new assistant message starts: reset the per-message ledger
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
                // pi's authoritative message: backfill anything not rendered and surface the failure reason
                const done = event.message;
                if (!done || typeof done === 'string') { break; }
                if (done.role === 'assistant') { this._completeAssistantMessage(done); }
                else if (done.role === 'toolResult') { this._completeToolResult(done); }
                break;
            }

            case 'tool_execution_start':
                if (event.toolCallId) { this._renderedToolIds.add(event.toolCallId); }
                // Note: do NOT reset _turnHadText here!
                // It tracks "was assistantStart sent this turn", which running a tool must
                // not affect. text_end relies on it to decide whether to send assistantEnd.
                // Resetting here makes text_end skip assistantEnd after a tool, leaving the
                // stream open forever.
                // Recording edits into the shared turn state must happen once per
                // event, not once per panel: duplicated edits make the revert fail
                if (this._isEventOwner) { this._trackToolTarget(event); }
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
                // A failed tool is not a turn change (roll back the record it wrote)
                if (this._isEventOwner) { this._settleToolTrack(event); }
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
                // The stop has settled; a failure from here on is a real one
                this._stopRequested = false;
                // Fallback: if text_end was missed (e.g. tool_execution_start once reset
                // _turnHadText by mistake), close the assistant stream so the webview's
                // streaming cursor never hangs forever.
                if (this._turnHadText) {
                    this._turnHadText = false;
                    this._post({ type: 'assistantEnd' });
                    logError('agent_settled: assistant stream was still open (text_end missed); forced assistantEnd');
                }
                this._turnHadText = false;
                this._post({ type: 'thinkingEnd' });
                // Fallback: render tool calls present in the message but never rendered (e.g. lost events)
                this._settlePendingToolCalls();
                // Fallback: close tool cards still "running" so nothing spins forever
                this._post({ type: 'toolSettle' });
                const u = this._lastUsage;
                if (u && (u.input || u.output)) {
                    this._post({ type: 'notice', text: vscode.l10n.t('Usage this turn: {0} tokens', formatUsage(u)) });
                } else if (!this._turnRenderedAny) {
                    // Diagnostic: nothing was rendered this turn at all (request failed / thinking with no output)
                    logError('agent_settled: nothing was rendered this turn (no text, thinking, tool or error)');
                }
                this._resetTurnLedger();
                this._post({ type: 'setBusy', busy: false });
                if (!event.aborted && this._isEventOwner) { this._notifySettled(); }
                this._postTurnChanges();
                void this._maybeAutoName();
                // Refresh stats regardless of abort, so they reflect the latest session state
                const settledClient = this._clientManager.client;
                if (settledClient) { void this._loadStats(settledClient); }
                break;
            }

            default:
                break;
        }
    }

    /** Send a chunk of assistant text, opening a bubble if needed so the webview never drops it */
    private _postAssistantChunk(text: string): void {
        if (!text) { return; }
        if (!this._turnHadText) {
            this._turnHadText = true;
            this._post({ type: 'assistantStart' });
        }
        this._turnRenderedAny = true;
        this._post({ type: 'assistantChunk', text });
    }

    /** Backfill the current text block from authoritative content (when deltas are missing); duplicating beats missing */
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

    /** Backfill the current thinking block from authoritative content (when deltas are missing) */
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
     * An assistant message ended: backfill text / thinking / tool calls / failure
     * reason from pi's authoritative message. This is the guarantee behind "the
     * extension only changes presentation, never the content".
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
            // Only record: tool_execution_start runs first; reconcile at turn end
            this._pendingToolCalls.set(tc.id, { name: tc.name, arguments: tc.arguments });
        }
        if (completion.error || completion.aborted) {
            this._turnRenderedAny = true;
            if (this._wasStopped(completion.aborted)) {
                // The user (or a session switch) stopped this turn: not a failure, so
                // show a neutral notice instead of an error bubble with retry / switch
                // model / logs. pi reports the abort as an error when it lands between
                // turns, which is why the requested stop is tracked as well.
                this._post({ type: 'notice', text: vscode.l10n.t('Stopped') });
            } else {
                logError(`pi turn failed: ${completion.error}`);
                this._postError(completion.error as string);
            }
        }
    }

    /** A tool-result message ended: backfill cards and results that were never rendered
     *  (resending is idempotent). Note: tool_execution_start always precedes the result,
     *  so building the card here never duplicates. */
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

    /** Turn end: render tool calls present in messages that were never rendered (nothing is dropped) */
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

    /** Turn end: clear the render ledger; the next turn reconciles fresh */
    private _resetTurnLedger(): void {
        this._msgText = '';
        this._msgThinking = '';
        this._blockText = '';
        this._blockThinking = '';
        this._renderedToolIds.clear();
        this._pendingToolCalls.clear();
        this._turnRenderedAny = false;
    }

    /** Show a notification when a turn finishes while the window is unfocused */
    private _notifySettled(): void {
        if (vs.windowFocused()) { return; }
        const enabled = vs.getConfiguration('pi-agent').get<boolean>('notifications.enabled', true);
        if (!enabled) { return; }
        void vs.showInformationMessage(vscode.l10n.t('Pi finished the current turn'));
    }

    /** Clear pending steer / follow-up messages */
    private async _clearQueue(): Promise<void> {
        const client = this._clientManager.client;
        if (!client || typeof client.clearQueue !== 'function') { return; }
        try { await client.clearQueue(); } catch (err) { logError(`clearQueue failed: ${(err as Error).message}`); }
    }

    /** Workspace file list (for `@` mention completion), cached for 30s */
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

    /** Resolve dropped paths to workspace-relative paths (dropping anything outside) */
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

    /** Run a shell command directly (the `!` prefix), without a model turn */
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

    // ---------- User messages ----------

    /** Drop the pending abort-recovery fallback, if any (turn settled, replaced, or no panel left) */
    private _clearBusyTimeout(): void {
        // The handle is runtime-scoped so any panel of the session can drop it,
        // whoever armed it (see ChatRuntime.abortRecovery)
        this._runtime.abortRecovery?.cancel();
        this._runtime.abortRecovery = undefined;
    }

    /**
     * Set while a stop has been requested (Stop button, or a programmatic stop
     * before switching sessions). pi does not always mark the message it aborts
     * with `stopReason: 'aborted'`: when the abort lands between turns it arrives
     * as an error carrying the AbortError text ("This operation was aborted"),
     * which showed up as a red failure bubble the user had to act on even though
     * they had just asked for the stop themselves.
     *
     * Cleared when a new run starts and once the stop has settled, so a genuine
     * failure later on is still reported.
     */
    private _stopRequested = false;

    /** Whether the turn ended because it was stopped rather than because it failed */
    private _wasStopped(aborted: boolean): boolean {
        return aborted || this._stopRequested;
    }

    /**
     * Whether this panel is the one that owns the non-presentation effects of
     * pi events. Every panel bound to a runtime subscribes to the same client,
     * which is right for rendering (each webview streams its own copy) but
     * wrong for anything outside the transcript: shared runtime state, host
     * modals and system notifications must happen exactly once per event.
     * The first live panel owns them; disposal hands ownership to the next.
     */
    private get _isEventOwner(): boolean {
        const first = this._runtime.panels.values().next().value as ChatPanel | undefined;
        return first === this;
    }

    /** Context attachments currently in the composer (echoed on the message so the user knows it had attachments) */
    private _currentAttachments(): Array<{ type: string; path: string; lineRange?: string }> {
        return this._contexts.map((c) => ({ type: c.type, path: c.path, lineRange: c.lineRange }));
    }

    private async _handleUserMessage(userText: string, mode?: string, images?: ImageAttachment[]) {
        if (userText && !this._runtime.firstUserMessage) { this._runtime.firstUserMessage = userText; }
        // Record the last user message so the error bubble's "Retry" can resend it
        this._lastUserMessage = { text: userText, images };
        if (this._busy) {
            await this._enqueueWhileBusy(userText, mode, images);
            return;
        }

        const attachments = this._currentAttachments();
        this._webviewSynced = true;
        this._post({
            type: 'addUserMessage',
            text: userText,
            attachments: attachments.length ? attachments : undefined,
            images: images && images.length ? images : undefined,
        });
        this._busy = true;
        this._post({ type: 'setBusy', busy: true });

        try {
            // Reconnecting must use this runtime's session options: the default
            // (--continue) would otherwise join whichever session pi considers
            // most recent, not the one this panel is showing
            const client = await this._clientManager.ensureConnected(this._extensionPath, this._runtime.startOptions);
            const extra = await this._buildAutoContext();
            const disposition = await client.prompt(this._withContext(userText, extra), images);
            this._clearContexts();
            if (disposition === 'handled') {
                // pi did not start a new turn (e.g. an extension command handled it): end busy immediately
                this._busy = false;
                this._clearBusyTimeout();
                this._post({ type: 'setBusy', busy: false });
            } else if (disposition === 'queued') {
                // Queued: pi handles it after the current turn; busy clears at agent_settled
                this._post({ type: 'notice', text: vscode.l10n.t('Message queued; pi will handle it after the current turn') });
            }
        } catch (err) {
            this._busy = false;
            this._clearBusyTimeout();
            this._post({ type: 'thinkingEnd' });
            this._post({ type: 'setBusy', busy: false });

            const msg = (err as Error).message || String(err);

            // Replace a crashed process whether or not the user stopped the turn:
            // stopping is often what revealed the crash, and skipping this would leave
            // the panel bound to a dead client until the user retried by hand.
            if (isProcessError(err)) {
                await this._clientManager.stop();
                void this._ensureClient().catch((err) => { logError(`reconnect after crash failed: ${(err as Error).message}`); });
            }

            // A stop the user asked for can make the prompt itself fail; that is not
            // something to hand back as an actionable error.
            if (this._stopRequested) {
                logInfo(`prompt ended after a stop request: ${msg}`);
                this._post({ type: 'notice', text: vscode.l10n.t('Stopped') });
                return;
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

    /** While busy: steer inserts into the current turn; otherwise it queues as a follow-up */
    private async _enqueueWhileBusy(userText: string, mode?: string, images?: ImageAttachment[]): Promise<void> {
        const steering = mode === 'steer';
        const attachments = this._currentAttachments();
        // Show the user message first (with a pending state) so it isn't lost if queueing fails
        this._webviewSynced = true;
        this._post({
            type: 'addUserMessage',
            text: userText,
            pending: steering ? 'steering' : 'queued',
            attachments: attachments.length ? attachments : undefined,
            images: images && images.length ? images : undefined,
        });
        try {
            // Same as _handleUserMessage: reconnect must rejoin this runtime's session
            const client = await this._clientManager.ensureConnected(this._extensionPath, this._runtime.startOptions);
            const extra = await this._buildAutoContext();
            const message = this._withContext(userText, extra);
            if (steering && typeof client.steer === 'function') {
                await client.steer(message, images);
            } else if (typeof client.followUp === 'function') {
                await client.followUp(message, images);
            } else {
                // Fall back to prompt with streamingBehavior when the client lacks steer/followUp
                await client.prompt(message, images, steering ? 'steer' : 'followUp');
            }
            this._clearContexts();
        } catch (err) {
            this._post({ type: 'notice', text: vscode.l10n.t('Failed to queue message: {0}', (err as Error).message) });
        }
    }

    // ---------- Apply to the editor ----------

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

    // ---------- Webview communication ----------

    private _post(message: PostMessage) {
        if (this._disposed) { return; }
        void this._webview.postMessage(message);
    }

    /** Whether an error looks like a missing credential */
    private _looksLikeAuthError(text: string): boolean {
        const t = (text || '').toLowerCase();
        return t.includes('credential') || t.includes('api key') || t.includes('api-key')
            || t.includes('unauthorized') || t.includes('authentication')
            || t.includes('not configured') || t.includes('no provider');
    }

    /** Action buttons for an error bubble */
    private _errorActions(text = ''): Array<{ id: string; label: string }> {
        const actions: Array<{ id: string; label: string }> = [];
        if (this._lastUserMessage) {
            actions.push({ id: 'retry', label: vscode.l10n.t('Retry') });
            actions.push({ id: 'model', label: vscode.l10n.t('Switch model') });
        }
        // Missing credential: offer "Add API key / Sign in" directly
        if (this._authStatus.ready === false || this._looksLikeAuthError(text)) {
            actions.push({ id: 'connect', label: vscode.l10n.t('Add API key') });
            actions.push({ id: 'login', label: vscode.l10n.t('Sign in with pi') });
        }
        actions.push({ id: 'logs', label: vscode.l10n.t('Show logs') });
        return actions;
    }

    /** Report an error as an actionable error bubble */
    private _postError(text: string): void {
        this._post({ type: 'error', text, actions: this._errorActions(text) });
    }

    /** First-run setup: pi installed / connected / provider credentials ready / workspace trusted */
    private _postSetupStatus(): void {
        const status = {
            connecting: this._runtime.state.connecting,
            connected: this._runtime.state.connected,
            piFound: this._runtime.state.connected || !this._piMissing,
            hasModels: this._runtime.state.models.length > 0,
            workspaceTrusted: vscode.workspace.isTrusted,
            authReady: this._authStatus.ready,
            authReason: this._authStatus.reason,
            provider: this._authStatus.provider,
        };
        this._post({ type: 'setup', setup: status });
    }

    /** Use `pi auth check --provider <p> --json` to see whether the current provider's credentials are ready */
    private async _refreshAuthStatus(): Promise<void> {
        let provider: string | undefined;
        const client = this._clientManager.client;
        if (client) {
            try { provider = (await client.getState()).model?.provider; } catch { /* ignore */ }
        }
        if (!provider) {
            this._authStatus = { ready: false, reason: 'no_provider' };
            this._postSetupStatus();
            return;
        }
        try {
            const res = await this._clientManager.runCli(
                this._extensionPath,
                ['auth', 'check', '--provider', provider, '--json', '--no-refresh'],
            );
            const parsed = JSON.parse(res.stdout.trim()) as { status?: string; reason?: string };
            this._authStatus = { provider, ready: parsed.status === 'ready', reason: parsed.reason };
        } catch (err) {
            logError(`auth check failed: ${(err as Error).message}`);
            this._authStatus = { provider, ready: undefined };
        }
        this._postSetupStatus();
    }

    /** One-click actions on the first-run setup checklist */
    private async _handleSetupAction(action: string): Promise<void> {
        switch (action) {
            case 'install': {
                await vs.clipboard.writeText(PI_INSTALL_HINT);
                const term = vscode.window.createTerminal(vscode.l10n.t('Pi setup'));
                term.show();
                term.sendText(PI_INSTALL_HINT);
                void vs.showInformationMessage(vscode.l10n.t('Install command copied — run it in the terminal, then Retry'));
                break;
            }
            case 'connect':
                await this._connectProvider();
                break;
            case 'manage':
                await this._manageProviders();
                break;
            case 'pi': {
                // Open a terminal running pi so the user can sign in / pick a model
                const term = vscode.window.createTerminal('Pi');
                term.show();
                term.sendText('pi');
                break;
            }
            case 'retry':
                await this._ensureClient();
                break;
            case 'trust':
                try { await vs.executeCommand('workbench.trust.manage'); } catch { /* ignore */ }
                break;
            case 'logs':
                showLogs();
                break;
            default:
                break;
        }
    }

    /** "Connect a provider" flow: built-in API key / third-party OpenAI-compatible endpoint / terminal OAuth */
    private async _connectProvider(): Promise<void> {
        const pick = await vs.showQuickPick(
            [
                { label: vscode.l10n.t('Add an API key'), description: vscode.l10n.t('Anthropic, OpenAI, DeepSeek, OpenRouter…'), id: 'builtin' },
                { label: vscode.l10n.t('Add a custom OpenAI-compatible endpoint'), description: vscode.l10n.t('third-party gateway, self-hosted, Ollama/LM Studio'), id: 'custom' },
                { label: vscode.l10n.t('Sign in with pi (terminal)'), description: vscode.l10n.t('OAuth providers, e.g. GitHub Copilot'), id: 'oauth' },
            ],
            { title: vscode.l10n.t('Connect a model provider'), ignoreFocusOut: true },
        );
        if (!pick) { return; }
        const id = (pick as { id?: string }).id;
        if (id === 'builtin') { await this._addBuiltinProvider(); }
        else if (id === 'custom') { await this._addCustomProvider(); }
        else if (id === 'oauth') {
            const term = vscode.window.createTerminal(vscode.l10n.t('Pi login'));
            term.show();
            term.sendText('pi');
            void vs.showInformationMessage(vscode.l10n.t('In pi, type /login to sign in with OAuth'));
        }
    }

    /** Built-in provider: write to pi's auth.json, restart and verify */
    private async _addBuiltinProvider(): Promise<void> {
        const items = [
            ...KNOWN_PROVIDERS.map((p) => ({ label: p.label, description: p.id, detail: p.envVar, id: p.id })),
            { label: vscode.l10n.t('Other…'), description: vscode.l10n.t('enter a provider id'), detail: '', id: '__other__' },
        ];
        const pick = await vs.showQuickPick(items, {
            title: vscode.l10n.t('Select a provider'), ignoreFocusOut: true, matchOnDescription: true, matchOnDetail: true,
        });
        if (!pick) { return; }
        let provider = (pick as { id?: string }).id ?? '';
        if (provider === '__other__') {
            const typed = await vs.showInputBox({
                title: vscode.l10n.t('Provider id'),
                prompt: vscode.l10n.t('pi provider id, e.g. anthropic'),
                ignoreFocusOut: true,
            });
            if (!typed) { return; }
            provider = typed.trim();
        }
        const key = await vs.showInputBox({
            title: vscode.l10n.t('API key for {0}', providerLabel(provider)),
            prompt: vscode.l10n.t("Saved to pi's credential file (auth.json); the extension never sends it anywhere."),
            password: true,
            ignoreFocusOut: true,
        });
        if (!key) { return; }
        try { this._writeAuthKey(provider, key.trim()); } catch (err) {
            this._postError(vscode.l10n.t('Failed to save the API key: {0}', (err as Error).message));
            return;
        }
        await this._verifyProvider(provider);
    }

    /** Third-party / self-hosted OpenAI-compatible endpoint: write to pi's models.json */
    private async _addCustomProvider(): Promise<void> {
        const name = await vs.showInputBox({ title: vscode.l10n.t('Display name'), prompt: vscode.l10n.t('e.g. My gateway'), ignoreFocusOut: true });
        if (!name) { return; }
        const baseUrl = await vs.showInputBox({
            title: vscode.l10n.t('Base URL'),
            prompt: vscode.l10n.t('e.g. https://api.example.com/v1'),
            ignoreFocusOut: true,
            validateInput: (v) => (/^https?:\/\//.test(v.trim()) ? undefined : vscode.l10n.t('Must start with http:// or https://')),
        });
        if (!baseUrl) { return; }
        const key = await vs.showInputBox({ title: vscode.l10n.t('API key'), password: true, ignoreFocusOut: true });
        if (key === undefined) { return; }
        const modelId = await vs.showInputBox({ title: vscode.l10n.t('Model id'), prompt: vscode.l10n.t('e.g. deepseek-chat'), ignoreFocusOut: true });
        if (!modelId) { return; }
        const id = name.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'custom';
        try {
            this._writeCustomProvider({ id, name: name.trim(), baseUrl: baseUrl.trim(), apiKey: key.trim(), modelId: modelId.trim() });
        } catch (err) {
            this._postError(vscode.l10n.t('Failed to save the endpoint: {0}', (err as Error).message));
            return;
        }
        await this._verifyProvider(id);
    }

    /** After writing credentials: restart the client -> re-check -> auto-select a model */
    private async _verifyProvider(provider: string): Promise<void> {
        await this.restartClient();
        await this._refreshAuthStatus();
        if (this._authStatus.ready === false) {
            void vs.showWarningMessage(vscode.l10n.t('Saved, but pi still reports the provider as not ready ({0})', this._authStatus.reason ?? provider));
            return;
        }
        await this._selectProviderModel(provider);
        void vs.showInformationMessage(vscode.l10n.t('Provider connected: {0}', providerLabel(provider)));
    }

    /**
     * Make sure the user can send a message right away.
     *
     * pi picks a startup model automatically once a provider has credentials
     * (`defaultProvider` / `defaultModel` are "Automatic"), so we only fill in a
     * model when pi ended up with none (e.g. a brand-new custom provider). Never
     * override pi's choice: the model list is not sorted by preference, so the
     * "first" entry would often be an older model and downgrade the default.
     */
    private async _selectProviderModel(provider: string): Promise<void> {
        const client = this._clientManager.client;
        if (!client || typeof client.setModel !== 'function') { return; }
        try {
            // pi already picked one — leave it alone.
            if ((await client.getState()).model?.id) { return; }
            const models = await client.getAvailableModels();
            const first = models.find((m) => m.provider === provider);
            if (first) { await client.setModel(first.provider, first.id); await this._loadModels(client); }
        } catch (err) { logError(`select provider model failed: ${(err as Error).message}`); }
    }

    /** pi's agent directory (defaults to ~/.pi/agent; override with PI_CODING_AGENT_DIR) */
    private _agentDir(): string {
        const override = process.env.PI_CODING_AGENT_DIR?.trim();
        return override || path.join(os.homedir(), '.pi', 'agent');
    }

    /** Merge an API key into auth.json (backup first, file mode 600) */
    private _writeAuthKey(provider: string, key: string): void {
        const file = path.join(this._agentDir(), 'auth.json');
        // Throws (before the .bak is touched) when an existing file is broken
        const data = this._readJsonForWrite(file);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        if (fs.existsSync(file)) { try { fs.copyFileSync(file, file + '.bak'); } catch { /* ignore */ } }
        data[provider] = { type: 'api_key', key };
        fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
    }

    /** Merge a custom OpenAI-compatible endpoint into models.json (backup first) */
    private _writeCustomProvider(p: { id: string; name: string; baseUrl: string; apiKey: string; modelId: string }): void {
        const file = path.join(this._agentDir(), 'models.json');
        // Same rule as _writeAuthKey: an unparsable file aborts the write instead
        // of being rebuilt from nothing
        const data = this._readJsonForWrite(file);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        if (fs.existsSync(file)) { try { fs.copyFileSync(file, file + '.bak'); } catch { /* ignore */ } }
        const providers = (data.providers as Record<string, Record<string, unknown> & { models?: Array<{ id: string }> }> | undefined) ?? {};
        const existing = providers[p.id];
        const models = existing?.models ? [...existing.models] : [];
        if (!models.some((m) => m.id === p.modelId)) { models.push({ id: p.modelId }); }
        providers[p.id] = { ...(existing ?? {}), name: p.name, baseUrl: p.baseUrl, api: 'openai-completions', apiKey: p.apiKey, models };
        data.providers = providers;
        fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
    }

    // ---------- Provider management ----------

    /** Provider management entry point (command / setup-checklist link) */
    public async manageProviders(): Promise<void> {
        await this._manageProviders();
    }
    /** List providers from auth.json / models.json with their status, and allow update / delete */
    private async _manageProviders(): Promise<void> {
        const known = this._collectProviders();
        const statuses = await Promise.all(known.map(async (p) => ({ p, status: await this._checkProvider(p.id) })));
        const items: Array<{ label: string; description?: string; detail?: string; id: string }> = [
            { label: vscode.l10n.t('Add a provider…'), id: '__add__' },
        ];
        for (const { p, status } of statuses) {
            const ok = status.status === 'ready';
            const who = p.label ? `${p.label} (${p.id})` : p.id;
            items.push({
                label: (ok ? '✓ ' : '⚠ ') + who,
                description: ok ? vscode.l10n.t('ready') : (status.reason || status.status || vscode.l10n.t('not ready')),
                detail: p.sources.join(' · '),
                id: p.id,
            });
        }
        const pick = await vs.showQuickPick(items, {
            title: vscode.l10n.t('Model providers'),
            ignoreFocusOut: true,
            matchOnDescription: true,
            matchOnDetail: true,
        });
        if (!pick) { return; }
        const id = (pick as { id?: string }).id;
        if (!id || id === '__add__') { await this._connectProvider(); return; }
        await this._manageProvider(id);
    }

    /** A single provider: update / delete / check status */
    private async _manageProvider(id: string): Promise<void> {
        const action = await vs.showQuickPick(
            [
                { label: vscode.l10n.t('Update API key'), id: 'update' },
                { label: vscode.l10n.t('Delete'), id: 'delete' },
                { label: vscode.l10n.t('Check status'), id: 'check' },
            ],
            { title: providerLabel(id) + ' · ' + id, ignoreFocusOut: true },
        );
        if (!action) { return; }
        const a = (action as { id?: string }).id;
        if (a === 'check') {
            const s = await this._checkProvider(id);
            void vs.showInformationMessage(`${id}: ${s.status ?? 'unknown'}${s.reason ? ' — ' + s.reason : ''}`);
            return;
        }
        if (a === 'update') {
            const key = await vs.showInputBox({
                title: vscode.l10n.t('API key for {0}', providerLabel(id)),
                password: true,
                ignoreFocusOut: true,
            });
            if (!key) { return; }
            try {
                if (this._hasModelEntry(id)) { this._updateModelApiKey(id, key.trim()); }
                else { this._writeAuthKey(id, key.trim()); }
            } catch (err) {
                // A broken models.json/auth.json must surface, not vanish: this
                // path had no handler and the key was silently not updated
                this._postError(vscode.l10n.t('Failed to save the API key: {0}', (err as Error).message));
                return;
            }
            await this._verifyProvider(id);
            return;
        }
        if (a === 'delete') {
            const confirmed = await vs.showWarningMessage(
                vscode.l10n.t('Remove the credentials for {0}?', providerLabel(id)),
                { modal: true },
                vscode.l10n.t('Delete'),
            );
            if (confirmed !== vscode.l10n.t('Delete')) { return; }
            try { this._deleteProvider(id); } catch (err) {
                this._postError(vscode.l10n.t('Failed to remove the provider: {0}', (err as Error).message));
                return;
            }
            await this.restartClient();
            await this._refreshAuthStatus();
            void vs.showInformationMessage(vscode.l10n.t('Removed: {0}', providerLabel(id)));
        }
    }

    /** Collect every provider seen in auth.json and models.json */
    private _collectProviders(): Array<{ id: string; label?: string; sources: string[] }> {
        const map = new Map<string, { id: string; label?: string; sources: string[] }>();
        try {
            const data = JSON.parse(fs.readFileSync(path.join(this._agentDir(), 'auth.json'), 'utf8')) as Record<string, unknown>;
            for (const id of Object.keys(data ?? {})) { map.set(id, { id, sources: ['auth.json'] }); }
        } catch { /* no auth.json */ }
        try {
            const data = JSON.parse(fs.readFileSync(path.join(this._agentDir(), 'models.json'), 'utf8')) as { providers?: Record<string, { name?: string }> };
            for (const [id, v] of Object.entries(data.providers ?? {})) {
                const entry = map.get(id) ?? { id, sources: [] };
                entry.label = v?.name;
                entry.sources.push('models.json');
                map.set(id, entry);
            }
        } catch { /* no models.json */ }
        return [...map.values()];
    }

    /** Raw result of `pi auth check` */
    private async _checkProvider(id: string): Promise<{ status?: string; reason?: string }> {
        try {
            const res = await this._clientManager.runCli(
                this._extensionPath,
                ['auth', 'check', '--provider', id, '--json', '--no-refresh'],
            );
            return JSON.parse(res.stdout.trim()) as { status?: string; reason?: string };
        } catch { return {}; }
    }

    /**
     * Read one of pi's config files for a *write*.
     *
     * "File does not exist" and "file cannot be parsed" are fundamentally
     * different: every writer used to treat both as "rebuild from {}", which
     * silently dropped all other providers — and then copied the broken state
     * over the .bak, destroying the backup too. A parse failure now aborts the
     * write before anything on disk is touched.
     */
    private _readJsonForWrite(file: string): Record<string, unknown> {
        if (!fs.existsSync(file)) { return {}; }
        let raw: string;
        try { raw = fs.readFileSync(file, 'utf8'); } catch (err) {
            throw new Error(vscode.l10n.t('{0} could not be read ({1}) — nothing was changed', file, (err as Error).message));
        }
        try {
            return JSON.parse(raw) as Record<string, unknown>;
        } catch (err) {
            throw new Error(vscode.l10n.t(
                '{0} could not be parsed ({1}) — nothing was changed, the previous settings are safe in {0}.bak',
                file, (err as Error).message,
            ));
        }
    }

    private _hasModelEntry(id: string): boolean {
        const data = this._readJsonForWrite(path.join(this._agentDir(), 'models.json')) as { providers?: Record<string, unknown> };
        return Boolean(data.providers && id in data.providers);
    }

    /** Update a provider's apiKey in models.json */
    private _updateModelApiKey(id: string, key: string): void {
        const file = path.join(this._agentDir(), 'models.json');
        const data = this._readJsonForWrite(file) as { providers?: Record<string, Record<string, unknown>> };
        const entry = data.providers?.[id];
        if (!entry) { return; }
        try { fs.copyFileSync(file, file + '.bak'); } catch { /* ignore */ }
        entry.apiKey = key;
        fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
    }

    /** Delete a provider from auth.json and models.json (backup first) */
    private _deleteProvider(id: string): void {
        const authFile = path.join(this._agentDir(), 'auth.json');
        const modelsFile = path.join(this._agentDir(), 'models.json');
        // Both files are read strictly BEFORE either is mutated, so a broken
        // models.json cannot leave auth.json already half-deleted
        const auth = this._readJsonForWrite(authFile);
        const data = this._readJsonForWrite(modelsFile) as { providers?: Record<string, unknown> };
        if (id in auth) {
            try { fs.copyFileSync(authFile, authFile + '.bak'); } catch { /* ignore */ }
            delete auth[id];
            fs.writeFileSync(authFile, JSON.stringify(auth, null, 2) + '\n', { mode: 0o600 });
        }
        if (data.providers && id in data.providers) {
            try { fs.copyFileSync(modelsFile, modelsFile + '.bak'); } catch { /* ignore */ }
            delete data.providers[id];
            fs.writeFileSync(modelsFile, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
        }
    }

    public dispose() {
        this._disposed = true;
        // Leave this panel's runtime; stop its pi process when no other panel uses it
        this._runtimeUnsub?.();
        this._runtimeUnsub = undefined;
        this._runtime.panels.delete(this);
        // The abort-recovery timer unlocks every panel of the session, so it must
        // survive this panel as long as one is left to unlock; only the last panel
        // out drops it. (Rebinding to another session clears it in `_bindRuntime`,
        // where the callback's runtime would otherwise be the wrong one.)
        if (this._runtime.panels.size === 0) { this._clearBusyTimeout(); }
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
