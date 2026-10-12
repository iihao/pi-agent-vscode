// ---------------------------------------------------------------------------
// 共享聊天状态类型定义
//
// 说明：busy / turnHadText / contexts / lastUsage / permissionMode 由
// chatPanel 读取；其余字段目前只被写入，保留是为了不改动正在并行开发的
// chatPanel，后续可直接删除或改为「只下发 webview」。
// ---------------------------------------------------------------------------

import { ContextItem } from '../utils/context';
import { SessionInfo } from '../sdk/sessionManager';
import { PiModelInfo, PiUsage } from '../sdk/piTypes';

export interface TurnChange {
    rel: string;
    existed: boolean;
    edits: Array<{ oldText: string; newText: string }> | null;
}

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

    // 本回合改动追踪（共享：多面板事件广播需要同步）
    turnChanges: TurnChange[];

    // clear() 时若未连接，标记连接后需创建新会话
    pendingNewSession: boolean;

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

export type ChatStateSelector<T> = (state: ChatState) => T;

export function getInitialState(): ChatState {
    return {
        busy: false,
        turnHadText: false,
        turnChanges: [],
        pendingNewSession: false,
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
