// ---------------------------------------------------------------------------
// State selectors (only the fields production code actually reads)
// ---------------------------------------------------------------------------

import { ChatStateSelector, TurnChange } from './types';
import { ContextItem } from '../utils/context';
import { PiUsage } from '../sdk/piTypes';

export const selectBusy: ChatStateSelector<boolean> = (state) => state.busy;
export const selectContexts: ChatStateSelector<ContextItem[]> = (state) => state.contexts;
export const selectLastUsage: ChatStateSelector<PiUsage | undefined> = (state) => state.lastUsage;
export const selectPermissionMode: ChatStateSelector<string> = (state) => state.permissionMode;
export const selectTurnChanges: ChatStateSelector<TurnChange[]> = (state) => state.turnChanges;
export const selectPendingNewSession: ChatStateSelector<boolean> = (state) => state.pendingNewSession;
