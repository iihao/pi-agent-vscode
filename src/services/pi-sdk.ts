// ---------------------------------------------------------------------------
// Pi SDK 适配器接口
// ---------------------------------------------------------------------------

import { PiRpcClient, PiAgentEvent, PiModelInfo, PiSessionStats, PiSessionState } from '../sdk/piTypes';
import { logError } from '../utils/logger';

export interface IPiSdkAdapter {
    // 生命周期
    start(): Promise<void>;
    stop(): Promise<void>;

    // 消息
    prompt(message: string): Promise<string>;
    abort(): Promise<void>;

    // 事件
    onEvent(listener: (event: PiAgentEvent) => void): () => void;

    // 会话
    newSession(parentSession?: string): Promise<{ cancelled: boolean }>;
    switchSession(sessionPath: string): Promise<{ cancelled: boolean }>;
    setSessionName(name: string): Promise<void>;

    // 状态
    getState(): Promise<PiSessionState>;
    getMessages(): Promise<Array<{ role?: string; content?: unknown }>>;
    getSessionStats?(): Promise<PiSessionStats>;

    // 模型
    getAvailableModels(): Promise<PiModelInfo[]>;
    setModel(provider: string, modelId: string): Promise<{ provider: string; id: string }>;
    getAvailableThinkingLevels?(): Promise<string[]>;
    setThinkingLevel?(level: string): Promise<void>;

    // 调试
    getStderr(): string;
}

export class PiSdkAdapter implements IPiSdkAdapter {
    private client: PiRpcClient;

    constructor(client: PiRpcClient) {
        this.client = client;
    }

    public async start(): Promise<void> {
        return this.client.start();
    }

    public async stop(): Promise<void> {
        return this.client.stop();
    }

    public async prompt(message: string): Promise<string> {
        return this.client.prompt(message);
    }

    public async abort(): Promise<void> {
        return this.client.abort();
    }

    public onEvent(listener: (event: PiAgentEvent) => void): () => void {
        return this.client.onEvent(listener);
    }

    public async newSession(parentSession?: string): Promise<{ cancelled: boolean }> {
        return this.client.newSession(parentSession);
    }

    public async switchSession(sessionPath: string): Promise<{ cancelled: boolean }> {
        return this.client.switchSession(sessionPath);
    }

    public async setSessionName(name: string): Promise<void> {
        return this.client.setSessionName(name);
    }

    public async getState(): Promise<PiSessionState> {
        return this.client.getState();
    }

    public async getMessages(): Promise<Array<{ role?: string; content?: unknown }>> {
        return this.client.getMessages();
    }

    public async getSessionStats(): Promise<PiSessionStats> {
        if (typeof this.client.getSessionStats === 'function') {
            return this.client.getSessionStats();
        }
        throw new Error('getSessionStats not supported');
    }

    public async getAvailableModels(): Promise<PiModelInfo[]> {
        return this.client.getAvailableModels();
    }

    public async setModel(provider: string, modelId: string): Promise<{ provider: string; id: string }> {
        return this.client.setModel(provider, modelId);
    }

    public async getAvailableThinkingLevels(): Promise<string[]> {
        if (typeof this.client.getAvailableThinkingLevels === 'function') {
            return this.client.getAvailableThinkingLevels();
        }
        return [];
    }

    public async setThinkingLevel(level: string): Promise<void> {
        if (typeof this.client.setThinkingLevel !== 'function') {
            logError(`PiSdkAdapter.setThinkingLevel: not supported by this client (level=${level})`);
            return;
        }
        return this.client.setThinkingLevel(level);
    }

    public getStderr(): string {
        return this.client.getStderr();
    }
}
