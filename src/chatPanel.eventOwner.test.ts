// ---------------------------------------------------------------------------
// Event ownership handoff on a shared runtime
//
// Cross-check for the host-side fix of review item A5. The mechanism is "the
// first live panel owns the non-presentation effects of pi events" (shared
// runtime state, host modals, system notifications — the things that must happen
// once per event, not once per panel).
//
// Its safety depends entirely on ownership moving on when that panel goes away:
// `dispose()` has to drop the panel from `runtime.panels`, otherwise the
// surviving panels would never record turn changes, never show pi's dialogs and
// never notify again. The other cases of A5 are covered by
// `chatPanel.sharedRuntime.test.ts`.
// ---------------------------------------------------------------------------

import { describe, it, expect, afterEach } from 'vitest';
import { ChatPanel } from './chatPanel';
import type { ChatRuntime } from './chatPanel/runtime';
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

interface OwnerInternals {
    _isEventOwner: boolean;
    _onAgentEvent(e: unknown): void;
    _bindRuntime(r: ChatRuntime): void;
    _runtime: ChatRuntime & { clientManager: unknown };
    _refreshAuthStatus(): Promise<void>;
}

describe('event ownership handoff', () => {
    const panels: ChatPanel[] = [];
    afterEach(() => {
        panels.splice(0).forEach((p) => p.dispose());
        (vscodeMock.window as { activeTextEditor?: unknown }).activeTextEditor = undefined;
        ChatPanel.resetRuntimesForTest();
    });

    function makePanel(surface: string) {
        const webview = makeWebview();
        const panel = ChatPanel.create(
            webview as unknown as import('vscode').Webview,
            '/ext',
            disposeEvent as unknown as import('vscode').Event<void>,
            surface,
        );
        panels.push(panel);
        const inner = panel as unknown as OwnerInternals;
        inner._refreshAuthStatus = () => Promise.resolve();
        inner._runtime.clientManager = {
            client: { send: () => Promise.resolve(), getState: () => Promise.resolve({}) },
            isConnected: true,
            abort: () => Promise.resolve(),
            stop: () => Promise.resolve(),
            ensureConnected: () => Promise.resolve({ send: () => Promise.resolve() }),
            onEvent: () => () => { /* noop */ },
        };
        return { webview, panel, inner };
    }

    it('hands ownership to the next panel when the owner goes away', () => {
        const a = makePanel('owner-a');
        const b = makePanel('owner-b');
        // The supported "sidebar + editor tab on one session" arrangement
        b.inner._bindRuntime(a.inner._runtime);
        expect(a.inner._isEventOwner).toBe(true);
        expect(b.inner._isEventOwner).toBe(false);

        a.panel.dispose();

        expect(b.inner._isEventOwner).toBe(true);
        // …and the surviving panel still records into the shared turn state
        b.inner._onAgentEvent({
            type: 'tool_execution_start',
            toolName: 'edit',
            toolCallId: 'call-1',
            args: { path: 'src/a.ts', edits: [{ oldText: 'a', newText: 'b' }] },
        });
        const changes = b.inner._runtime.state.turnChanges;
        expect(changes).toHaveLength(1);
        expect(changes[0].edits).toHaveLength(1);
    });
});
