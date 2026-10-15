// ---------------------------------------------------------------------------
// Panels sharing one runtime (e.g. the sidebar and an editor tab switched to
// the same session)
//
// Every bound panel subscribes to the same pi client, so each event is handled
// once per panel. That must stay true for rendering (each webview streams its
// own copy) but must NOT happen for anything outside the transcript: shared
// runtime state (turn-change records), host modals, and system notifications.
// ---------------------------------------------------------------------------

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ChatPanel } from './chatPanel';
import type { ChatRuntime } from './chatPanel/runtime';
import type { PiRpcClient } from './sdk/piTypes';
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

/** Two panels on one surface slot share one runtime; both receive every event */
function makePair() {
    const webA = makeWebview();
    const webB = makeWebview();
    const a = ChatPanel.create(webA as unknown as import('vscode').Webview, '/ext', disposeEvent as unknown as import('vscode').Event<void>);
    const b = ChatPanel.create(webB as unknown as import('vscode').Webview, '/ext', disposeEvent as unknown as import('vscode').Event<void>);
    const rtA = (a as unknown as { _runtime: ChatRuntime })._runtime;
    const rtB = (b as unknown as { _runtime: ChatRuntime })._runtime;
    expect(rtB).toBe(rtA); // same surface key -> same runtime
    const evt = (p: ChatPanel, e: unknown) => { (p as unknown as { _onAgentEvent(e: unknown): void })._onAgentEvent(e); };
    return { webA, webB, a, b, rt: rtA, evt };
}

