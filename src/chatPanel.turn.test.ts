// ---------------------------------------------------------------------------
// Long-running turns
//
// Regression test: a 10-minute watchdog force-unlocked the UI while pi was
// still working (the log shows it firing one second after `turn_start`, with
// bash output streaming in), letting the user send into a running turn. How long
// a turn may take is not something this panel can know.
// ---------------------------------------------------------------------------

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ChatPanel } from './chatPanel';
import type { PiRpcClient } from './sdk/piTypes';
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

interface TurnInternals {
    _busy: boolean;
    _handleUserMessage(text: string): Promise<void>;
    _buildAutoContext(): Promise<string[]>;
    _runtime: ChatRuntime & { clientManager: unknown };
}

describe('long-running turns', () => {
    const panels: ChatPanel[] = [];
    afterEach(() => {
        panels.splice(0).forEach((p) => p.dispose());
        (vscodeMock.window as { activeTextEditor?: unknown }).activeTextEditor = undefined;
        ChatPanel.resetRuntimesForTest();
        vi.useRealTimers();
    });

    it('stays busy for as long as pi is working', async () => {
        vi.useFakeTimers();
        const webview = makeWebview();
        const panel = ChatPanel.create(
            webview as unknown as import('vscode').Webview,
            '/ext',
            disposeEvent as unknown as import('vscode').Event<void>,
        );
        panels.push(panel);
        const inner = panel as unknown as TurnInternals;
        inner._buildAutoContext = () => Promise.resolve([]);

        // A turn that is still running: prompt() only resolves when pi is done
        let turnEnded: (v: string) => void = () => { /* set below */ };
        const running = new Promise<string>((resolve) => { turnEnded = resolve; });
        const client = { prompt: () => running };
        inner._runtime.clientManager = {
            client,
            isConnected: true,
            ensureConnected: () => Promise.resolve(client as unknown as PiRpcClient),
            abort: () => Promise.resolve(),
            onEvent: () => () => { /* noop */ },
        };

        const sent = inner._handleUserMessage('long task');
        await vi.advanceTimersByTimeAsync(5000);
        expect(inner._busy).toBe(true);

        // Well past every timeout that used to exist, with pi still working
        await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
        expect(inner._busy).toBe(true);
        expect(webview.posted.filter((m) => m.type === 'error')).toEqual([]);
        expect(webview.posted.filter((m) => m.type === 'setBusy').map((m) => m.busy)).not.toContain(false);

        turnEnded('started');
        await sent;
    });
});
