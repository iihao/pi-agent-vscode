// ---------------------------------------------------------------------------
// Recently attached files (persisted in globalState, shown in the "add context" menu)
// ---------------------------------------------------------------------------

import * as vscode from 'vscode';

const KEY = 'pi-agent.recentFiles';
const MAX = 8;

let memento: vscode.Memento | undefined;

/** Global storage injected on activation */
export function initRecentFiles(ctx: vscode.ExtensionContext): void {
    memento = ctx.globalState;
}

/** Recently attached file paths (newest first) */
export function getRecentFiles(): string[] {
    return memento?.get<string[]>(KEY, []) ?? [];
}

/** Record an attachment (dedupe, move to front, cap the list) */
export function addRecentFile(path: string): void {
    if (!memento || !path) { return; }
    const next = [path, ...getRecentFiles().filter((p) => p !== path)].slice(0, MAX);
    void memento.update(KEY, next);
}
