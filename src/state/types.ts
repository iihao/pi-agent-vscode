// ---------------------------------------------------------------------------
// 状态类型定义
// ---------------------------------------------------------------------------

import { ContextItem, SessionInfo } from './contextTypes';
import { PiModelInfo, PiUsage } from '../sdk/piTypes';

export interface SessionStats {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    contextPercent: number | null;
    contextWindow: number;
    autoCompact: boolean;
}

export interface ChatState {
    // UI 状态
    busy: boolean;
    turnHadText: boolean;

    // 上下文状态
    contexts: ContextItem[];

    // 使用统计
    lastUsage: PiUsage | undefined;
    stats: SessionStats | undefined;

    // 会话状态
    sessions: SessionInfo[];
    currentSessionId: string | undefined;

    // 模型状态
    models: PiModelInfo[];
    currentModel: { provider: string; id: string } | null;
    thinkingLevels: string[];
    currentThinking: string | null;

    // 权限状态
    permissionMode: string;

    // 连接状态
    connected: boolean;
    connecting: boolean;
}

export type ChatStateListener = (state: ChatState) => void;
export type ChatStateSelector<T> = (state: ChatState) => T;

export function getInitialState(): ChatState {
    return {
        busy: false,
        turnHadText: false,
        contexts: [],
        lastUsage: undefined,
        stats: undefined,
        sessions: [],
        currentSessionId: undefined,
        models: [],
        currentModel: null,
        thinkingLevels: [],
        currentThinking: null,
        permissionMode: 'ask',
        connected: false,
        connecting: false,
    };
}
