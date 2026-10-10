import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getState, setState, subscribeToState } from './store';
import { getInitialState } from './types';

describe('StateStore', () => {
    beforeEach(() => {
        // 重置状态
        setState(getInitialState());
    });

    it('should return initial state', () => {
        const state = getState();
        expect(state.busy).toBe(false);
        expect(state.connected).toBe(false);
        expect(state.contexts).toEqual([]);
        expect(state.sessions).toEqual([]);
    });

    it('should update state with setState', () => {
        setState({ busy: true });
        expect(getState().busy).toBe(true);
    });

    it('should merge partial state', () => {
        setState({ busy: true, connected: true });
        const state = getState();
        expect(state.busy).toBe(true);
        expect(state.connected).toBe(true);
        expect(state.contexts).toEqual([]);
    });

    it('should notify listeners on state change', () => {
        const listener = vi.fn();
        subscribeToState(listener);

        setState({ busy: true });

        expect(listener).toHaveBeenCalled();
        const lastCall = listener.mock.calls[listener.mock.calls.length - 1];
        expect(lastCall[0].busy).toBe(true);
    });

    it('should not notify listeners when state does not change', () => {
        const listener = vi.fn();
        subscribeToState(listener);

        // 重置为相同状态
        setState(getInitialState());

        // 只有初始订阅时的调用
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('should unsubscribe correctly', () => {
        const listener = vi.fn();
        const unsubscribe = subscribeToState(listener);

        unsubscribe();
        setState({ busy: true });

        // 只有初始订阅时的调用
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('should handle multiple listeners', () => {
        const listener1 = vi.fn();
        const listener2 = vi.fn();

        subscribeToState(listener1);
        subscribeToState(listener2);

        setState({ busy: true });

        expect(listener1).toHaveBeenCalled();
        expect(listener2).toHaveBeenCalled();
    });

    it('should return a copy of state', () => {
        const state1 = getState();
        const state2 = getState();

        expect(state1).not.toBe(state2);
        expect(state1).toEqual(state2);
    });
});
