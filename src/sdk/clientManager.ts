// ---------------------------------------------------------------------------
// Pi 客户端管理器
// ---------------------------------------------------------------------------

import * as vscode from 'vscode';
import {
    PiRpcClient,
    PiAgentEvent,
    loadPiSdk,
    resolvePi,
    ResolvedPi,
    PI_INSTALL_HINT,
    PiSdkModule,
    respondExtensionUI,
} from './piTypes';
import { logInfo, logError } from '../utils/logger';

/** pi 启动相关错误（用于类型判断，避免依赖错误文案匹配） */
export class PiStartError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'PiStartError';
    }
}

/** 未找到 pi 可执行文件 */
export class PiNotFoundError extends PiStartError {
    constructor(message: string) {
        super(message);
        this.name = 'PiNotFoundError';
    }
}

/** 可注入的解析/加载依赖（默认用真实实现，测试时注入假实现） */
export interface PiClientDeps {
    resolvePi(extensionPath: string, executable?: string): ResolvedPi | null;
    loadPiSdk(entryPath: string): Promise<PiSdkModule>;
}

const defaultDeps: PiClientDeps = { resolvePi, loadPiSdk };

/** 根据权限模式生成 pi 启动参数 */
function permissionArgs(config: vscode.WorkspaceConfiguration): string[] {
    const args: string[] = [];
    const mode = config.get<string>('agent.permissionMode', 'ask');
    if (mode === 'restricted') { args.push('--exclude-tools', 'bash,edit,write'); }
    else if (mode === 'autoConfirm') { args.push('--approve'); }
    return args;
}

export class PiClientManager {
    private _client: PiRpcClient | undefined;
    private _unsubscribe: (() => void) | undefined;
    private _starting: Promise<void> | undefined;
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

    public async ensureConnected(extensionPath: string): Promise<PiRpcClient> {
        if (this._client) { return this._client; }
        if (!this._starting) {
            this._starting = this._startClient(extensionPath).catch((err) => {
                this._starting = undefined;
                throw err;
            });
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

    /**
     * 运行一次性生成任务（如生成 commit message）：启动独立、临时（--no-session）
     * 的 pi 进程，prompt 后取助手文本并关闭。不进入聊天会话，不污染历史。
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
        // 一次性生成期间若 pi 请求交互（确认/选择），直接回 cancelled，避免挂起到超时
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

    private async _startClient(extensionPath: string): Promise<void> {
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
        const args = ['--continue', ...(config.get<string[]>('pi.arguments', []) || []), ...permissionArgs(config)];
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

        try {
            await client.start();
        } catch (startErr) {
            const stderr = client.getStderr().trim();
            const detail = stderr
                ? stderr.split('\n').slice(-2).join(' ').slice(0, 200)
                : (startErr as Error).message;
            logError(`pi start failed: ${detail}`);
            throw new PiStartError(vscode.l10n.t('pi process failed to start: {0}', detail));
        }

        this._client = client;
        logInfo('pi client ready');
    }

    private async _resetClient(): Promise<void> {
        if (this._unsubscribe) {
            this._unsubscribe();
            this._unsubscribe = undefined;
        }
        const client = this._client;
        this._client = undefined;
        this._starting = undefined;
        if (client) {
            // 等待进程真正退出，避免新旧客户端并存
            await client.stop().catch((err) => { logError(`client.stop failed: ${(err as Error).message}`); });
        }
    }
}
