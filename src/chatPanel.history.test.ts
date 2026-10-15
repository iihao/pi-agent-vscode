// ---------------------------------------------------------------------------
// Transcript replay (session reload / session switch)
//
// Regression tests for "reload the session and most of it disappears": the
// replay must come from pi's own session log (tool cards, diffs, thinking) and
// must not be limited to the last handful of model-context messages.
// ---------------------------------------------------------------------------

import { describe, it, expect, afterEach } from 'vitest';
import { ChatPanel } from './chatPanel';
import type { PiRpcClient, PiRawMessage, PiSessionEntry } from './sdk/piTypes';
import type { HistoryItem } from './chatPanel/types';
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

const disposeEvent = (_listener: () => void, _thisArgs?: unknown, disposables?: { dispose(): void }[]) => {
    const d = { dispose() { /* noop */ } };
    if (disposables) { disposables.push(d); }
    return d;
};

interface HistoryInternals {
    _restoreHistory(client: PiRpcClient): Promise<void>;
    _capHistory(items: HistoryItem[]): { items: HistoryItem[]; hidden: number };
    _webviewSynced: boolean;
    _clearTranscript(boot?: boolean): void;
}

const CONTEXT_BLOCK = [
    '--- pi-extension-context:start ---',
    '<file-context>',
    '@src/a.ts:3-9',
    '</file-context>',
    '--- pi-extension-context:end ---',
].join('\n');

/** pi's session log: a user turn that edits a file, then answers */
function editedFileLog(): PiSessionEntry[] {
    return [
        { id: 'e1', type: 'session' },
        { id: 'e2', parentId: 'e1', type: 'message', message: { role: 'user', content: [{ type: 'text', text: CONTEXT_BLOCK + '\nFix the bug' }] } },
        {
            id: 'e3', parentId: 'e2', type: 'message',
            message: {
                role: 'assistant',
                content: [
                    { type: 'thinking', thinking: 'let me look at the file' },
                    { type: 'toolCall', id: 'call_1', name: 'edit', arguments: { path: 'src/a.ts' } },
                ],
            },
        },
        {
            id: 'e4', parentId: 'e3', type: 'message',
            message: {
                role: 'toolResult', toolCallId: 'call_1', toolName: 'edit', isError: false, durationMs: 12,
                content: [{ type: 'text', text: 'applied' }],
                details: { diff: '@@ -1 +1 @@\n-a\n+b', firstChangedLine: 1 },
            },
        },
        { id: 'e5', parentId: 'e4', type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] } },
    ];
}

function clientWith(log: PiSessionEntry[] | undefined, leafId?: string, messages?: PiRawMessage[]): PiRpcClient {
    const client: Record<string, unknown> = {};
    if (log) { client.getEntries = () => Promise.resolve({ entries: log, leafId }); }
    client.getMessages = () => Promise.resolve(messages ?? []);
    return client as unknown as PiRpcClient;
}

