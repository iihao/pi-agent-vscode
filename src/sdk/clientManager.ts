// ---------------------------------------------------------------------------
// Pi client manager
// ---------------------------------------------------------------------------

import * as vscode from 'vscode';
import { spawn } from 'child_process';
import {
    PiRpcClient,
    PiAgentEvent,
    loadPiSdk,
    resolvePi,
    ResolvedPi,
    PI_INSTALL_HINT,
    PiSdkModule,
    respondExtensionUI,
    patchLongRunningTimeouts,
} from './piTypes';
import { logInfo, logError } from '../utils/logger';

/** Errors from starting pi (type-checked instead of matching message text) */
export class PiStartError extends Error {
    /**
     * True when the start was not a failure but was superseded: a stop/restart ran
     * while it was in flight, so the process was discarded on purpose. Callers that
     * merely wanted a client can leave the state to the newer connect.
     */
    constructor(message: string, readonly cancelled = false) {
        super(message);
        this.name = 'PiStartError';
    }
}

/** pi executable not found */
export class PiNotFoundError extends PiStartError {
    constructor(message: string) {
        super(message);
        this.name = 'PiNotFoundError';
    }
}

/** Injectable resolve/load deps (real by default, fakes in tests) */
export interface PiClientDeps {
    resolvePi(extensionPath: string, executable?: string): ResolvedPi | null;
    loadPiSdk(entryPath: string): Promise<PiSdkModule>;
}

const defaultDeps: PiClientDeps = { resolvePi, loadPiSdk };

export interface PiCliResult { stdout: string; stderr: string; code: number | null }

/** Run a process and collect its output (a non-zero exit is not an error, for commands like `pi auth check` where the exit code carries meaning) */
export function runProcess(
    cmd: string,
    args: string[],
    opts: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<PiCliResult> {
    return new Promise((resolve) => {
        const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* ignore */ } }, opts.timeoutMs ?? 15000);
        child.stdout?.on('data', (d) => { stdout += d.toString(); });
        child.stderr?.on('data', (d) => { stderr += d.toString(); });
        child.on('error', () => { clearTimeout(timer); resolve({ stdout, stderr, code: null }); });
        child.on('close', (code) => { clearTimeout(timer); resolve({ stdout, stderr, code }); });
    });
}

/** Build pi's start args from the permission mode */
function permissionArgs(config: vscode.WorkspaceConfiguration): string[] {
    const args: string[] = [];
    const mode = config.get<string>('agent.permissionMode', 'ask');
    if (mode === 'restricted') { args.push('--exclude-tools', 'bash,edit,write'); }
    else if (mode === 'autoConfirm') { args.push('--approve'); }
    return args;
}

/** Session selection when starting pi */
export interface PiStartOptions {
    /** Continue the most recent session (default true); false starts a brand-new session */
    continueRecent?: boolean;
    /** Open a specific session file (takes precedence over continueRecent) */
    sessionFile?: string;
}

export class PiClientManager {
    private _client: PiRpcClient | undefined;
    private _unsubscribe: (() => void) | undefined;
    private _starting: Promise<void> | undefined;
    /**
     * Bumped by every `_resetClient`. `_startClient` captures it and refuses to
     * install a client whose start finished after a stop: that process has no
     * owner any more, and keeping it would leak a live pi child that outlives
     * the manager and races any client started afterwards.
     */
    private _generation = 0;
    private _eventListeners: Array<(event: PiAgentEvent) => void> = [];
    private readonly _deps: PiClientDeps;

    constructor(deps: PiClientDeps = defaultDeps) {
        this._deps = deps;
    }

    public get client(): PiRpcClient | undefined {
        return this._client;
    }

    public get isConnected(): boolean {
        return !!this._client;
    }

    public async ensureConnected(extensionPath: string, options?: PiStartOptions): Promise<PiRpcClient> {
        if (this._client) { return this._client; }
        if (!this._starting) {
            const starting = this._startClient(extensionPath, options).catch((err) => {
                // Only drop the handle if it is still ours: a reset + new start
                // may already have installed a fresher promise here meanwhile
                if (this._starting === starting) { this._starting = undefined; }
                throw err;
            });
            this._starting = starting;
        }
        await this._starting;
        if (!this._client) {
            throw new PiStartError(vscode.l10n.t('Pi client failed to start'));
        }
        return this._client;
    }

    public onEvent(listener: (event: PiAgentEvent) => void): () => void {
        this._eventListeners.push(listener);
        return () => {
            const idx = this._eventListeners.indexOf(listener);
            if (idx >= 0) { this._eventListeners.splice(idx, 1); }
        };
    }

    public async abort(): Promise<void> {
        if (this._client) {
            try { await this._client.abort(); } catch (err) { logError(`abort failed: ${(err as Error).message}`); }
        }
    }

    public async stop(): Promise<void> {
        await this._resetClient();
    }

    /** Run a pi CLI subcommand once (e.g. `auth check`) to probe credentials / provider status */
    public async runCli(extensionPath: string, args: string[], timeoutMs = 15000): Promise<PiCliResult> {
        const config = vscode.workspace.getConfiguration('pi-agent');
        const executable = (config.get<string>('pi.executable') || '').trim();
        const resolved = this._deps.resolvePi(extensionPath, executable || undefined);
        if (!resolved) {
            throw new PiNotFoundError(vscode.l10n.t('pi not found; please install it and retry: {0}', PI_INSTALL_HINT));
        }
        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
        return runProcess('node', [resolved.cliPath, ...args], { cwd, timeoutMs });
    }

