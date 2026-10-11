import { describe, it, expect, beforeEach } from 'vitest';
import {
    selectBusy,
    selectContexts,
    selectLastUsage,
    selectPermissionMode,
    selectTurnHadText,
} from './selectors';
import { stateStore, setState } from './store';
import { ChatState, getInitialState } from './types';

const read = <T>(selector: (state: ChatState) => T): T => stateStore.select(selector);

describe('state selectors', () => {
    beforeEach(() => {
        setState(getInitialState());
    });

    it('selectBusy reflects the busy flag', () => {
        expect(read(selectBusy)).toBe(false);
        setState({ busy: true });
        expect(read(selectBusy)).toBe(true);
    });

    it('selectTurnHadText reflects the turn text flag', () => {
        expect(read(selectTurnHadText)).toBe(false);
        setState({ turnHadText: true });
        expect(read(selectTurnHadText)).toBe(true);
    });

    it('selectContexts returns the attached contexts', () => {
        expect(read(selectContexts)).toEqual([]);
        const contexts = [{ id: 'c1', type: 'selection' as const, path: 'b.ts', lineRange: '3-5' }];
        setState({ contexts });
        expect(read(selectContexts)).toEqual(contexts);
    });

    it('selectLastUsage returns the last reported usage', () => {
        expect(read(selectLastUsage)).toBeUndefined();
        setState({ lastUsage: { input: 10, output: 20, cacheRead: 5 } });
        expect(read(selectLastUsage)).toEqual({ input: 10, output: 20, cacheRead: 5 });
    });

    it('selectPermissionMode returns the permission mode', () => {
        expect(read(selectPermissionMode)).toBe('ask');
        setState({ permissionMode: 'restricted' });
        expect(read(selectPermissionMode)).toBe('restricted');
    });
});
