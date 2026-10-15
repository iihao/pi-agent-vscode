// ---------------------------------------------------------------------------
// Preferred model
//
// pi's `set_model` is session-scoped, and a brand-new session starts on the
// first entry of the model list. Without re-applying the user's choice the
// composer announced one model while the new session answered with another.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ChatPanel } from './chatPanel';
import type { PiRpcClient } from './sdk/piTypes';
import type { ChatRuntime } from './chatPanel/runtime';
import { preferredModel, rememberModel, forgetModelPreference } from './chatPanel/modelPreference';
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

/** A pi session stub whose model actually changes when setModel is called */
function fakeSession(current: string) {
    const [p, i] = current.split('/');
    const setCalls: Array<{ provider: string; id: string }> = [];
    const available = [
        { provider: 'cc-switch-longcat', id: 'LongCat-2.0' },
        { provider: 'cc-switch-open-code-go', id: 'deepseek-v4.1-flash' },
        { provider: 'cc-switch-qianwen', id: 'deepseek-v4-pro' },
    ];
    let model = { provider: p, id: i };
    const client: Record<string, unknown> = {
        getState: () => Promise.resolve({ sessionId: 's1', sessionFile: '/tmp/s.jsonl', model, thinkingLevel: 'medium' }),
        getAvailableModels: () => Promise.resolve(available),
        setModel: (provider: string, id: string) => {
            setCalls.push({ provider, id });
            model = { provider, id };
            return Promise.resolve({ provider, id });
        },
        getEntries: () => Promise.resolve({ entries: [], leafId: undefined }),
    };
    return { client: client as unknown as PiRpcClient, setCalls, available };
}

interface ModelInternals {
    _applyPreferredModel(client: PiRpcClient): Promise<void>;
    _handleSetModel(provider: string, id: string): Promise<void>;
    cycleModel(): Promise<void>;
    _runtime: ChatRuntime;
}

describe('preferred model', () => {
    const panels: ChatPanel[] = [];
    /** A session that never ran has no session file: pi creates it on first write */
    let dir = '';
    let ranSession = '';
    /** Same directory, file deliberately absent */
    let freshSessionFile = '';

    beforeEach(() => {
        forgetModelPreference();
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-model-'));
        ranSession = path.join(dir, 'ran.jsonl');
        freshSessionFile = path.join(dir, 'fresh.jsonl');
        fs.writeFileSync(ranSession, '{"type":"session","id":"x"}\n');
    });
    afterEach(() => {
        panels.splice(0).forEach((p) => p.dispose());
        (vscodeMock.window as { activeTextEditor?: unknown }).activeTextEditor = undefined;
        ChatPanel.resetRuntimesForTest();
        forgetModelPreference();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    function make() {
        const webview = makeWebview();
        const panel = ChatPanel.create(
            webview as unknown as import('vscode').Webview,
            '/ext',
            disposeEvent as unknown as import('vscode').Event<void>,
        );
        panels.push(panel);
        return { webview, panel, inner: panel as unknown as ModelInternals };
    }

    /** pi's own state after a brand-new session: the first model of the list */
    const freshSession = 'cc-switch-longcat/LongCat-2.0';

    it('applies the remembered model to a brand-new session', async () => {
        const { webview, inner } = make();
        const { client, setCalls } = fakeSession(freshSession);
        inner._runtime.sessionFile = freshSessionFile;
        rememberModel('cc-switch-open-code-go', 'deepseek-v4.1-flash');

        await inner._applyPreferredModel(client);

        expect(setCalls).toEqual([{ provider: 'cc-switch-open-code-go', id: 'deepseek-v4.1-flash' }]);
        // And the composer is told, so the label cannot disagree with the session
        const models = webview.posted.filter((m) => m.type === 'models').pop();
        expect(models?.current).toEqual({ provider: 'cc-switch-open-code-go', id: 'deepseek-v4.1-flash' });
    });

    it('leaves a session that already ran on its own model', async () => {
        const { inner } = make();
        const { client, setCalls } = fakeSession('cc-switch-qianwen/deepseek-v4-pro');
        inner._runtime.sessionFile = ranSession;
        rememberModel('cc-switch-open-code-go', 'deepseek-v4.1-flash');

        await inner._applyPreferredModel(client);

        // pi restores the model from the session log; overriding it would rewrite
        // what that conversation actually used
        expect(setCalls).toEqual([]);
    });

    it('does nothing when the session already uses the remembered model', async () => {
        const { inner } = make();
        const { client, setCalls } = fakeSession('cc-switch-open-code-go/deepseek-v4.1-flash');
        inner._runtime.sessionFile = freshSessionFile;
        rememberModel('cc-switch-open-code-go', 'deepseek-v4.1-flash');

        await inner._applyPreferredModel(client);

        expect(setCalls).toEqual([]);
    });

    it('does nothing when no model was ever picked', async () => {
        const { inner } = make();
        const { client, setCalls } = fakeSession(freshSession);
        inner._runtime.sessionFile = freshSessionFile;

        await inner._applyPreferredModel(client);

        expect(setCalls).toEqual([]);
    });

    it('skips a remembered model that this provider set does not offer', async () => {
        const { inner } = make();
        const { client, setCalls } = fakeSession(freshSession);
        inner._runtime.sessionFile = freshSessionFile;
        rememberModel('some-other-gateway', 'gpt-9');

        await inner._applyPreferredModel(client);

        expect(setCalls).toEqual([]);
    });

    it('remembers what the composer picks', async () => {
        const { inner } = make();
        const { client } = fakeSession(freshSession);
        (inner._runtime as unknown as { clientManager: { client: unknown } }).clientManager = { client } as never;
        expect(preferredModel()).toBeUndefined();

        await inner._handleSetModel('cc-switch-qianwen', 'deepseek-v4-pro');

        expect(preferredModel()).toEqual({ provider: 'cc-switch-qianwen', id: 'deepseek-v4-pro' });
    });

    it('also applies when the first panel starts the very first session', async () => {
        const { inner } = make();
        const { client, setCalls } = fakeSession(freshSession);
        // `--continue` in a workspace with no sessions: pi starts a fresh one and
        // there is no session file yet
        inner._runtime.sessionFile = undefined;
        rememberModel('cc-switch-open-code-go', 'deepseek-v4.1-flash');

        await inner._applyPreferredModel(client);

        expect(setCalls).toEqual([{ provider: 'cc-switch-open-code-go', id: 'deepseek-v4.1-flash' }]);
    });
});
