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
import { ChatRuntime } from './chatPanel/runtime';
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

    /** Drive pi's authoritative message through the panel's event bridge */
    function emitMessageEnd(panel: ChatPanel, message: Record<string, unknown>): void {
        (panel as unknown as { _onAgentEvent(e: unknown): void })._onAgentEvent({ type: 'message_end', message });
    }

    function abortViaWebview(webview: ReturnType<typeof makeWebview>): void {
        webview.emit({ type: 'abort' });
    }

    it('reports a stopped turn as a stop even when pi calls it an error', async () => {
        const { webview, panel, inner } = (() => {
            const webview = makeWebview();
            const panel = ChatPanel.create(
                webview as unknown as import('vscode').Webview,
                '/ext',
                disposeEvent as unknown as import('vscode').Event<void>,
            );
            panels.push(panel);
            const rt = panel as unknown as TurnInternals;
            rt._runtime.clientManager = { abort: () => Promise.resolve(), clearQueue: () => Promise.resolve() };
            return { webview, panel, inner: rt };
        })();
        inner._busy = true;
        abortViaWebview(webview);
        await new Promise((resolve) => setTimeout(resolve, 0));

        // This is what pi actually sends when the abort lands between turns: an
        // empty message with AbortError text and no stopReason
        emitMessageEnd(panel, { role: 'assistant', content: [], errorMessage: 'This operation was aborted' });

        expect(webview.posted.filter((m) => m.type === 'error')).toEqual([]);
        const notices = webview.posted.filter((m) => m.type === 'notice').map((m) => m.text);
        expect(notices).toContain('Stopped');
    });

    it('still reports a failure that was not stopped', () => {
        const { webview, panel } = (() => {
            const webview = makeWebview();
            const panel = ChatPanel.create(
                webview as unknown as import('vscode').Webview,
                '/ext',
                disposeEvent as unknown as import('vscode').Event<void>,
            );
            panels.push(panel);
            return { webview, panel };
        })();

        emitMessageEnd(panel, { role: 'assistant', content: [], errorMessage: 'Provider returned 500' });

        expect(webview.posted.filter((m) => m.type === 'error').map((m) => m.text)).toEqual(['Provider returned 500']);
    });

    it('stops treating a failure as a stop once the stop has settled', async () => {
        const { webview, panel, inner } = (() => {
            const webview = makeWebview();
            const panel = ChatPanel.create(
                webview as unknown as import('vscode').Webview,
                '/ext',
                disposeEvent as unknown as import('vscode').Event<void>,
            );
            panels.push(panel);
            const rt = panel as unknown as TurnInternals;
            rt._runtime.clientManager = { abort: () => Promise.resolve(), clearQueue: () => Promise.resolve() };
            return { webview, panel, inner: rt };
        })();
        inner._busy = true;
        abortViaWebview(webview);
        await new Promise((resolve) => setTimeout(resolve, 0));
        (panel as unknown as { _onAgentEvent(e: unknown): void })._onAgentEvent({ type: 'agent_settled' });

        emitMessageEnd(panel, { role: 'assistant', content: [], errorMessage: 'Provider returned 500' });

        expect(webview.posted.filter((m) => m.type === 'error').map((m) => m.text)).toEqual(['Provider returned 500']);
    });

    it('replaces a crashed client even when the failure followed a stop', async () => {
        const webview = makeWebview();
        const panel = ChatPanel.create(
            webview as unknown as import('vscode').Webview,
            '/ext',
            disposeEvent as unknown as import('vscode').Event<void>,
        );
        panels.push(panel);
        const inner = panel as unknown as TurnInternals & {
            _stopRequested: boolean;
            _handleUserMessage(text: string): Promise<void>;
            _buildAutoContext(): Promise<string[]>;
            _runtime: ChatRuntime & { clientManager: unknown };
        };
        inner._buildAutoContext = () => Promise.resolve([]);
        let restarted = 0;
        const crashed = Object.assign(new Error('spawn pi ENOENT'), { code: 'ENOENT' });
        const client = { prompt: () => Promise.reject(crashed) };
        inner._runtime.clientManager = {
            client,
            isConnected: true,
            ensureConnected: () => Promise.resolve(client as unknown as PiRpcClient),
            stop: () => { restarted++; return Promise.resolve(); },
            abort: () => Promise.resolve(),
            onEvent: () => () => { /* noop */ },
        };
        // A stop can be exactly what reveals that the process is gone
        inner._stopRequested = true;

        await inner._handleUserMessage('hello');
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(restarted).toBe(1);
        expect(webview.posted.filter((m) => m.type === 'error')).toEqual([]);
    });

    it('does not carry a stop from one session into the next', () => {
        const webview = makeWebview();
        const panel = ChatPanel.create(
            webview as unknown as import('vscode').Webview,
            '/ext',
            disposeEvent as unknown as import('vscode').Event<void>,
        );
        panels.push(panel);
        const inner = panel as unknown as { _stopRequested: boolean; _bindRuntime(r: ChatRuntime): void };
        inner._stopRequested = true;

        inner._bindRuntime(new ChatRuntime());
        emitMessageEnd(panel, { role: 'assistant', content: [], errorMessage: 'Provider returned 500' });

        expect(webview.posted.filter((m) => m.type === 'error').map((m) => m.text)).toEqual(['Provider returned 500']);
    });
});
