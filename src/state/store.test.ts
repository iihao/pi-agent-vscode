import { describe, it, expect, beforeEach } from 'vitest';
import { stateStore, setState } from './store';
import { getInitialState } from './types';

describe('stateStore', () => {
    beforeEach(() => {
        setState(getInitialState());
    });

    it('starts from the initial state', () => {
        expect(stateStore.select((s) => s.busy)).toBe(false);
        expect(stateStore.select((s) => s.turnHadText)).toBe(false);
        expect(stateStore.select((s) => s.contexts)).toEqual([]);
        expect(stateStore.select((s) => s.lastUsage)).toBeUndefined();
    });

    it('merges a partial update', () => {
        setState({ busy: true });
        expect(stateStore.select((s) => s.busy)).toBe(true);
        expect(stateStore.select((s) => s.turnHadText)).toBe(false);
    });

    it('keeps unrelated fields when merging', () => {
        setState({ busy: true, turnHadText: true });
        setState({ busy: false });
        expect(stateStore.select((s) => s.busy)).toBe(false);
        expect(stateStore.select((s) => s.turnHadText)).toBe(true);
    });

    it('stores object values and clears them when set to undefined', () => {
        setState({ lastUsage: { input: 3, output: 1 } });
        expect(stateStore.select((s) => s.lastUsage)).toEqual({ input: 3, output: 1 });
        setState({ lastUsage: undefined });
        expect(stateStore.select((s) => s.lastUsage)).toBeUndefined();
    });

    it('replaces the contexts array', () => {
        setState({ contexts: [{ id: 'a', type: 'file', path: 'a.ts' }] });
        expect(stateStore.select((s) => s.contexts)).toHaveLength(1);
        setState({ contexts: [] });
        expect(stateStore.select((s) => s.contexts)).toEqual([]);
    });
});
