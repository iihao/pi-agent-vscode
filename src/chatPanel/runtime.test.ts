import { describe, it, expect } from 'vitest';
import { ChatRuntimeRegistry } from './runtime';

describe('ChatRuntimeRegistry', () => {
    it('creates runtimes with isolated state', () => {
        const reg = new ChatRuntimeRegistry();
        const a = reg.create({ continueRecent: false });
        const b = reg.create();
        a.state.busy = true;
        a.state.contexts = [{ id: 'x', type: 'file', path: 'a.ts' }];
        expect(b.state.busy).toBe(false);
        expect(b.state.contexts).toEqual([]);
        expect(reg.all()).toHaveLength(2);
    });

    it('gives each surface slot its own runtime, stably', () => {
        const reg = new ChatRuntimeRegistry();
        const sidebar = reg.forSurface('sidebar');
        const secondary = reg.forSurface('secondary');
        expect(sidebar).not.toBe(secondary);
        // Reusing a slot returns the same runtime
        expect(reg.forSurface('sidebar')).toBe(sidebar);
        expect(reg.forSurface('secondary')).toBe(secondary);
    });

    it('first surface continues the last session, later surfaces start fresh', () => {
        const reg = new ChatRuntimeRegistry();
        const first = reg.forSurface('sidebar');
        const second = reg.forSurface('secondary');
        // The first surface passes no startOptions -> pi uses --continue to resume the most recent session
        expect(first.startOptions).toBeUndefined();
        // Later surfaces explicitly start fresh, so two processes never contend for the same session file
        expect(second.startOptions).toEqual({ continueRecent: false });
    });

    it('bindSurface points a slot at another runtime (explicit mirror)', () => {
        const reg = new ChatRuntimeRegistry();
        const sidebar = reg.forSurface('sidebar');
        reg.forSurface('secondary');
        reg.bindSurface('secondary', sidebar);
        expect(reg.forSurface('secondary')).toBe(sidebar);
    });

    it('finds a runtime by session id', () => {
        const reg = new ChatRuntimeRegistry();
        const a = reg.create();
        a.sessionId = 'S1';
        expect(reg.bySessionId('S1')).toBe(a);
        expect(reg.bySessionId('nope')).toBeUndefined();
        expect(reg.bySessionId(undefined)).toBeUndefined();
    });

    it('does not release a runtime that still has panels', async () => {
        const reg = new ChatRuntimeRegistry();
        const rt = reg.create();
        (rt.panels as unknown as Set<unknown>).add({});
        await reg.release(rt);
        expect(reg.all()).toContain(rt);
    });

    it('does not release a runtime still bound to a surface slot', async () => {
        const reg = new ChatRuntimeRegistry();
        const rt = reg.forSurface('sidebar');
        await reg.release(rt);
        expect(reg.all()).toContain(rt);
    });

    it('releases an unreferenced runtime', async () => {
        const reg = new ChatRuntimeRegistry();
        const rt = reg.create();
        await reg.release(rt);
        expect(reg.all()).not.toContain(rt);
    });

    it('stopAll clears every runtime and slot', async () => {
        const reg = new ChatRuntimeRegistry();
        reg.forSurface('sidebar');
        reg.create();
        await reg.stopAll();
        expect(reg.all()).toHaveLength(0);
        // After clearing, asking for the slot yields a new runtime
        expect(reg.forSurface('sidebar')).toBeTruthy();
        expect(reg.all()).toHaveLength(1);
    });
});
