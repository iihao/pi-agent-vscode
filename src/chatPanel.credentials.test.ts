// ---------------------------------------------------------------------------
// Writes to pi's config files (auth.json / models.json)
//
// Regression guard for C2: every writer used to treat "file cannot be parsed"
// like "file does not exist" — rebuild from {} — which silently dropped all
// other providers and then copied the broken state over the .bak, destroying
// the backup of the good one too. A parse failure must abort the write before
// anything on disk is touched.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ChatPanel } from './chatPanel';

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

interface CredInternals {
    _writeAuthKey(provider: string, key: string): void;
    _writeCustomProvider(p: { id: string; name: string; baseUrl: string; apiKey: string; modelId: string }): void;
    _deleteProvider(id: string): void;
}

describe('pi config file writes', () => {
    let dir: string;
    let realAgentDir: string | undefined;
    const panels: ChatPanel[] = [];

    beforeEach(() => {
        realAgentDir = process.env.PI_CODING_AGENT_DIR;
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-agent-creds-'));
        process.env.PI_CODING_AGENT_DIR = dir;
    });

    afterEach(() => {
        panels.splice(0).forEach((p) => p.dispose());
        ChatPanel.resetRuntimesForTest();
        if (realAgentDir === undefined) { delete process.env.PI_CODING_AGENT_DIR; }
        else { process.env.PI_CODING_AGENT_DIR = realAgentDir; }
        fs.rmSync(dir, { recursive: true, force: true });
    });

    function make(): CredInternals {
        const webview = makeWebview();
        const panel = ChatPanel.create(
            webview as unknown as import('vscode').Webview,
            '/ext',
            disposeEvent as unknown as import('vscode').Event<void>,
        );
        panels.push(panel);
        return panel as unknown as CredInternals;
    }

    const write = (name: string, content: string): void => { fs.writeFileSync(path.join(dir, name), content); };
    const read = (name: string): string => fs.readFileSync(path.join(dir, name), 'utf8');

    it('merges a key into an existing healthy file and backs up the pre-write state', () => {
        write('auth.json', JSON.stringify({ anthropic: { type: 'api_key', key: 'old' } }));

        make()._writeAuthKey('openai', 'newkey');

        const data = JSON.parse(read('auth.json'));
        expect(Object.keys(data).sort()).toEqual(['anthropic', 'openai']);
        expect(data.openai.key).toBe('newkey');
        // .bak holds what was there *before* the write
        expect(JSON.parse(read('auth.json.bak'))).toEqual({ anthropic: { type: 'api_key', key: 'old' } });
    });

    it('creates the file when it does not exist', () => {
        make()._writeAuthKey('anthropic', 'k');
        expect(JSON.parse(read('auth.json')).anthropic.key).toBe('k');
    });

    it('refuses to rebuild over an unparsable file and leaves the backup alone', () => {
        // what pi leaves behind if it is interrupted mid-write
        const broken = '{"anthropic": {"type": "api_key",';
        write('auth.json', broken);
        write('auth.json.bak', '{"sentinel": true}');   // an older, *good* backup

        expect(() => make()._writeAuthKey('openai', 'k')).toThrow(/auth\.json/);

        expect(read('auth.json')).toBe(broken);                 // untouched
        expect(read('auth.json.bak')).toBe('{"sentinel": true}'); // not clobbered with the broken state
    });

    it('refuses the same for a broken models.json on a custom provider', () => {
        const broken = '{"providers": ';
        write('models.json', broken);

        expect(() => make()._writeCustomProvider({
            id: 'x', name: 'X', baseUrl: 'http://x', apiKey: '', modelId: 'm',
        })).toThrow(/models\.json/);
        expect(read('models.json')).toBe(broken);
    });

    it('a broken models.json does not half-delete the provider from auth.json', () => {
        write('auth.json', JSON.stringify({ anthropic: {} }));
        write('models.json', '{"providers": ');

        expect(() => make()._deleteProvider('anthropic')).toThrow(/models\.json/);

        // both files are read strictly before either is mutated
        expect(JSON.parse(read('auth.json'))).toHaveProperty('anthropic');
    });
});
