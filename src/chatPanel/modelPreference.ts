// ---------------------------------------------------------------------------
// Preferred model
//
// pi does not persist `set_model`: the choice applies to the running session
// only, and a brand-new session starts on the first entry of the model list
// again. So a model picked in the composer was silently dropped the moment the
// user hit "New chat" and the new session answered with a different model than
// the one the composer had shown.
//
// Remember the explicit choice and re-apply it to new sessions, which keeps the
// composer's model and the session's model from disagreeing.
// ---------------------------------------------------------------------------

import * as vscode from 'vscode';
import { logError } from '../utils/logger';

export interface ModelChoice {
    provider: string;
    id: string;
}

const KEY = 'pi-agent.preferredModel';

let memento: vscode.Memento | undefined;
let cached: ModelChoice | undefined;

/** Global storage injected on activation */
export function initModelPreference(ctx: vscode.ExtensionContext): void {
    memento = ctx.globalState;
    const stored = memento.get<ModelChoice>(KEY);
    cached = stored?.provider && stored.id ? { provider: stored.provider, id: stored.id } : undefined;
}

/** The model the user last picked in the composer, if any */
export function preferredModel(): ModelChoice | undefined {
    return cached;
}

/** Record an explicit model choice (composer pick / cycle) */
export function rememberModel(provider: string, id: string): void {
    if (!provider || !id) { return; }
    if (cached && cached.provider === provider && cached.id === id) { return; }
    cached = { provider, id };
    memento?.update(KEY, cached).then(undefined, (err: unknown) => {
        logError(`saving the preferred model failed: ${(err as Error).message}`);
    });
}

/** Drop the remembered choice (used by tests) */
export function forgetModelPreference(): void {
    cached = undefined;
}
