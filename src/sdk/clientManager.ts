// ---------------------------------------------------------------------------
// Pi 客户端管理器
// ---------------------------------------------------------------------------

import * as vscode from 'vscode';
import {
    PiRpcClient,
    PiAgentEvent,
    loadPiSdk,
    resolvePi,
    PI_INSTALL_HINT,
    PiSdkModule,
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

export class PiClientManager {
    private _client: PiRpcClient | undefined;
    private _unsubscribe: (() => void) | undefined;
    private _starting: Promise<void> | undefined;
    private _eventListeners: Array<(event: PiAgentEvent) => void> = [];

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

    private async _startClient(extensionPath: string): Promise<void> {
        const config = vscode.workspace.getConfiguration('pi-assistant');
        const executable = (config.get<string>('pi.executable') || '').trim();
        const resolved = resolvePi(extensionPath, executable || undefined);
        if (!resolved) {
            logError('pi executable not found');
            throw new PiNotFoundError(vscode.l10n.t('pi not found; please install it and retry: {0}', PI_INSTALL_HINT));
        }
        logInfo(`using pi: ${resolved.cliPath}`);

        let sdk: PiSdkModule;
        try {
            sdk = await loadPiSdk(resolved.sdkEntry);
        } catch (sdkErr) {
            throw new PiStartError(vscode.l10n.t('Failed to load pi SDK: {0}', (sdkErr as Error).message));
        }

        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
        const args = ['--continue', ...(config.get<string[]>('pi.arguments', []) || [])];
        const permissionMode = config.get<string>('agent.permissionMode', 'ask');
        if (permissionMode === 'restricted') {
            args.push('--exclude-tools', 'bash,edit,write');
        } else if (permissionMode === 'autoConfirm') {
            args.push('--approve');
        }
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
