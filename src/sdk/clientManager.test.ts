import { describe, it, expect } from 'vitest';
import { PiClientManager, PiClientDeps, PiNotFoundError, PiStartError } from './clientManager';
import { PiAgentEvent, PiRpcClientCtor, PiSdkModule } from './piTypes';

class FakeRpcClient {
    public started = false;
    public stopped = false;
    public aborted = false;
    public prompts: string[] = [];
    public writes: string[] = [];
    public lastText: string | null = 'generated title';
    public options: { cliPath?: string; cwd?: string; args?: string[] };
    public failStart = false;
    /** When set, start() waits for it — used to keep a start in flight */
    public startGate: Promise<void> | undefined;
    public process = { stdin: { write: (data: string) => { this.writes.push(data); return true; } } };
    private listeners: Array<(e: PiAgentEvent) => void> = [];

    constructor(options: { cliPath?: string; cwd?: string; args?: string[] }) {
        this.options = options;
    }

    async start(): Promise<void> {
        if (this.failStart) { throw new Error('boom'); }
        if (this.startGate) { await this.startGate; }
        this.started = true;
    }
    async stop(): Promise<void> { this.stopped = true; }
    onEvent(l: (e: PiAgentEvent) => void): () => void {
        this.listeners.push(l);
        return () => { this.listeners = this.listeners.filter((x) => x !== l); };
    }
    async prompt(m: string): Promise<string> {
        this.prompts.push(m);
        this.emit({ type: 'extension_ui_request', id: 'req1' });
        return 'handled';
    }
    async abort(): Promise<void> { this.aborted = true; }
    async waitForIdle(): Promise<void> { /* noop */ }
    async getLastAssistantText(): Promise<string | null> { return this.lastText; }
    getStderr(): string { return ''; }
    emit(e: PiAgentEvent): void { this.listeners.slice().forEach((l) => l(e)); }
}

function setup(opts: { notFound?: boolean; failStart?: boolean; holdFirstStart?: Promise<void> } = {}) {
    const instances: FakeRpcClient[] = [];
    const deps: PiClientDeps = {
        resolvePi: () => (opts.notFound ? null : { cliPath: '/pi/dist/cli.js', sdkEntry: '/pi/dist/index.js' }),
        loadPiSdk: async (): Promise<PiSdkModule> => ({
            RpcClient: class extends FakeRpcClient {
                constructor(o: { cliPath?: string; cwd?: string; args?: string[] }) {
                    super(o);
                    this.failStart = Boolean(opts.failStart);
                    // Only the first client is held, so a test can stop() while it
                    // is still starting and then start a second one normally
                    if (instances.length === 0) { this.startGate = opts.holdFirstStart; }
                    instances.push(this);
                }
            } as unknown as PiRpcClientCtor,
        }),
    };
    return { manager: new PiClientManager(deps), instances };
}

describe('PiClientManager.ensureConnected', () => {
    it('connects once and caches the client', async () => {
        const { manager, instances } = setup();
        const c1 = await manager.ensureConnected('/ext');
        const c2 = await manager.ensureConnected('/ext');
        expect(c1).toBe(c2);
        expect(manager.isConnected).toBe(true);
        expect(instances).toHaveLength(1);
        expect(instances[0].started).toBe(true);
    });

    it('throws PiNotFoundError when pi cannot be resolved', async () => {
        const { manager } = setup({ notFound: true });
        await expect(manager.ensureConnected('/ext')).rejects.toBeInstanceOf(PiNotFoundError);
        expect(manager.isConnected).toBe(false);
    });

    it('throws PiStartError when the process fails to start', async () => {
        const { manager } = setup({ failStart: true });
        await expect(manager.ensureConnected('/ext')).rejects.toBeInstanceOf(PiStartError);
        expect(manager.isConnected).toBe(false);
    });

    it('passes --continue and permission args', async () => {
        const { manager, instances } = setup();
        await manager.ensureConnected('/ext');
        expect(instances[0].options.args).toContain('--continue');
    });

    it('kills a client whose start finishes after a stop (no orphan process)', async () => {
        let release!: () => void;
        const gate = new Promise<void>((r) => { release = r; });
        const { manager, instances } = setup({ holdFirstStart: gate });

        const connecting = manager.ensureConnected('/ext');
        // let _startClient reach its awaited start()
        await new Promise((r) => setTimeout(r, 0));
        expect(instances).toHaveLength(1);

        await manager.stop();          // the manager resets while the start is in flight
        release();

        await expect(connecting).rejects.toBeInstanceOf(PiStartError);
        expect(manager.isConnected).toBe(false);
        // the late-starting process destroys itself instead of being installed
        expect(instances[0].stopped).toBe(true);
    });

    it('a restart during a start leaves the newer client intact', async () => {
        let release!: () => void;
        const gate = new Promise<void>((r) => { release = r; });
        const { manager, instances } = setup({ holdFirstStart: gate });

        const stale = manager.ensureConnected('/ext').catch((e) => e);
        await new Promise((r) => setTimeout(r, 0));
        await manager.stop();

        // a fresh connect wins, then the abandoned first start lands late
        const client = await manager.ensureConnected('/ext');
        release();
        expect(await stale).toBeInstanceOf(PiStartError);

        expect(instances).toHaveLength(2);
        expect(instances[0].stopped).toBe(true);    // orphan cleaned up
        expect(instances[1].stopped).toBe(false);   // current client untouched
        expect(manager.client).toBe(client as unknown);
        expect(manager.isConnected).toBe(true);
    });
});

describe('PiClientManager events and lifecycle', () => {
    it('forwards client events and honors unsubscribe', async () => {
        const { manager, instances } = setup();
        await manager.ensureConnected('/ext');
        const seen: string[] = [];
        const off = manager.onEvent((e) => seen.push(e.type));
        instances[0].emit({ type: 'agent_start' });
        off();
        instances[0].emit({ type: 'agent_settled' });
        expect(seen).toEqual(['agent_start']);
    });

    it('aborts and stops the client', async () => {
        const { manager, instances } = setup();
        await manager.ensureConnected('/ext');
        await manager.abort();
        await manager.stop();
        expect(instances[0].aborted).toBe(true);
        expect(instances[0].stopped).toBe(true);
        expect(manager.isConnected).toBe(false);
    });
});

describe('PiClientManager.runOneShot', () => {
    it('runs ephemerally, returns the text, and stops', async () => {
        const { manager, instances } = setup();
        const text = await manager.runOneShot('/ext', 'write a title');
        expect(text).toBe('generated title');
        expect(instances).toHaveLength(1);
        expect(instances[0].prompts).toEqual(['write a title']);
        expect(instances[0].options.args).toContain('--no-session');
        expect(instances[0].stopped).toBe(true);
        // does not become the shared chat client
        expect(manager.isConnected).toBe(false);
    });

    it('cancels pi UI requests during a one-shot run', async () => {
        const { manager, instances } = setup();
        await manager.runOneShot('/ext', 'x');
        const written = instances[0].writes.join('');
        expect(written).toContain('extension_ui_response');
        expect(written).toContain('req1');
        expect(written).toContain('"cancelled":true');
    });

    it('throws PiNotFoundError when pi is missing', async () => {
        const { manager } = setup({ notFound: true });
        await expect(manager.runOneShot('/ext', 'x')).rejects.toBeInstanceOf(PiNotFoundError);
    });
});
