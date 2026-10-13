// ---------------------------------------------------------------------------
// 会话运行时状态类型定义
//
// 一个会话（ChatRuntime）持有一份 ChatState：绑定同一会话的多个面板共享它，
// 从而「同一会话 → 镜像」；不同会话之间状态完全隔离（busy / contexts /
// sessions / stats / models …）。渲染台账（已下发给某个 webview 的内容）
// 才是面板私有的，不在这里。
// ---------------------------------------------------------------------------

import { ContextItem } from '../utils/context';
import { SessionInfo } from '../sdk/sessionManager';
import { PiModelInfo, PiUsage } from '../sdk/piTypes';

export interface TurnChange {
    rel: string;
    existed: boolean;
    edits: Array<{ oldText: string; newText: string }> | null;
    /** 本回合首次触碰该文件前的内容快照（write 的 diff / 还原用） */
    before?: string;
    /** write 写入的内容（用于从快照生成 diff） */
    written?: string;
    /** 已算好的整回合 diff（缓存，避免重复计算） */
    diff?: string;
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
