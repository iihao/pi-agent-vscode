import { describe, it, expect, afterEach } from 'vitest';
import { ChatPanel } from './chatPanel';
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

// Minimal vscode.Event<void> stand-in.
const disposeEvent = (_listener: () => void, _thisArgs?: unknown, disposables?: { dispose(): void }[]) => {
    const d = { dispose() { /* noop */ } };
    if (disposables) { disposables.push(d); }
    return d;
};

function createPanel() {
    const webview = makeWebview();
    const panel = ChatPanel.create(
        webview as unknown as import('vscode').Webview,
        '/ext',
        disposeEvent as unknown as import('vscode').Event<void>,
    );
    return { webview, panel };
}

describe('ChatPanel webview bridge', () => {
    const panels: ChatPanel[] = [];
    afterEach(() => {
        panels.splice(0).forEach((p) => p.dispose());
        (vscodeMock.window as { activeTextEditor?: unknown }).activeTextEditor = undefined;
    });

    function make() {
        const { webview, panel } = createPanel();
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

    it('clear() posts clear, setBusy, contexts and turnChanges', () => {
        const { webview, panel } = make();
        panel.clear();
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

    it('attachFiles() adds selected workspace files as context', async () => {
        const original = vscodeMock.window.showOpenDialog;
        (vscodeMock.window as { showOpenDialog: unknown }).showOpenDialog = () => Promise.resolve([{ fsPath: '/x/a.ts' }]);
        try {
            const { webview, panel } = make();
            await panel.attachFiles();
            const ctx = webview.posted.filter((m) => m.type === 'contexts').pop();
            expect((ctx?.contexts as Array<{ path: string }>)).toEqual([expect.objectContaining({ path: '/x/a.ts' })]);
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
});
