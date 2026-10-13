import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { extractMessageImages, resolvePi, patchLongRunningTimeouts, PiRpcClient } from './piTypes';

describe('resolvePi', () => {
    it('finds pi on PATH (symlinked global install)', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-resolve-'));
        const pkg = path.join(root, 'pkg');
        fs.mkdirSync(path.join(pkg, 'dist'), { recursive: true });
        fs.writeFileSync(path.join(pkg, 'package.json'), '{}');
        fs.writeFileSync(path.join(pkg, 'dist', 'cli.js'), '');
        fs.writeFileSync(path.join(pkg, 'dist', 'index.js'), '');
        const binDir = path.join(root, 'bin');
        fs.mkdirSync(binDir, { recursive: true });
        fs.symlinkSync(path.join(pkg, 'dist', 'cli.js'), path.join(binDir, 'pi'));

        const original = process.env.PATH;
        process.env.PATH = binDir + path.delimiter + (original || '');
        try {
            const resolved = resolvePi(path.join(root, 'ext'));
            expect(resolved).toBeTruthy();
            expect(resolved?.cliPath.endsWith(path.join('dist', 'cli.js'))).toBe(true);
            expect(resolved?.sdkEntry.endsWith(path.join('dist', 'index.js'))).toBe(true);
            expect(fs.existsSync(resolved?.cliPath ?? '')).toBe(true);
        } finally {
            process.env.PATH = original;
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});

describe('extractMessageImages', () => {
    it('returns image blocks from array content', () => {
        expect(extractMessageImages({
            role: 'user',
            content: [
                { type: 'text', text: 'look at this' },
                { type: 'image', data: 'AAA', mimeType: 'image/png' },
            ],
        })).toEqual([{ data: 'AAA', mimeType: 'image/png' }]);
    });

    it('ignores non-image blocks and string content', () => {
        expect(extractMessageImages({ role: 'user', content: 'plain' })).toEqual([]);
        expect(extractMessageImages({ role: 'assistant', content: [{ type: 'text', text: 'x' }] })).toEqual([]);
    });

    it('drops image blocks without data', () => {
        expect(extractMessageImages({ content: [{ type: 'image', mimeType: 'image/png' }] })).toEqual([]);
    });
});

/** 模拟 pi SDK 的 RpcClient 内部结构（send / pendingRequests / requestId / process.stdin） */
function makeFakeClient() {
    const pendingRequests = new Map<string, { resolve: (value: unknown) => void; reject: (error: unknown) => void }>();
    const written: string[] = [];
    let originalSendCalls = 0;
    const client = {
        pendingRequests,
        requestId: 0,
        process: {
            stdin: { write: (data: string) => { written.push(data); return true; }, destroyed: false, writable: true },
            exitCode: null as number | null,
            signalCode: null as string | null,
        },
        stderr: '',
        send: async (command: { type: string }) => { originalSendCalls++; return { viaOriginal: command.type }; },
    };
    return { client: client as unknown as PiRpcClient, pendingRequests, written, calls: () => originalSendCalls };
}

describe('patchLongRunningTimeouts', () => {
    it('extends the timeout for compact and resolves on response', async () => {
        vi.useFakeTimers();
        try {
            const { client, pendingRequests, written } = makeFakeClient();
            patchLongRunningTimeouts(client);
            const p = (client as unknown as { send(c: { type: string }): Promise<unknown> }).send({ type: 'compact' });

            expect(written).toHaveLength(1);
            const cmd = JSON.parse(written[0]) as { type: string; id: string };
            expect(cmd.type).toBe('compact');
            expect(cmd.id).toMatch(/^req_/);

            // 30s 后仍未超时（默认 SDK 会在这里报错）
            await vi.advanceTimersByTimeAsync(30_000);
            expect(pendingRequests.has(cmd.id)).toBe(true);

            const pending = pendingRequests.get(cmd.id);
            expect(pending).toBeDefined();
            pending?.resolve({ success: true, data: { ok: 1 } });
            await expect(p).resolves.toEqual({ success: true, data: { ok: 1 } });
        } finally {
            vi.useRealTimers();
        }
    });

    it('ultimately times out at the extended value, not 30s', async () => {
        vi.useFakeTimers();
        try {
            const { client } = makeFakeClient();
            patchLongRunningTimeouts(client);
            const p = (client as unknown as { send(c: { type: string }): Promise<unknown> }).send({ type: 'bash' });
            const assertion = expect(p).rejects.toThrow(/Timeout waiting for response to bash/);
            await vi.advanceTimersByTimeAsync(30_000);
            await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
            await assertion;
        } finally {
            vi.useRealTimers();
        }
    });

    it('delegates non long-running commands to the original send', async () => {
        const { client, calls } = makeFakeClient();
        patchLongRunningTimeouts(client);
        await expect((client as unknown as { send(c: { type: string }): Promise<unknown> }).send({ type: 'get_state' }))
            .resolves.toEqual({ viaOriginal: 'get_state' });
        expect(calls()).toBe(1);
    });

    it('is idempotent', () => {
        const { client } = makeFakeClient();
        patchLongRunningTimeouts(client);
        const first = (client as unknown as { send: unknown }).send;
        patchLongRunningTimeouts(client);
        expect((client as unknown as { send: unknown }).send).toBe(first);
    });

    it('leaves the client untouched when SDK internals are missing', async () => {
        const client = { send: async () => 'ok' } as unknown as PiRpcClient;
        patchLongRunningTimeouts(client);
        await expect((client as unknown as { send(c: { type: string }): Promise<unknown> }).send({ type: 'compact' })).resolves.toBe('ok');
    });
});
