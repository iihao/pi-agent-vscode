// ---------------------------------------------------------------------------
// Session runtime
//
// One "session" = one independent pi client process + session manager + state.
//
// - Each surface slot (sidebar / secondary sidebar / editor panel) owns its own
//   runtime by default, so all three get their own session, run in parallel and
//   never affect each other;
// - "New chat" in a panel only creates a new runtime for that panel;
// - Switching a panel to a session that is already running reuses that runtime
//   (only then do multiple views mirror).
// ---------------------------------------------------------------------------

import { PiClientManager, PiStartOptions } from '../sdk/clientManager';
import { SessionManager } from '../sdk/sessionManager';
import { ChatState, getInitialState } from '../state/types';
import type { ChatPanel } from '../chatPanel';

export class ChatRuntime {
    /** Independent pi client (one process per session) */
    readonly clientManager = new PiClientManager();
    readonly sessionManager = new SessionManager();

    /** Session-level shared state (busy / contexts / models / sessions / stats ...) */
    state: ChatState = getInitialState();

    /** Panels bound to this runtime (multiple views of one session) */
    readonly panels = new Set<ChatPanel>();

    /** Start options: continueRecent=false for a new session; sessionFile to open a specific one */
    startOptions: PiStartOptions | undefined;

    /** pi session id discovered after connecting (used to reuse a runtime per session) */
    sessionId: string | undefined;

    /** Session file discovered after connecting (reused on reconnect so a new session isn't started) */
    sessionFile: string | undefined;

    /** First user message of this session (for auto-naming) */
    firstUserMessage: string | undefined;

    /** After the user removes the auto attachment, that document is not auto-attached again in this runtime (until the document changes) */
    autoContextDismissedDoc: string | undefined;

    /** Session ids we already attempted to auto-name */
    readonly autoNameTried = new Set<string>();
    /** Auto-name / compact in flight, so multiple panels on one runtime don't retrigger them */
    autoNameInFlight = false;
    compactInFlight = false;

    /** Per-turn revert snapshot (undo of a revert), isolated per session */
    readonly revertSnapshot = new Map<string, { content: string | null; existed: boolean }>();
}

export class ChatRuntimeRegistry {
    private _runtimes: ChatRuntime[] = [];
    /** Surface slot (sidebar / secondary sidebar / editor panel) -> current runtime */
    private _surfaces = new Map<string, ChatRuntime>();

    /**
     * The runtime a surface slot currently uses; creates one if needed.
     * Each surface is independent by default (own session, run in parallel) and
     * never mirrors; they only share a runtime when explicitly switched to the
     * same session.
     *
     * The first surface continues the most recent session; later ones start
     * fresh so two surfaces never open the same session file at once.
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

    /** Point a surface slot at a runtime (new session / switching sessions) */
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

    /** Whether any surface slot still references this runtime */
    private _isMapped(runtime: ChatRuntime): boolean {
        for (const r of this._surfaces.values()) { if (r === runtime) { return true; } }
        return false;
    }

    /** Release a runtime no longer referenced by any panel / surface and stop its pi process. */
    public async release(runtime: ChatRuntime): Promise<void> {
        if (runtime.panels.size > 0) { return; }
        if (this._isMapped(runtime)) { return; }
        this._runtimes = this._runtimes.filter((r) => r !== runtime);
        await runtime.clientManager.stop().catch(() => { /* ignore stop failure */ });
    }

    /** Stop every runtime (called when the extension deactivates). */
    public async stopAll(): Promise<void> {
        const all = this._runtimes;
        this._runtimes = [];
        this._surfaces.clear();
        await Promise.all(all.map((r) => r.clientManager.stop().catch(() => { /* ignore */ })));
    }
}
