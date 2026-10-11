// ---------------------------------------------------------------------------
// 共享聊天状态单例
//
// 没有任何订阅方，因此不保留观察者机制；读取统一走 select()。
// ---------------------------------------------------------------------------

import { ChatState, getInitialState } from './types';

class StateStore {
    private state: ChatState = getInitialState();

    public setState(partial: Partial<ChatState>): void {
        this.state = { ...this.state, ...partial };
    }

    public select<T>(selector: (state: ChatState) => T): T {
        return selector(this.state);
    }
}

export const stateStore = new StateStore();

export const setState = (partial: Partial<ChatState>): void => stateStore.setState(partial);