    /**
     * Run a one-shot generation task (e.g. a commit message): start a separate,
     * temporary pi process (--no-session), prompt it, read the assistant text and
     * shut it down. It does not join the chat session or pollute history.
     */
    public async runOneShot(extensionPath: string, prompt: string, timeoutMs = 90000): Promise<string> {
        const config = vscode.workspace.getConfiguration('pi-agent');
        const executable = (config.get<string>('pi.executable') || '').trim();
        const resolved = this._deps.resolvePi(extensionPath, executable || undefined);
        if (!resolved) {
            throw new PiNotFoundError(vscode.l10n.t('pi not found; please install it and retry: {0}', PI_INSTALL_HINT));
        }

        let sdk: PiSdkModule;
        try {
            sdk = await this._deps.loadPiSdk(resolved.sdkEntry);
        } catch (sdkErr) {
            throw new PiStartError(vscode.l10n.t('Failed to load pi SDK: {0}', (sdkErr as Error).message));
        }

        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
        const client = new sdk.RpcClient({ cliPath: resolved.cliPath, cwd, args: ['--no-session', '--no-tools'] });
        // If pi asks for interaction (confirm/select) during a one-shot, reply cancelled to avoid hanging until timeout
        const unsubscribe = client.onEvent((event) => {
            if (event.type === 'extension_ui_request' && event.id) {
                respondExtensionUI(client, event.id, { cancelled: true });
            }
        });
        try {
            await client.start();
            await client.prompt(prompt);
            if (typeof client.waitForIdle === 'function') {
                await client.waitForIdle(timeoutMs);
            }
            const text = typeof client.getLastAssistantText === 'function'
                ? await client.getLastAssistantText()
                : null;
            return (text || '').trim();
        } finally {
            unsubscribe();
            await client.stop().catch((err) => { logError(`one-shot stop failed: ${(err as Error).message}`); });
        }
    }

    private async _startClient(extensionPath: string, options?: PiStartOptions): Promise<void> {
        const generation = this._generation;
        const config = vscode.workspace.getConfiguration('pi-agent');
        const executable = (config.get<string>('pi.executable') || '').trim();
        const resolved = this._deps.resolvePi(extensionPath, executable || undefined);
        if (!resolved) {
            logError('pi executable not found');
            throw new PiNotFoundError(vscode.l10n.t('pi not found; please install it and retry: {0}', PI_INSTALL_HINT));
        }
        logInfo(`using pi: ${resolved.cliPath}`);

        let sdk: PiSdkModule;
        try {
            sdk = await this._deps.loadPiSdk(resolved.sdkEntry);
        } catch (sdkErr) {
            throw new PiStartError(vscode.l10n.t('Failed to load pi SDK: {0}', (sdkErr as Error).message));
        }

        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
        // Session selection: explicit file > continue recent > brand new (no --continue starts fresh)
        const sessionArgs: string[] = [];
        if (options?.sessionFile) { sessionArgs.push('--session', options.sessionFile); }
        else if (options?.continueRecent !== false) { sessionArgs.push('--continue'); }
        const args = [...sessionArgs, ...(config.get<string[]>('pi.arguments', []) || []), ...permissionArgs(config)];
        const client = new sdk.RpcClient({
            cliPath: resolved.cliPath,
            cwd,
            args,
        });

        this._unsubscribe = client.onEvent((event) => {
            for (const listener of this._eventListeners) {
                try { listener(event); } catch (err) { logError(`event listener failed: ${(err as Error).message}`); }
            }
        });
        // Local handle too: if this start is later cancelled, the shared field may
        // already belong to a *newer* client and must not be cleared through it
        const unsubscribeThis = this._unsubscribe;

        try {
            await client.start();
        } catch (startErr) {
            // Start failed: drop the listener just registered so a dead client's subscription isn't left behind
            unsubscribeThis?.();
            if (this._unsubscribe === unsubscribeThis) { this._unsubscribe = undefined; }
            const stderr = client.getStderr().trim();
            const detail = stderr
                ? stderr.split('\n').slice(-2).join(' ').slice(0, 200)
                : (startErr as Error).message;
            logError(`pi start failed: ${detail}`);
            throw new PiStartError(vscode.l10n.t('pi process failed to start: {0}', detail));
        }

        // The SDK's send has a hard-coded 30s timeout, too short for long tasks like compact / bash; widen it.
        patchLongRunningTimeouts(client);

        if (generation !== this._generation) {
            // stop()/restart ran while this start was in flight: the manager no
            // longer wants this process. Kill it instead of installing an ownerless
            // client that no future stop() can reach.
            unsubscribeThis?.();
            if (this._unsubscribe === unsubscribeThis) { this._unsubscribe = undefined; }
            await client.stop().catch((err) => { logError(`discarding cancelled client failed: ${(err as Error).message}`); });
            throw new PiStartError(vscode.l10n.t('Pi client start was cancelled by a restart'), true);
        }

        this._client = client;
        logInfo('pi client ready');
    }

    private async _resetClient(): Promise<void> {
        // Invalidate any start currently in flight (see _generation)
        this._generation++;
        if (this._unsubscribe) {
            this._unsubscribe();
            this._unsubscribe = undefined;
        }
        const client = this._client;
        this._client = undefined;
        this._starting = undefined;
        if (client) {
            // Wait for the process to actually exit so old and new clients never coexist
            await client.stop().catch((err) => { logError(`client.stop failed: ${(err as Error).message}`); });
        }
    }
}
