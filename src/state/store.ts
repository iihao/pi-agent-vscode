// ---------------------------------------------------------------------------
// 集中式状态存储（观察者模式）
// ---------------------------------------------------------------------------

import { EventEmitter } from 'events';
import { ChatState, ChatStateListener, getInitialState } from './types';

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
        const prevState = this.state;
        this.state = { ...this.state, ...partial };
        
        // 只在状态真正变化时通知
        if (JSON.stringify(prevState) !== JSON.stringify(this.state)) {
            this.emit('change', this.state);
            this.notifyListeners();
        }
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
