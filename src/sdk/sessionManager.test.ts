import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SessionManager } from './sessionManager';
import type { PiRpcClient } from './piTypes';

const ID_A = '01a0f11c-aaaa-72ae-bab0-000000000001';
const ID_B = '01a0f11c-bbbb-72ae-bab0-000000000002';

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
