import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ChatPanel } from './chatPanel';
import { ChatRuntime } from './chatPanel/runtime';
import * as vscodeMock from '../test/vscode.mock';

interface Posted { type: string; [k: string]: unknown }

function makeWebview() {
    const posted: Posted[] = [];
    let onMessage: ((m: unknown) => void) | undefined;
    return {
        cspSource: 'vscode-resource://',
        html: '',
        asWebviewUri: (_uri: unknown) => ({ toString: () => 'vscode-resource://media/main.js' }), // media/main.js (esbuild output from main.ts)
        onDidReceiveMessage: (cb: (m: unknown) => void) => { onMessage = cb; return { dispose() { /* noop */ } }; },
        postMessage: (m: Posted) => { posted.push(m); return Promise.resolve(true); },
        posted,
        emit: (m: unknown) => { if (onMessage) { onMessage(m); } },
    };
}

// Minimal vscode.Event<void> stand-in.
const disposeEvent = (_listener: () => void, _thisArgs?: unknown, disposables?: { dispose(): void }[]) => {
    const d = { dispose() { /* noop */ } };
    if (disposables) { disposables.push(d); }
    return d;
};

function createPanel(surfaceKey?: string) {
    const webview = makeWebview();
    const panel = ChatPanel.create(
        webview as unknown as import('vscode').Webview,
        '/ext',
        disposeEvent as unknown as import('vscode').Event<void>,
        surfaceKey,
    );
    return { webview, panel };
}

