// ---------------------------------------------------------------------------
// 集中式状态存储（观察者模式）
// ---------------------------------------------------------------------------

import { EventEmitter } from 'events';
import { ChatState, ChatStateListener, getInitialState } from './types';

/** 浅比较：原始值用 ===，数组按元素比较。避免对整状态做 JSON.stringify。 */
function shallowEqual(a: unknown, b: unknown): boolean {
    if (a === b) { return true; }
    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) { return false; }
        for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) { return false; }
        }
        return true;
    }
    return false;
}

class StateStore extends EventEmitter {
    private state: ChatState;
    private stateListeners: Set<ChatStateListener> = new Set();

    constructor() {
        super();
        this.state = getInitialState();
    }

    public getState(): ChatState {
        return { ...this.state };
    }

    public setState(partial: Partial<ChatState>): void {
        // 只在状态真正变化时通知（浅比较，不做整状态序列化）
        let changed = false;
        for (const key of Object.keys(partial) as Array<keyof ChatState>) {
            if (!shallowEqual(this.state[key], partial[key])) { changed = true; break; }
        }
        if (!changed) { return; }
        this.state = { ...this.state, ...partial };
        this.emit('change', this.state);
        this.notifyListeners();
    }

    public subscribe(listener: ChatStateListener): () => void {
        this.stateListeners.add(listener);
        // 立即通知当前状态
        listener(this.getState());
        return () => {
            this.stateListeners.delete(listener);
        };
    }

    public select<T>(selector: (state: ChatState) => T): T {
        return selector(this.state);
    }

    private notifyListeners(): void {
        const state = this.getState();
        this.stateListeners.forEach((listener) => {
            try {
                listener(state);
            } catch (err) {
                console.error('State listener failed:', err);
            }
        });
    }
}

// 单例导出
export const stateStore = new StateStore();

// 便捷方法
export const getState = (): ChatState => stateStore.getState();
export const setState = (partial: Partial<ChatState>): void => stateStore.setState(partial);
export const subscribeToState = (listener: ChatStateListener): (() => void) => stateStore.subscribe(listener);
