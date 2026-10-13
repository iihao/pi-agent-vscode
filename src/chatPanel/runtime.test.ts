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
        // 同一槽位复用时拿到同一个运行时
        expect(reg.forSurface('sidebar')).toBe(sidebar);
        expect(reg.forSurface('secondary')).toBe(secondary);
    });

    it('first surface continues the last session, later surfaces start fresh', () => {
        const reg = new ChatRuntimeRegistry();
        const first = reg.forSurface('sidebar');
        const second = reg.forSurface('secondary');
        // 首个界面不传 startOptions → pi 用 --continue 续接最近会话
        expect(first.startOptions).toBeUndefined();
        // 后续界面明确新开，避免多进程争用同一会话文件
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
        // 清空后再取槽位会得到一个新的运行时
        expect(reg.forSurface('sidebar')).toBeTruthy();
        expect(reg.all()).toHaveLength(1);
    });
});
