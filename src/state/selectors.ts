// ---------------------------------------------------------------------------
// 状态选择器
// ---------------------------------------------------------------------------

import { ChatState, ChatStateSelector } from './types';
import { ContextItem, SessionInfo } from './contextTypes';

// UI 状态选择器
export const selectBusy: ChatStateSelector<boolean> = (state) => state.busy;
export const selectTurnHadText: ChatStateSelector<boolean> = (state) => state.turnHadText;

// 上下文状态选择器
export const selectContexts: ChatStateSelector<ContextItem[]> = (state) => state.contexts;
export const selectContextsCount: ChatStateSelector<number> = (state) => state.contexts.length;

// 使用统计选择器
export const selectLastUsage: ChatStateSelector<ChatState['lastUsage']> = (state) => state.lastUsage;
export const selectStats: ChatStateSelector<ChatState['stats']> = (state) => state.stats;

// 会话状态选择器
export const selectSessions: ChatStateSelector<SessionInfo[]> = (state) => state.sessions;
export const selectCurrentSessionId: ChatStateSelector<string | undefined> = (state) => state.currentSessionId;
export const selectCurrentSession: ChatStateSelector<SessionInfo | undefined> = (state) =>
    state.sessions.find((s) => s.id === state.currentSessionId);

// 模型状态选择器
export const selectModels: ChatStateSelector<ChatState['models']> = (state) => state.models;
export const selectCurrentModel: ChatStateSelector<ChatState['currentModel']> = (state) => state.currentModel;
export const selectThinkingLevels: ChatStateSelector<string[]> = (state) => state.thinkingLevels;
export const selectCurrentThinking: ChatStateSelector<string | null> = (state) => state.currentThinking;

// 权限状态选择器
export const selectPermissionMode: ChatStateSelector<string> = (state) => state.permissionMode;

// 连接状态选择器
export const selectConnected: ChatStateSelector<boolean> = (state) => state.connected;
export const selectConnecting: ChatStateSelector<boolean> = (state) => state.connecting;

// 组合选择器
export const selectIsReady: ChatStateSelector<boolean> = (state) =>
    state.connected && !state.busy && !state.connecting;

export const selectHasContexts: ChatStateSelector<boolean> = (state) =>
    state.contexts.length > 0;

export const selectSessionCount: ChatStateSelector<number> = (state) =>
    state.sessions.length;

export const selectModelCount: ChatStateSelector<number> = (state) =>
    state.models.length;
