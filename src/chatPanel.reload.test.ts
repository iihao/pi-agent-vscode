// ---------------------------------------------------------------------------
// Reloading a session
//
// Reloading replaces the pi process, so it must (a) never throw a running turn
// away without asking, (b) abort gracefully instead of killing mid-write, and
// (c) touch only the session it belongs to.
// ---------------------------------------------------------------------------

import { describe, it, expect, afterEach } from 'vitest';
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
        asWebviewUri: (_uri: unknown) => ({ toString: () => 'vscode-resource://media/main.js' }),
        onDidReceiveMessage: (cb: (m: unknown) => void) => { onMessage = cb; return { dispose() { /* noop */ } }; },
        postMessage: (m: Posted) => { posted.push(m); return Promise.resolve(true); },
        posted,
        emit: (m: unknown) => { if (onMessage) { onMessage(m); } },
    };
}

const disposeEvent = (_l: () => void, _t?: unknown, disposables?: { dispose(): void }[]) => {
    const d = { dispose() { /* noop */ } };
    if (disposables) { disposables.push(d); }
    return d;
};

interface ReloadInternals {
    _busy: boolean;
    _webviewSynced: boolean;
    restartClient(): Promise<boolean>;
    _ensureClient(): Promise<void>;
    _refreshAuthStatus(): Promise<void>;
    _runtime: ChatRuntime & { clientManager: unknown };
}

/** A client manager stub: counts stop()/abort() and returns a quiet fake client */
function stubManager() {
    const calls = { stop: 0, abort: 0 };
    const client = {
        getState: () => Promise.resolve({ sessionId: 's1', sessionFile: '/tmp/s.jsonl', isStreaming: false }),
        getAvailableModels: () => Promise.resolve([]),
        getEntries: () => Promise.resolve({ entries: [], leafId: undefined }),
        waitForIdle: () => Promise.resolve(),
    };
    return {
        calls,
        manager: {
            client,
            isConnected: true,
            stop: () => { calls.stop++; return Promise.resolve(); },
            abort: () => { calls.abort++; return Promise.resolve(); },
            ensureConnected: () => Promise.resolve(client),
            onEvent: () => () => { /* noop */ },
        },
    };
}

describe('reloading a session', () => {
    const panels: ChatPanel[] = [];
    afterEach(() => {
        panels.splice(0).forEach((p) => p.dispose());
        (vscodeMock.window as { activeTextEditor?: unknown }).activeTextEditor = undefined;
        ChatPanel.resetRuntimesForTest();
    });

    function make() {
        const webview = makeWebview();
        const panel = ChatPanel.create(
            webview as unknown as import('vscode').Webview,
            '/ext',
            disposeEvent as unknown as import('vscode').Event<void>,
        );
        panels.push(panel);
        const inner = panel as unknown as ReloadInternals;
        inner._refreshAuthStatus = () => Promise.resolve();
        return { webview, panel, inner };
    }

    it('asks before interrupting a running turn, and reloads when confirmed', async () => {
        const { inner } = make();
        const { calls, manager } = stubManager();
        inner._runtime.clientManager = manager;
        inner._busy = true;

        // The vscode mock answers with the last (affirmative) button
        const reloaded = await inner.restartClient();

        expect(reloaded).toBe(true);
        // Graceful abort first, so the turn's entries reach the session file
        expect(calls.abort).toBe(1);
        expect(calls.stop).toBe(1);
        expect(inner._busy).toBe(false);
    });

    it('leaves the session alone when the confirmation is declined', async () => {
        const { inner } = make();
        const { calls, manager } = stubManager();
        inner._runtime.clientManager = manager;
        inner._busy = true;

        const original = (vscodeMock.window as { showWarningMessage: unknown }).showWarningMessage;
        (vscodeMock.window as { showWarningMessage: unknown }).showWarningMessage = () => Promise.resolve(undefined);
        try {
            expect(await inner.restartClient()).toBe(false);
        } finally {
            (vscodeMock.window as { showWarningMessage: unknown }).showWarningMessage = original;
        }

        expect(calls.abort).toBe(0);
        expect(calls.stop).toBe(0);
        expect(inner._busy).toBe(true);
    });

    it('reloads an idle session without prompting', async () => {
        const { inner } = make();
        const { calls, manager } = stubManager();
        inner._runtime.clientManager = manager;
        inner._busy = false;

        let warned = 0;
        const original = (vscodeMock.window as { showWarningMessage: unknown }).showWarningMessage;
        (vscodeMock.window as { showWarningMessage: unknown }).showWarningMessage = () => { warned++; return Promise.resolve(undefined); };
        try {
            expect(await inner.restartClient()).toBe(true);
        } finally {
            (vscodeMock.window as { showWarningMessage: unknown }).showWarningMessage = original;
        }

        expect(warned).toBe(0);
        expect(calls.stop).toBe(1);
    });

    it('aborts every running runtime before a settings-driven restart', async () => {
        const { inner } = make();
        const { calls, manager } = stubManager();
        inner._runtime.clientManager = manager;
        inner._busy = true;

        await ChatPanel.restartAllClients();

        expect(calls.abort).toBe(1);
        expect(calls.stop).toBe(1);
    });

    it('tells every panel on the runtime when the shared busy state changes', async () => {
        const a = make();
        const b = make();
        // Bind both panels to one runtime (the same session, two views)
        (b.panel as unknown as { _bindRuntime(r: ChatRuntime): void })._bindRuntime(a.inner._runtime);
        const { manager } = stubManager();
        a.inner._runtime.clientManager = manager;

        await a.inner._ensureClient();

        // Both webviews learn the turn ended, not just the panel that reconnected
        const busy = (w: ReturnType<typeof makeWebview>) => w.posted.filter((m) => m.type === 'setBusy').map((m) => m.busy);
        expect(busy(a.webview)).toContain(false);
        expect(busy(b.webview)).toContain(false);
    });

    it('re-reads the session directory on refreshSessions', async () => {
        const { webview, inner } = make();
        const { manager } = stubManager();
        inner._runtime.clientManager = manager;

        webview.emit({ type: 'refreshSessions' });
        await new Promise((resolve) => setTimeout(resolve, 0));

        // The list is re-sent so another pi process's changes show up without a reload
        expect(webview.posted.some((m) => m.type === 'sessions')).toBe(true);
    });

    it('marks a rebuild clear as booting so the webview keeps its bare empty state', async () => {
        const { webview, inner } = make();
        const { manager } = stubManager();
        inner._runtime.clientManager = manager;

        await inner.restartClient();

        const clear = webview.posted.find((m) => m.type === 'clear');
        // The transcript is read back afterwards, so nothing must be promised yet
        expect(clear?.boot).toBe(true);
    });

    it('marks a user-initiated clear as settled, since the new session is empty', async () => {
        const { webview, panel } = make();
        const { manager } = stubManager();
        (panel as unknown as { _runtime: { clientManager: unknown } })._runtime.clientManager = manager;

        await panel.clear();

        const clear = webview.posted.find((m) => m.type === 'clear');
        expect(clear?.boot).toBe(false);
    });
});
