// ---------------------------------------------------------------------------
// 会话运行时（Session Runtime）
//
// 一个「会话」= 一个独立的 pi 客户端进程 + 会话管理器 + 会话级状态。
//
// - 每个界面槽位（侧边栏 / 辅助侧边栏 / 编辑器面板）默认各自持有一个运行时，
//   因此三边各自一个会话、可以并行运行、互不影响；
// - 在某个面板里「新建会话」只为它建一个新的运行时，其他面板不受影响；
// - 显式切到某个已在运行的会话时会复用对应运行时（此时才多视图镜像）。
// ---------------------------------------------------------------------------

import { PiClientManager, PiStartOptions } from '../sdk/clientManager';
import { SessionManager } from '../sdk/sessionManager';
import { ChatState, getInitialState } from '../state/types';
import type { ChatPanel } from '../chatPanel';

export class ChatRuntime {
    /** 独立的 pi 客户端（一个进程一个会话） */
    readonly clientManager = new PiClientManager();
    readonly sessionManager = new SessionManager();

    /** 会话级共享状态（busy / contexts / models / sessions / stats …） */
    state: ChatState = getInitialState();

    /** 绑定到本运行时的面板（同一会话的多个视图） */
    readonly panels = new Set<ChatPanel>();

    /** 启动参数：新建会话时 continueRecent=false；打开指定会话时 sessionFile */
    startOptions: PiStartOptions | undefined;

    /** 连接后探测到的 pi 会话 id（用于按会话复用运行时） */
    sessionId: string | undefined;

    /** 连接后探测到的会话文件（重连时复用它，避免又开一个新会话） */
    sessionFile: string | undefined;

    /** 本会话第一条用户消息（用于自动命名） */
    firstUserMessage: string | undefined;

    /** 用户叉掉自动附件后，该文档在本运行时不再自动附加（切文档后恢复） */
    autoContextDismissedDoc: string | undefined;

    /** 已尝试自动命名的会话 id */
    readonly autoNameTried = new Set<string>();
    /** 自动命名 / 压缩进行中，避免同一运行时多面板重复触发 */
    autoNameInFlight = false;
    compactInFlight = false;

    /** 本回合改动撤销快照（「撤销的撤销」），按会话隔离 */
    readonly revertSnapshot = new Map<string, { content: string | null; existed: boolean }>();
}

export class ChatRuntimeRegistry {
    private _runtimes: ChatRuntime[] = [];
    /** 界面槽位（侧边栏 / 辅助侧边栏 / 编辑器面板）→ 当前运行时 */
    private _surfaces = new Map<string, ChatRuntime>();

    /**
     * 某个界面槽位当前使用的运行时；没有就新建。
     * 每个界面默认各自独立（独立会话、可并行），互不镜像；
     * 只有显式切到同一个会话时才会共享同一运行时。
     *
     * 首个界面续接最近的会话（继续上次），其余界面默认新开一个，
     * 避免多个界面同时打开同一个会话文件。
     */
    public forSurface(key: string): ChatRuntime {
        let runtime = this._surfaces.get(key);
        if (!runtime) {
            const first = this._surfaces.size === 0;
            runtime = this.create(first ? undefined : { continueRecent: false });
            this._surfaces.set(key, runtime);
        }
        return runtime;
    }

    /** 把某个界面槽位切到指定运行时（新建会话 / 切到别的会话） */
    public bindSurface(key: string, runtime: ChatRuntime): void {
        this._surfaces.set(key, runtime);
    }

    public create(startOptions?: PiStartOptions): ChatRuntime {
        const runtime = new ChatRuntime();
        runtime.startOptions = startOptions;
        this._runtimes.push(runtime);
        return runtime;
    }

    public bySessionId(sessionId: string | undefined): ChatRuntime | undefined {
        if (!sessionId) { return undefined; }
        return this._runtimes.find((r) => r.sessionId === sessionId);
    }

    public all(): readonly ChatRuntime[] { return this._runtimes; }

    /** 该运行时是否仍被某个界面槽位引用 */
    private _isMapped(runtime: ChatRuntime): boolean {
        for (const r of this._surfaces.values()) { if (r === runtime) { return true; } }
        return false;
    }

    /** 释放不再被任何面板 / 界面引用的运行时，并停掉其 pi 进程。 */
    public async release(runtime: ChatRuntime): Promise<void> {
        if (runtime.panels.size > 0) { return; }
        if (this._isMapped(runtime)) { return; }
        this._runtimes = this._runtimes.filter((r) => r !== runtime);
        await runtime.clientManager.stop().catch(() => { /* 忽略停止失败 */ });
    }

    /** 停掉所有运行时（扩展停用时调用）。 */
    public async stopAll(): Promise<void> {
        const all = this._runtimes;
        this._runtimes = [];
        this._surfaces.clear();
        await Promise.all(all.map((r) => r.clientManager.stop().catch(() => { /* 忽略 */ })));
    }
}