describe('transcript replay', () => {
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
        return { webview, panel, internals: panel as unknown as HistoryInternals };
    }

    function historyItems(webview: ReturnType<typeof makeWebview>): HistoryItem[] {
        const post = webview.posted.find((m) => m.type === 'history');
        return (post?.items as HistoryItem[]) ?? [];
    }

    /** A get_entries call the test releases by hand, to act while it is in flight */
    function gatedEntries() {
        let release!: (v: { entries: PiSessionEntry[] }) => void;
        const gate = new Promise<{ entries: PiSessionEntry[] }>((r) => { release = r; });
        return { client: { getEntries: () => gate } as unknown as PiRpcClient, release };
    }

    it('drops the replay when a live message arrives while the log loads', async () => {
        const { webview, internals } = make();
        const { client, release } = gatedEntries();

        const loading = internals._restoreHistory(client);
        await new Promise((r) => setTimeout(r, 0)); // inside the get_entries await
        // The user sends into the panel before the replay lands
        internals._webviewSynced = true;
        release({ entries: editedFileLog() });
        await loading;

        // Appending the older transcript *below* the live message would scramble
        // the timeline; the session file keeps everything for the next reload
        expect(webview.posted.filter((m) => m.type === 'history')).toEqual([]);
    });

    it('drops the replay when a clear replaces the transcript mid-load', async () => {
        const { webview, internals } = make();
        const { client, release } = gatedEntries();

        const loading = internals._restoreHistory(client);
        await new Promise((r) => setTimeout(r, 0));
        // e.g. "New chat" clicked while this panel was still loading its session
        internals._clearTranscript(false);
        release({ entries: editedFileLog() });
        await loading;

        // Stale items from the previous session must not resurrect themselves in
        // the fresh one…
        expect(webview.posted.filter((m) => m.type === 'history')).toEqual([]);
        // …and the cleared panel must not be marked as holding content
        expect(internals._webviewSynced).toBe(false);
    });

    it('replays every tool card, diff and thinking block from the session log', async () => {
        const { webview, internals } = make();
        await internals._restoreHistory(clientWith(editedFileLog()));

        const items = historyItems(webview);
        expect(items.map((i) => i.kind)).toEqual(['user', 'thinking', 'tool', 'toolResult', 'assistant']);
        expect(items[2]).toMatchObject({ tool: 'edit', detail: 'src/a.ts', toolCallId: 'call_1' });
        expect(items[3]).toMatchObject({ toolCallId: 'call_1', isError: false, durationMs: 12 });
        expect(items[3].diff).toContain('+b');
        expect(items[4].text).toBe('Done.');
        // The internal context block is stripped and echoed as an attachment instead
        expect(items[0].text).toBe('Fix the bug');
        expect(items[0].attachments).toEqual([{ type: 'selection', path: 'src/a.ts', lineRange: '3-9' }]);
    });

    it('follows the current branch instead of replaying abandoned ones', async () => {
        const log = editedFileLog();
        // A branch the user has since left: forked from e2, never merged back
        log.push({ id: 'x1', parentId: 'e2', type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'abandoned' }] } });
        log.push({ id: 'x2', parentId: 'x1', type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'abandoned answer' }] } });

        const { webview, internals } = make();
        await internals._restoreHistory(clientWith(log, 'e5'));

        const texts = historyItems(webview).map((i) => i.text).filter(Boolean);
        expect(texts).not.toContain('abandoned answer');
        expect(texts).toContain('Done.');
    });

    it('keeps a compaction checkpoint visible instead of dropping the summarized range', async () => {
        const log: PiSessionEntry[] = [
            { id: 'e1', type: 'session' },
            { id: 'e2', type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'old work' }] } },
            { id: 'e3', parentId: 'e2', type: 'compaction', summary: 'The user was doing old work.', tokensBefore: 12000 },
            { id: 'e4', parentId: 'e3', type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'new work' }] } },
        ];
        const { webview, internals } = make();
        await internals._restoreHistory(clientWith(log));

        const items = historyItems(webview);
        expect(items.map((i) => i.kind)).toEqual(['user', 'compaction', 'user']);
        expect(items[1].text).toBe('The user was doing old work.');
    });

    it('trims a very long log at a turn boundary and reports what was dropped', async () => {
        const log: PiSessionEntry[] = [{ id: 'h0', type: 'session' }];
        for (let i = 0; i < 3000; i++) {
            log.push({ id: `u${i}`, parentId: `a${i - 1}`, type: 'message', message: { role: 'user', content: [{ type: 'text', text: `q${i}` }] } });
            log.push({ id: `a${i}`, parentId: `u${i}`, type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: `a${i}` }] } });
        }
        const { webview, internals } = make();
        await internals._restoreHistory(clientWith(log));

        const post = webview.posted.find((m) => m.type === 'history');
        const items = (post?.items as HistoryItem[]) ?? [];
        expect(items.length).toBeLessThanOrEqual(1500);
        // Never start mid-turn: a tool result without its tool call would spin forever
        expect(items[0].kind).toBe('user');
        expect(post?.hidden).toBeGreaterThan(0);
    });

    it('still settles the webview when the replay itself fails', async () => {
        // Without a `history` the webview keeps its boot state: the empty state would
        // show the logo and title only, with no quick actions, for the rest of the
        // session.
        const { webview, internals } = make();
        const broken = {
            getMessages: () => Promise.reject(new Error('rpc exploded')),
        } as unknown as PiRpcClient;

        await internals._restoreHistory(broken);

        const post = webview.posted.find((m) => m.type === 'history');
        expect(post).toBeDefined();
        expect(post?.items).toEqual([]);
    });

    it('falls back to get_messages when the pi build has no get_entries', async () => {
        const { webview, internals } = make();
        await internals._restoreHistory(clientWith(undefined, undefined, [
            { role: 'user', content: [{ type: 'text', text: 'hello' }] },
            { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
        ]));

        const items = historyItems(webview);
        expect(items.map((i) => i.kind)).toEqual(['user', 'assistant']);
        // The old code posted `messages` and cut at 30; the replay path is used now
        expect(webview.posted.some((m) => m.type === 'history' && m.messages)).toBe(false);
    });

    it('posts the settled state for an empty session, so the webview can leave its boot state', async () => {
        const { webview, internals } = make();
        await internals._restoreHistory(clientWith([{ id: 'e1', type: 'session' }]));
        const post = webview.posted.find((m) => m.type === 'history');
        expect(post).toBeDefined();
        expect(post?.items).toEqual([]);
    });

    it('keeps the live transcript when the webview is already in sync', async () => {
        const { webview, panel } = make();
        let entriesAsked = 0;
        const client = {
            getState: () => Promise.resolve({ sessionId: 's1', sessionFile: '/tmp/session.jsonl', isStreaming: true }),
            getAvailableModels: () => Promise.resolve([]),
            getEntries: () => { entriesAsked++; return Promise.resolve({ entries: editedFileLog() }); },
        };
        const inner = panel as unknown as {
            _busy: boolean;
            _webviewSynced: boolean;
            _ensureClient(): Promise<void>;
            _refreshAuthStatus(): Promise<void>;
            _runtime: { clientManager: unknown };
        };
        // A turn is running and this panel is the one rendering it (`agent_start`
        // marked the webview as synced): neither clearing nor replaying may happen,
        // or the live output is wiped / duplicated.
        inner._busy = true;
        inner._webviewSynced = true;
        inner._refreshAuthStatus = () => Promise.resolve();
        inner._runtime.clientManager = { ensureConnected: () => Promise.resolve(client) };
        await inner._ensureClient();

        expect(entriesAsked).toBe(0);
        expect(webview.posted.some((m) => m.type === 'clear')).toBe(false);
        expect(webview.posted.some((m) => m.type === 'history')).toBe(false);
    });

    it('clears and replays into a webview that has no transcript yet', async () => {
        const { webview, panel } = make();
        const client = {
            // pi reports the turn as running, but this panel never rendered it
            getState: () => Promise.resolve({ sessionId: 's1', sessionFile: '/tmp/session.jsonl', isStreaming: true }),
            getAvailableModels: () => Promise.resolve([]),
            getEntries: () => Promise.resolve({ entries: editedFileLog() }),
        };
        const inner = panel as unknown as {
            _ensureClient(): Promise<void>;
            _refreshAuthStatus(): Promise<void>;
            _runtime: { clientManager: unknown };
        };
        inner._refreshAuthStatus = () => Promise.resolve();
        inner._runtime.clientManager = { ensureConnected: () => Promise.resolve(client) };
        await inner._ensureClient();

        const types = webview.posted.map((m) => m.type);
        expect(types).toContain('clear');
        expect(types.indexOf('clear')).toBeLessThan(types.indexOf('history'));
        expect(historyItems(webview).length).toBeGreaterThan(0);
    });

    it('does not wipe the transcript on a second reconnect', async () => {
        const { webview, panel } = make();
        const client = {
            getState: () => Promise.resolve({ sessionId: 's1', sessionFile: '/tmp/session.jsonl', isStreaming: false }),
            getAvailableModels: () => Promise.resolve([]),
            getEntries: () => Promise.resolve({ entries: editedFileLog() }),
        };
        const inner = panel as unknown as {
            _ensureClient(): Promise<void>;
            _refreshAuthStatus(): Promise<void>;
            _runtime: { clientManager: unknown };
        };
        inner._refreshAuthStatus = () => Promise.resolve();
        inner._runtime.clientManager = { ensureConnected: () => Promise.resolve(client) };
        await inner._ensureClient();
        await inner._ensureClient();

        // Replaying twice would show the whole session twice
        expect(webview.posted.filter((m) => m.type === 'clear')).toHaveLength(1);
        expect(webview.posted.filter((m) => m.type === 'history')).toHaveLength(1);
    });
});