describe('panels sharing a runtime', () => {
    afterEach(() => {
        (vscodeMock.window as { activeTextEditor?: unknown }).activeTextEditor = undefined;
        ChatPanel.currentView = undefined;
        // panels keep static state; drop them all
        (ChatPanel as unknown as { _instances: ChatPanel[] })._instances.splice(0).forEach((p) => p.dispose());
        ChatPanel.resetRuntimesForTest();
        vi.useRealTimers();
    });

    it('records a tool edit into the shared turn state exactly once', () => {
        const { webA, webB, a, b, evt } = makePair();
        const start = {
            type: 'tool_execution_start',
            toolName: 'edit',
            toolCallId: 't1',
            args: { path: 'a.txt', edits: [{ oldText: 'x', newText: 'y' }] },
        };
        // The client dispatches one event to every bound panel
        evt(a, start);
        evt(b, start);

        const changes = (a as unknown as { _turnChanges: Array<{ rel: string; edits: unknown[] }> })._turnChanges;
        expect(changes.length).toBe(1);
        // Before the fix the second panel concatenated the same edits again, and
        // reverting then failed ("the edit no longer matches")
        expect(changes[0].edits.length).toBe(1);

        // Presentation stays per panel: both webviews must have the card
        expect(webA.posted.filter((m) => m.type === 'toolCall').length).toBe(1);
        expect(webB.posted.filter((m) => m.type === 'toolCall').length).toBe(1);
    });

    it('shows an extension_ui_request dialog once, not once per panel', () => {
        const { a, b, evt } = makePair();
        const spyA = vi.fn(() => Promise.resolve());
        const spyB = vi.fn(() => Promise.resolve());
        (a as unknown as { _handleExtensionUI: unknown })._handleExtensionUI = spyA;
        (b as unknown as { _handleExtensionUI: unknown })._handleExtensionUI = spyB;

        evt(a, { type: 'extension_ui_request', id: 'r1', method: 'confirm', title: 'Allow?' });
        evt(b, { type: 'extension_ui_request', id: 'r1', method: 'confirm', title: 'Allow?' });

        expect(spyA.mock.calls.length + spyB.mock.calls.length).toBe(1);
        expect(spyA).toHaveBeenCalledTimes(1); // the first live panel owns it
    });

    it('reconnects with the runtime session options when sending a message', async () => {
        const { a } = makePair();
        const inner = a as unknown as {
            _runtime: ChatRuntime & { clientManager: unknown };
            _buildAutoContext(): Promise<string[]>;
            _handleUserMessage(text: string): Promise<void>;
        };
        inner._buildAutoContext = () => Promise.resolve([]);
        const startOptions = { continueRecent: false };
        inner._runtime.startOptions = startOptions;
        let seenOptions: unknown = 'NOT_CALLED';
        const client = { prompt: () => Promise.resolve('started') };
        inner._runtime.clientManager = {
            client,
            isConnected: true,
            ensureConnected: (_ext: string, opts?: unknown) => { seenOptions = opts; return Promise.resolve(client as unknown as PiRpcClient); },
            abort: () => Promise.resolve(),
            onEvent: () => () => { /* noop */ },
        };

        await inner._handleUserMessage('hello');
        // Without the options, a crashed "new session" runtime reconnects with
        // --continue and joins whatever session pi considers most recent
        expect(seenOptions).toBe(startOptions);
    });

    it('unlocks every panel when a stop never settles', async () => {
        vi.useFakeTimers();
        const { webA, webB, a } = makePair();
        const inner = a as unknown as { _runtime: ChatRuntime & { clientManager: unknown }; _busy: boolean };
        inner._runtime.clientManager = {
            client: { clearQueue: () => Promise.resolve({ steering: [], followUp: [] }) },
            abort: () => Promise.resolve(),
            onEvent: () => () => { /* noop */ },
        };
        inner._busy = true;

        // The Stop button (webview "abort") must arm the recovery fallback too
        webA.emit({ type: 'abort' });
        await vi.advanceTimersByTimeAsync(100);   // let the abort/clearQueue promises settle
        await vi.advanceTimersByTimeAsync(31_000); // past ABORT_RECOVERY_MS

        expect(webB.posted.filter((m) => m.type === 'setBusy').map((m) => m.busy)).toContain(false);
        expect(webA.posted.filter((m) => m.type === 'setBusy').map((m) => m.busy)).toContain(false);
        expect(webB.posted.filter((m) => m.type === 'toolSettle').length).toBe(1);
        // and the queued-badge clear is broadcast as well
        expect(webB.posted.filter((m) => m.type === 'queue').length).toBe(1);
    });

    it('does not burn the auto-name attempt while the client is missing', async () => {
        const { a, rt } = makePair();
        const inner = a as unknown as { _maybeAutoName(): Promise<void> };
        rt.firstUserMessage = 'please fix the bug';
        (rt as unknown as { sessionManager: unknown }).sessionManager = {
            sessions: [],
            currentSessionId: 's1',
            loadSessions: () => Promise.resolve(),
        };
        // Momentarily no client (still connecting)
        (rt as unknown as { clientManager: unknown }).clientManager = { client: undefined };
        await inner._maybeAutoName();
        expect(rt.autoNameTried.has('s1')).toBe(false);

        // Once the client is here, the session still gets its name
        const setName = vi.fn(() => Promise.resolve());
        (rt as unknown as { clientManager: unknown }).clientManager = {
            client: { setSessionName: setName },
            runOneShot: () => Promise.resolve('Fix the bug'),
        };
        await inner._maybeAutoName();
        expect(setName).toHaveBeenCalledWith('Fix the bug');
    });

    it('opens an absolute full-output path instead of joining it onto the workspace', async () => {
        const { a } = makePair();
        const opened: Array<Record<string, unknown>> = [];
        const original = vscodeMock.workspace.openTextDocument;
        (vscodeMock.workspace as { openTextDocument: unknown }).openTextDocument = (uri: unknown) => {
            opened.push(uri as Record<string, unknown>);
            return Promise.resolve({});
        };
        try {
            await (a as unknown as { _openWorkspaceFile(p: string): Promise<void> })._openWorkspaceFile('/tmp/pi/output-1.log');
            // The truncated-output file lives outside the workspace; it must be
            // opened as-is, not appended to the workspace root
            expect(opened.length).toBe(1);
            expect(opened[0]).toMatchObject({ scheme: 'file', fsPath: '/tmp/pi/output-1.log' });
        } finally {
            (vscodeMock.workspace as { openTextDocument: unknown }).openTextDocument = original;
        }
    });
});
