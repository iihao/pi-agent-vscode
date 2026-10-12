// ---------------------------------------------------------------------------
// 状态选择器（仅保留生产代码实际读取的字段）
// ---------------------------------------------------------------------------

import { ChatStateSelector, TurnChange } from './types';
import { ContextItem } from '../utils/context';
import { PiUsage } from '../sdk/piTypes';

export const selectBusy: ChatStateSelector<boolean> = (state) => state.busy;
export const selectTurnHadText: ChatStateSelector<boolean> = (state) => state.turnHadText;
export const selectContexts: ChatStateSelector<ContextItem[]> = (state) => state.contexts;
export const selectLastUsage: ChatStateSelector<PiUsage | undefined> = (state) => state.lastUsage;
export const selectPermissionMode: ChatStateSelector<string> = (state) => state.permissionMode;
export const selectTurnChanges: ChatStateSelector<TurnChange[]> = (state) => state.turnChanges;
export const selectPendingNewSession: ChatStateSelector<boolean> = (state) => state.pendingNewSession;
