import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SessionManager } from './sessionManager';
import type { PiRpcClient } from './piTypes';

const ID_A = '01a0f11c-aaaa-72ae-bab0-000000000001';
const ID_B = '01a0f11c-bbbb-72ae-bab0-000000000002';
const ID_C = '01a0f11c-cccc-72ae-bab0-000000000003';
const ID_D = '01a0f11c-dddd-72ae-bab0-000000000004';

let dir: string;
let fileA: string;
let fileB: string;

function writeSession(file: string, id: string, name?: string) {
    const header = JSON.stringify({ type: 'session', version: 3, id, timestamp: '2026-10-10T00:00:00Z', cwd: '/x' });
    const info = name ? '\n' + JSON.stringify({ type: 'session_info', id: 'e1', parentId: null, timestamp: 't', name }) : '';
    fs.writeFileSync(file, header + info + '\n');
}

/** Mock pi RPC client that tracks the "current" session. */
function makeClient(startFile: string, startId: string) {
    const state = { sessionId: startId, sessionFile: startFile };
    const switches: string[] = [];
    const renames: string[] = [];
    const client = {
        getState: async () => ({ ...state }),
        switchSession: async (p: string) => {
            const id = path.basename(p, '.jsonl').split('_').pop() as string;
            switches.push(id);
            state.sessionId = id;
            state.sessionFile = p;
            return { cancelled: false };
        },
        setSessionName: async (n: string) => { renames.push(n); },
        newSession: async () => ({ cancelled: false }),
    };
    return { client: client as unknown as PiRpcClient, switches, renames };
}

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-sess-test-'));
    fileA = path.join(dir, `2026-10-10T01-00-00-000Z_${ID_A}.jsonl`);
    fileB = path.join(dir, `2026-10-10T02-00-00-000Z_${ID_B}.jsonl`);
    writeSession(fileA, ID_A);
    writeSession(fileB, ID_B, 'My Session');
});

afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
});

describe('SessionManager.loadSessions', () => {
    it('reads the real id from the header and the name from session_info', async () => {
        const { client } = makeClient(fileA, ID_A);
        const sm = new SessionManager();
        await sm.loadSessions(client);

        const ids = sm.sessions.map((s) => s.id).sort();
        expect(ids).toEqual([ID_A, ID_B].sort());
        expect(sm.sessions.find((s) => s.id === ID_B)?.name).toBe('My Session');
        expect(sm.currentSessionId).toBe(ID_A);
    });

    it('reads the header id and last name from a large session file (bounded read)', async () => {
        // ~1MB of filler, then session_info, then ~400KB more filler:
        // the name sits beyond the first 256KB tail chunk, so the backward scan must widen.
        const big = path.join(dir, `2026-10-10T03-00-00-000Z_${ID_C}.jsonl`);
        const header = JSON.stringify({ type: 'session', version: 3, id: ID_C });
        const filler = JSON.stringify({ type: 'message', role: 'user', content: 'x'.repeat(500) });
        const lines: string[] = [header];
        for (let i = 0; i < 2000; i++) { lines.push(filler); }
        lines.push(JSON.stringify({ type: 'session_info', name: 'Deep Name' }));
        for (let i = 0; i < 800; i++) { lines.push(filler); }
        fs.writeFileSync(big, lines.join('\n') + '\n');

        const { client } = makeClient(fileA, ID_A);
        const sm = new SessionManager();
        await sm.loadSessions(client);

        const s = sm.sessions.find((x) => x.id === ID_C);
        expect(s).toBeDefined();
        expect(s?.name).toBe('Deep Name');
    });

    it('derives a preview from the first user message (trimmed)', async () => {
        const file = path.join(dir, `2026-10-10T04-00-00-000Z_${ID_D}.jsonl`);
        const header = JSON.stringify({ type: 'session', version: 3, id: ID_D });
        const user = JSON.stringify({ type: 'message', id: 'm1', parentId: null, timestamp: 't', message: { role: 'user', content: '   How do I   fix the parser?  ' } });
        fs.writeFileSync(file, [header, user].join('\n') + '\n');

        const { client } = makeClient(fileA, ID_A);
        const sm = new SessionManager();
        await sm.loadSessions(client);

        expect(sm.sessions.find((x) => x.id === ID_D)?.preview).toBe('How do I fix the parser?');
    });

    it('strips the context block and truncates a long preview', async () => {
        const file = path.join(dir, `2026-10-10T05-00-00-000Z_${ID_D}.jsonl`);
        const header = JSON.stringify({ type: 'session', version: 3, id: ID_D });
        const content = '--- pi-extension-context:start ---\n<file-context>\n@a.ts\n</file-context>\n--- pi-extension-context:end ---\n\n' + 'x'.repeat(200);
        const user = JSON.stringify({ type: 'message', id: 'm1', parentId: null, timestamp: 't', message: { role: 'user', content } });
        fs.writeFileSync(file, [header, user].join('\n') + '\n');

        const { client } = makeClient(fileA, ID_A);
        const sm = new SessionManager();
        await sm.loadSessions(client);

        expect(sm.sessions.find((x) => x.id === ID_D)?.preview).toBe('x'.repeat(60) + '…');
    });
});

describe('SessionManager.switchSession', () => {
    it('switches to the session file and refreshes current', async () => {
        const { client, switches } = makeClient(fileA, ID_A);
        const sm = new SessionManager();
        await sm.loadSessions(client);

        const ok = await sm.switchSession(client, ID_B);
        expect(ok).toBe(true);
        expect(switches).toEqual([ID_B]);
        expect(sm.currentSessionId).toBe(ID_B);
    });

    it('returns false for an unknown session', async () => {
        const { client } = makeClient(fileA, ID_A);
        const sm = new SessionManager();
        await sm.loadSessions(client);
        expect(await sm.switchSession(client, 'nope')).toBe(false);
    });
});

describe('SessionManager.renameSession', () => {
    it('renames the current session without switching', async () => {
        const { client, switches, renames } = makeClient(fileA, ID_A);
        const sm = new SessionManager();
        await sm.loadSessions(client);

        const ok = await sm.renameSession(client, ID_A, 'A renamed');
        expect(ok).toBe(true);
        expect(switches).toEqual([]);
        expect(renames).toEqual(['A renamed']);
        expect(sm.currentSessionId).toBe(ID_A);
    });

    it('switches to a non-current session, renames, then switches back', async () => {
        const { client, switches, renames } = makeClient(fileA, ID_A);
        const sm = new SessionManager();
        await sm.loadSessions(client);

        const ok = await sm.renameSession(client, ID_B, 'B renamed');
        expect(ok).toBe(true);
        expect(switches).toEqual([ID_B, ID_A]); // there and back
        expect(renames).toEqual(['B renamed']);
        expect(sm.currentSessionId).toBe(ID_A); // ends on the original session
    });
});