describe('ChatPanel webview bridge', () => {
    const panels: ChatPanel[] = [];
    afterEach(() => {
        panels.splice(0).forEach((p) => p.dispose());
        (vscodeMock.window as { activeTextEditor?: unknown }).activeTextEditor = undefined;
        ChatPanel.resetRuntimesForTest();
    });

    function make(surfaceKey?: string) {
        const { webview, panel } = createPanel(surfaceKey);
        panels.push(panel);
        return { webview, panel };
    }

    it('focusInput() posts a focusInput message', () => {
        const { webview, panel } = make();
        panel.focusInput();
        expect(webview.posted).toContainEqual({ type: 'focusInput' });
    });

    it('editLastMessage() posts an editLast message', () => {
        const { webview, panel } = make();
        panel.editLastMessage();
        expect(webview.posted).toContainEqual({ type: 'editLast' });
    });

    it('clear() posts clear, setBusy, contexts and turnChanges', async () => {
        const { webview, panel } = make();
        await panel.clear();
        const types = webview.posted.map((m) => m.type);
        expect(types).toContain('clear');
        expect(types).toContain('setBusy');
        expect(types).toContain('contexts');
        expect(types).toContain('turnChanges');
    });

    it('attachSelection() with no editor posts a notice', () => {
        (vscodeMock.window as { activeTextEditor?: unknown }).activeTextEditor = undefined;
        const { webview, panel } = make();
        panel.attachSelection();
        expect(webview.posted.some((m) => m.type === 'notice')).toBe(true);
    });

    it('routes an incoming attachActive message (no editor → notice)', () => {
        (vscodeMock.window as { activeTextEditor?: unknown }).activeTextEditor = undefined;
        const { webview } = make();
        webview.emit({ type: 'attachActive' });
        expect(webview.posted.some((m) => m.type === 'notice')).toBe(true);
    });

    it('requestAttachMenu posts the add-context menu data', () => {
        const { webview } = make();
        webview.emit({ type: 'requestAttachMenu' });
        const msg = webview.posted.filter((m) => m.type === 'attachMenu').pop();
        expect(Array.isArray(msg?.openEditors)).toBe(true);
        expect(Array.isArray(msg?.recentFiles)).toBe(true);
    });

    it('attachPath adds the given file as context', () => {
        const { webview } = make();
        webview.emit({ type: 'attachPath', path: 'src/a.ts' });
        const ctx = webview.posted.filter((m) => m.type === 'contexts').pop();
        expect((ctx?.contexts as Array<{ path: string }>)).toContainEqual(expect.objectContaining({ path: 'src/a.ts' }));
    });

    it('attachPath with a range adds a selection context for that path', () => {
        const { webview } = make();
        webview.emit({ type: 'attachPath', path: 'src/b.ts', range: '3-9' });
        const ctx = webview.posted.filter((m) => m.type === 'contexts').pop();
        expect((ctx?.contexts as Array<{ path: string; lineRange?: string; type: string }>))
            .toContainEqual(expect.objectContaining({ path: 'src/b.ts', lineRange: '3-9', type: 'selection' }));
    });

    it('attachFiles() adds selected workspace files as context', async () => {
        const original = vscodeMock.window.showOpenDialog;
        (vscodeMock.window as { showOpenDialog: unknown }).showOpenDialog = () => Promise.resolve([{ fsPath: '/x/a.ts' }]);
        try {
            const { webview, panel } = make();
            await panel.attachFiles();
            const ctx = webview.posted.filter((m) => m.type === 'contexts').pop();
            expect((ctx?.contexts as Array<{ path: string }>)).toContainEqual(expect.objectContaining({ path: '/x/a.ts' }));
        } finally {
            (vscodeMock.window as { showOpenDialog: unknown }).showOpenDialog = original;
        }
    });

    it('a disposed panel ignores later posts', () => {
        const { webview, panel } = make();
        panel.dispose();
        const before = webview.posted.length;
        panel.focusInput();
        expect(webview.posted.length).toBe(before);
    });

    describe('first-run setup', () => {
        it('posts a setup status (workspace trust / pi / connection / model)', () => {
            const { webview, panel } = make();
            (panel as unknown as { _postSetupStatus(): void })._postSetupStatus();
            const setup = webview.posted.filter((m) => m.type === 'setup').pop();
            expect(setup).toBeTruthy();
            const status = setup?.setup as Record<string, unknown>;
            expect(typeof status.workspaceTrusted).toBe('boolean');
            expect(typeof status.connected).toBe('boolean');
            expect(typeof status.piFound).toBe('boolean');
            expect(typeof status.hasModels).toBe('boolean');
        });

        it('routes setupAction messages without throwing', () => {
            const { webview } = make();
            webview.emit({ type: 'setupAction', action: 'install' });
            webview.emit({ type: 'setupAction', action: 'logs' });
            // Must not throw (terminal / clipboard are mocked)
            expect(true).toBe(true);
        });

        type AuthInternals = { _refreshAuthStatus(): Promise<void>; _runtime: { clientManager: unknown } };
        const stubClient = (panel: ChatPanel, provider: string, authStdout: string, code = 0): void => {
            const runtime = (panel as unknown as AuthInternals)._runtime;
            runtime.clientManager = {
                client: { getState: async () => ({ model: { provider } }) },
                runCli: async () => ({ stdout: authStdout, stderr: '', code }),
            };
        };

        it('reports “provider ready” from `pi auth check`', async () => {
            const { webview, panel } = make();
            stubClient(panel, 'openai', '{"status":"ready","provider":"openai"}');
            await (panel as unknown as AuthInternals)._refreshAuthStatus();
            const setup = webview.posted.filter((m) => m.type === 'setup').pop();
            expect(setup?.setup).toMatchObject({ authReady: true, provider: 'openai' });
        });

        it('reports not-ready with the pi reason', async () => {
            const { webview, panel } = make();
            stubClient(panel, 'anthropic', '{"status":"not_ready","reason":"credentials_not_configured"}', 1);
            await (panel as unknown as AuthInternals)._refreshAuthStatus();
            const setup = webview.posted.filter((m) => m.type === 'setup').pop();
            expect(setup?.setup).toMatchObject({ authReady: false, authReason: 'credentials_not_configured', provider: 'anthropic' });
        });

        type ActionInternals = { _errorActions(t?: string): Array<{ id: string }>; _authStatus: unknown };

        it('adds connect / sign-in buttons to a credential error', () => {
            const { panel } = make();
            const ids = (panel as unknown as ActionInternals)._errorActions('No API key for provider openai').map((a) => a.id);
            expect(ids).toEqual(expect.arrayContaining(['connect', 'login', 'logs']));
        });

        it('does not add connect for an unrelated error', () => {
            const { panel } = make();
            const ids = (panel as unknown as ActionInternals)._errorActions('Request timed out').map((a) => a.id);
            expect(ids).not.toContain('connect');
        });

        it('adds connect when the provider is known not-ready', () => {
            const { panel } = make();
            (panel as unknown as ActionInternals)._authStatus = { provider: 'openai', ready: false };
            const ids = (panel as unknown as ActionInternals)._errorActions('boom').map((a) => a.id);
            expect(ids).toContain('connect');
        });

        describe('credential files', () => {
            let dir: string;
            let prev: string | undefined;
            beforeEach(() => {
                dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-agent-dir-'));
                prev = process.env.PI_CODING_AGENT_DIR;
                process.env.PI_CODING_AGENT_DIR = dir;
            });
            afterEach(() => {
                if (prev === undefined) { delete process.env.PI_CODING_AGENT_DIR; } else { process.env.PI_CODING_AGENT_DIR = prev; }
                fs.rmSync(dir, { recursive: true, force: true });
            });

            it('merges API keys into auth.json', () => {
                const { panel } = make();
                const inner = panel as unknown as { _writeAuthKey(p: string, k: string): void };
                inner._writeAuthKey('openai', 'sk-1');
                inner._writeAuthKey('deepseek', 'sk-2');
                const auth = JSON.parse(fs.readFileSync(path.join(dir, 'auth.json'), 'utf8')) as Record<string, unknown>;
                expect(auth.openai).toEqual({ type: 'api_key', key: 'sk-1' });
                expect(auth.deepseek).toEqual({ type: 'api_key', key: 'sk-2' });
            });

            it('merges a custom endpoint into models.json', () => {
                const { panel } = make();
                const inner = panel as unknown as { _writeCustomProvider(p: Record<string, string>): void };
                inner._writeCustomProvider({ id: 'my-gw', name: 'My GW', baseUrl: 'https://api.example.com/v1', apiKey: 'k', modelId: 'm1' });
                const models = JSON.parse(fs.readFileSync(path.join(dir, 'models.json'), 'utf8')) as {
                    providers: Record<string, { baseUrl: string; api: string; apiKey: string; models: Array<{ id: string }> }>;
                };
                expect(models.providers['my-gw']).toMatchObject({ baseUrl: 'https://api.example.com/v1', api: 'openai-completions', apiKey: 'k' });
                expect(models.providers['my-gw'].models).toEqual([{ id: 'm1' }]);
            });

            it('lists providers from both files and deletes them', () => {
                const { panel } = make();
                const inner = panel as unknown as {
                    _writeAuthKey(p: string, k: string): void;
                    _writeCustomProvider(p: Record<string, string>): void;
                    _collectProviders(): Array<{ id: string; sources: string[] }>;
                    _deleteProvider(id: string): void;
                };
                inner._writeAuthKey('openai', 'sk');
                inner._writeCustomProvider({ id: 'my-gw', name: 'My GW', baseUrl: 'https://x/v1', apiKey: 'k', modelId: 'm' });
                expect(inner._collectProviders().map((p) => p.id).sort()).toEqual(['my-gw', 'openai']);

                inner._deleteProvider('openai');
                inner._deleteProvider('my-gw');
                expect(inner._collectProviders()).toEqual([]);
                expect(JSON.parse(fs.readFileSync(path.join(dir, 'auth.json'), 'utf8'))).toEqual({});
            });
        });
    });

    describe('session runtime isolation', () => {
        const bind = (panel: ChatPanel, runtime: ChatRuntime): void =>
            (panel as unknown as { _bindRuntime(r: ChatRuntime): void })._bindRuntime(runtime);
        const lastContexts = (webview: { posted: Posted[] }): Array<{ path: string }> =>
            (webview.posted.filter((m) => m.type === 'contexts').pop()?.contexts as never) ?? [];

        type AbortInternals = {
            _runtime: { panels: Set<unknown>; state: { busy: boolean }; clientManager: { abort(): Promise<void> } };
            _abortIfSole(): Promise<void>;
            _clearBusyTimeout(): void;
        };
        const stubBusyAbort = (panel: ChatPanel): (() => number) => {
            const inner = panel as unknown as AbortInternals;
            let count = 0;
            inner._runtime.clientManager.abort = async () => { count++; };
            inner._runtime.state.busy = true;
            return () => count;
        };
        const abortIfSole = async (panel: ChatPanel): Promise<void> => {
            await (panel as unknown as AbortInternals)._abortIfSole();
            (panel as unknown as AbortInternals)._clearBusyTimeout();
        };

        it('panels on the default session share context (same session → mirror)', () => {
            const a = make();
            const b = make();
            a.webview.emit({ type: 'attachPath', path: 'src/shared.ts' });
            expect(lastContexts(a.webview)).toContainEqual(expect.objectContaining({ path: 'src/shared.ts' }));
            expect(lastContexts(b.webview)).toContainEqual(expect.objectContaining({ path: 'src/shared.ts' }));
        });

        it('different surfaces (sidebar / secondary / editor) are independent by default', () => {
            const sidebar = make('pi-agent.chatView');
            const secondary = make('pi-agent.chatViewSecondary');
            sidebar.webview.emit({ type: 'attachPath', path: 'src/only-sidebar.ts' });
            expect(lastContexts(sidebar.webview)).toContainEqual(expect.objectContaining({ path: 'src/only-sidebar.ts' }));
            expect(lastContexts(secondary.webview)).not.toContainEqual(expect.objectContaining({ path: 'src/only-sidebar.ts' }));
        });

        it('a panel detached to another runtime no longer mirrors the old session', () => {
            const a = make();
            const b = make();
            bind(a.panel, new ChatRuntime());

            a.webview.emit({ type: 'attachPath', path: 'src/only-a.ts' });

            expect(lastContexts(a.webview)).toContainEqual(expect.objectContaining({ path: 'src/only-a.ts' }));
            expect(lastContexts(b.webview)).not.toContainEqual(expect.objectContaining({ path: 'src/only-a.ts' }));
        });

        it('does not abort a shared session (new session in one surface must not stop the other)', async () => {
            const a = make();
            make(); // second panel joins the same (default) runtime
            const aborts = stubBusyAbort(a.panel);
            await abortIfSole(a.panel);
            expect(aborts()).toBe(0);
        });

        it('aborts when this panel is the only user of the session', async () => {
            const a = make();
            const aborts = stubBusyAbort(a.panel);
            await abortIfSole(a.panel);
            expect(aborts()).toBe(1);
        });
    });

    describe('auto-attached active editor', () => {
        const win = vscodeMock.window as unknown as { activeTextEditor?: unknown };
        type Ctx = { id: string; type: string; path: string; lineRange?: string; auto?: boolean };

        // Unique file names: the module-level "dismissed" state persists per document path, so avoid cross-test pollution
        const fakeEditor = (fsPath: string, start = 0, end = start) => ({
            document: { uri: { scheme: 'file', fsPath, path: fsPath } },
            selection: { isEmpty: start === end, start: { line: start }, end: { line: end } },
        });
        const contexts = (webview: { posted: Posted[] }): Ctx[] =>
            (webview.posted.filter((m) => m.type === 'contexts').pop()?.contexts as Ctx[]) ?? [];

        beforeEach(() => { win.activeTextEditor = undefined; });
        afterEach(() => { win.activeTextEditor = undefined; });

        it('attaches the active file by default', () => {
            const { webview } = make();
            win.activeTextEditor = fakeEditor('src/t1.ts');
            ChatPanel.syncAutoContext();
            expect(contexts(webview)).toContainEqual(expect.objectContaining({ id: 'auto', auto: true, type: 'file', path: 'src/t1.ts' }));
        });

        it('attaches the selection (1-based) when there is one', () => {
            const { webview } = make();
            win.activeTextEditor = fakeEditor('src/t2.ts', 2, 5);
            ChatPanel.syncAutoContext();
            expect(contexts(webview)).toContainEqual(expect.objectContaining({ type: 'selection', path: 'src/t2.ts', lineRange: '3-6', auto: true }));
        });

        it('replaces the auto entry when the active editor changes', () => {
            const { webview } = make();
            win.activeTextEditor = fakeEditor('src/t3a.ts');
            ChatPanel.syncAutoContext();
            win.activeTextEditor = fakeEditor('src/t3b.ts');
            ChatPanel.syncAutoContext();
            const auto = contexts(webview).filter((c) => c.auto);
            expect(auto).toHaveLength(1);
            expect(auto[0].path).toBe('src/t3b.ts');
        });

        it('does not duplicate a manually attached identical ref', () => {
            const { webview } = make();
            webview.emit({ type: 'attachPath', path: 'src/t4.ts' });
            win.activeTextEditor = fakeEditor('src/t4.ts');
            ChatPanel.syncAutoContext();
            const forFile = contexts(webview).filter((c) => c.path === 'src/t4.ts');
            expect(forFile).toHaveLength(1);
            expect(forFile[0].auto).toBeFalsy();
        });

        it('stays removed for the same document after the user removes the chip', () => {
            const { webview } = make();
            win.activeTextEditor = fakeEditor('src/t5.ts');
            ChatPanel.syncAutoContext();
            expect(contexts(webview).some((c) => c.auto)).toBe(true);

            webview.emit({ type: 'removeContext', id: 'auto' });
            expect(contexts(webview).some((c) => c.auto)).toBe(false);

            ChatPanel.syncAutoContext();
            expect(contexts(webview).some((c) => c.auto)).toBe(false);
        });

        it('re-attaches after switching to another document', () => {
            const { webview } = make();
            win.activeTextEditor = fakeEditor('src/t6a.ts');
            ChatPanel.syncAutoContext();
            webview.emit({ type: 'removeContext', id: 'auto' });

            win.activeTextEditor = fakeEditor('src/t6b.ts');
            ChatPanel.syncAutoContext();
            expect(contexts(webview)).toContainEqual(expect.objectContaining({ path: 'src/t6b.ts', auto: true }));
        });
    });

    // Core contract of the event bridge: the extension only changes presentation; content always follows pi's authoritative messages.
    describe('agent event bridge', () => {
        type EventSink = { _onAgentEvent(event: unknown): void };
        const push = (panel: ChatPanel, event: unknown): void =>
            (panel as unknown as EventSink)._onAgentEvent(event);

        const chunks = (webview: { posted: Posted[] }): string =>
            webview.posted.filter((m) => m.type === 'assistantChunk').map((m) => String(m.text ?? '')).join('');

        const thinking = (webview: { posted: Posted[] }): string =>
            webview.posted.filter((m) => m.type === 'thinkingDelta').map((m) => String(m.text ?? '')).join('');

        it('streams text and closes the bubble on text_end', () => {
            const { webview, panel } = make();
            push(panel, { type: 'agent_start' });
            push(panel, { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'hel' } });
            push(panel, { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'lo' } });
            push(panel, { type: 'message_update', assistantMessageEvent: { type: 'text_end', content: 'hello' } });
            expect(chunks(webview)).toBe('hello');
            expect(webview.posted.filter((m) => m.type === 'assistantStart')).toHaveLength(1);
            expect(webview.posted.filter((m) => m.type === 'assistantEnd')).toHaveLength(1);
        });

        it('text_end fills in a text block that never arrived as deltas', () => {
            const { webview, panel } = make();
            push(panel, { type: 'agent_start' });
            push(panel, { type: 'message_update', assistantMessageEvent: { type: 'text_end', content: 'non-streamed answer' } });
            expect(chunks(webview)).toBe('non-streamed answer');
        });

        it('text_end only sends the missing tail of a partial stream', () => {
            const { webview, panel } = make();
            push(panel, { type: 'agent_start' });
            push(panel, { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'part1 ' } });
            push(panel, { type: 'message_update', assistantMessageEvent: { type: 'text_end', content: 'part1 part2' } });
            expect(chunks(webview)).toBe('part1 part2');
        });

        it('thinking_end fills in thinking that never arrived as deltas', () => {
            const { webview, panel } = make();
            push(panel, { type: 'agent_start' });
            // Provider adapters use content, the pi-messages channel uses thinking; both must be handled
            push(panel, { type: 'message_update', assistantMessageEvent: { type: 'thinking_end', content: 'deep ' } });
            push(panel, { type: 'message_update', assistantMessageEvent: { type: 'thinking_end', thinking: 'thought' } });
            expect(thinking(webview)).toBe('deep thought');
        });

        it('message_end re-sends assistant text that was never streamed', () => {
            const { webview, panel } = make();
            push(panel, { type: 'agent_start' });
            push(panel, { type: 'message_start', message: { role: 'assistant', content: [] } });
            push(panel, { type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'recovered' }] } });
            expect(chunks(webview)).toBe('recovered');
        });

        it('message_end surfaces a failed turn instead of ending silently', () => {
            const { webview, panel } = make();
            push(panel, { type: 'agent_start' });
            push(panel, { type: 'message_start', message: { role: 'assistant', content: [] } });
            push(panel, {
                type: 'message_end',
                message: { role: 'assistant', content: [{ type: 'text', text: '' }], stopReason: 'error', errorMessage: 'Request timed out.' },
            });
            push(panel, { type: 'agent_settled' });
            expect(webview.posted).toContainEqual(expect.objectContaining({ type: 'error', text: 'Request timed out.' }));
        });

        it('failed-turn errors carry actionable buttons (logs, plus retry after a message)', () => {
            const { webview, panel } = make();
            // Simulate the "last user message" (sending would attempt a real connection, so inject it)
            (panel as unknown as { _lastUserMessage: unknown })._lastUserMessage = { text: 'do it' };
            push(panel, { type: 'agent_start' });
            push(panel, { type: 'message_start', message: { role: 'assistant', content: [] } });
            push(panel, {
                type: 'message_end',
                message: { role: 'assistant', content: [{ type: 'text', text: '' }], stopReason: 'error', errorMessage: 'boom' },
            });
            push(panel, { type: 'agent_settled' });
            const err = webview.posted.filter((m) => m.type === 'error').pop();
            const ids = (err?.actions as Array<{ id: string }>).map((a) => a.id);
            expect(ids).toEqual(expect.arrayContaining(['retry', 'model', 'logs']));
        });

        it('renders a tool call that was never streamed, at turn end', () => {
            const { webview, panel } = make();
            push(panel, { type: 'agent_start' });
            push(panel, { type: 'message_start', message: { role: 'assistant', content: [] } });
            push(panel, {
                type: 'message_end',
                message: { role: 'assistant', content: [{ type: 'toolCall', id: 'c1', name: 'bash', arguments: { command: 'ls' } }] },
            });
            // message_end precedes tool_execution_start: don't build the card yet or it would duplicate
            expect(webview.posted.filter((m) => m.type === 'toolCall')).toHaveLength(0);
            push(panel, { type: 'agent_settled' });
            expect(webview.posted).toContainEqual({
                type: 'toolCall', tool: 'bash', detail: 'ls', toolArgs: '{\n  "command": "ls"\n}', toolCallId: 'c1',
            });
        });

        it('does not duplicate a tool card that was already streamed', () => {
            const { webview, panel } = make();
            push(panel, { type: 'agent_start' });
            push(panel, { type: 'tool_execution_start', toolName: 'bash', toolCallId: 'c1', args: { command: 'ls' } });
            push(panel, { type: 'message_start', message: { role: 'assistant', content: [] } });
            push(panel, {
                type: 'message_end',
                message: { role: 'assistant', content: [{ type: 'toolCall', id: 'c1', name: 'bash', arguments: { command: 'ls' } }] },
            });
            push(panel, { type: 'agent_settled' });
            expect(webview.posted.filter((m) => m.type === 'toolCall' && m.toolCallId === 'c1')).toHaveLength(1);
        });

        it('renders a tool result even when its card was never created', () => {
            const { webview, panel } = make();
            push(panel, { type: 'agent_start' });
            push(panel, {
                type: 'message_end',
                message: {
                    role: 'toolResult', toolCallId: 'c1', toolName: 'edit', isError: false, durationMs: 12,
                    content: [{ type: 'text', text: 'ok' }], details: { diff: '-a\n+b' },
                },
            });
            expect(webview.posted).toContainEqual({ type: 'toolCall', tool: 'edit', detail: '', toolCallId: 'c1' });
            expect(webview.posted).toContainEqual({
                type: 'toolEnd', tool: 'edit', toolCallId: 'c1', isError: false, durationMs: 12,
                diff: '-a\n+b', output: 'ok', truncated: false,
            });
        });

        it('a successful write shows up in the turn changes with a diff', () => {
            const { webview, panel } = make();
            push(panel, { type: 'agent_start' });
            push(panel, { type: 'tool_execution_start', toolName: 'write', toolCallId: 'w1', args: { path: 'tmp/__pi_test_new_file__.ts', content: 'a\nb' } });
            push(panel, { type: 'tool_execution_end', toolName: 'write', toolCallId: 'w1', isError: false, result: {} });
            push(panel, { type: 'agent_settled' });
            const files = (webview.posted.filter((m) => m.type === 'turnChanges').pop()?.turnFiles as Array<{ path: string; diff?: string }>) ?? [];
            const entry = files.find((f) => f.path === 'tmp/__pi_test_new_file__.ts');
            expect(entry).toBeTruthy();
            expect(entry?.diff).toContain('+a');
        });

        it('a failed write is not counted as a changed file', () => {
            const { webview, panel } = make();
            push(panel, { type: 'agent_start' });
            push(panel, { type: 'tool_execution_start', toolName: 'write', toolCallId: 'w2', args: { path: 'tmp/__pi_test_failed__.ts', content: 'x' } });
            push(panel, { type: 'tool_execution_end', toolName: 'write', toolCallId: 'w2', isError: true, result: {} });
            push(panel, { type: 'agent_settled' });
            const files = (webview.posted.filter((m) => m.type === 'turnChanges').pop()?.turnFiles as Array<{ path: string }>) ?? [];
            expect(files.some((f) => f.path === 'tmp/__pi_test_failed__.ts')).toBe(false);
        });

        it('agent_settled finalises tool cards and resets the ledger', () => {
            const { webview, panel } = make();
            push(panel, { type: 'agent_start' });
            push(panel, { type: 'agent_settled' });
            expect(webview.posted).toContainEqual({ type: 'toolSettle' });
        });

        it('every panel receives the full stream (no shared render state)', () => {
            const a = make();
            const b = make();
            const events = [
                { type: 'agent_start' },
                { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'part1 ' } },
                { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'part2' } },
                { type: 'message_update', assistantMessageEvent: { type: 'text_end', content: 'part1 part2' } },
            ];
            for (const e of events) { push(a.panel, e); push(b.panel, e); }
            expect(chunks(a.webview)).toBe('part1 part2');
            expect(chunks(b.webview)).toBe('part1 part2');
            expect(b.webview.posted.filter((m) => m.type === 'assistantStart')).toHaveLength(1);
        });
    });
});
