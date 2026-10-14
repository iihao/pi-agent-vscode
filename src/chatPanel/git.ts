// ---------------------------------------------------------------------------
// Git integration
// ---------------------------------------------------------------------------

import * as vscode from 'vscode';
import { getVSCodeService } from '../services';
import { logError } from '../utils/logger';

const vs = getVSCodeService();

// ---- Minimal vscode.git API types (built-in Git extension) ----
interface GitChange { uri: vscode.Uri; }
interface GitRepository {
    rootUri: vscode.Uri;
    inputBox: { value: string };
    state: {
        HEAD?: { name?: string; commit?: string };
        workingTreeChanges: GitChange[];
        indexChanges: GitChange[];
    };
    diff(cached?: boolean): Promise<string>;
    diffWithHEAD(): Promise<string>;
    log(options?: { maxEntries?: number }): Promise<Array<{ hash: string; message: string }>>;
}
interface GitAPI {
    repositories: GitRepository[];
    getRepository(uri: vscode.Uri): GitRepository | null;
}
interface GitExtension { getAPI(version: 1): GitAPI; }

export async function getGitAPI(): Promise<GitAPI | undefined> {
    const ext = vs.extensions.getExtension<GitExtension>('vscode.git');
    if (!ext) { return undefined; }
    try {
        const exports = ext.isActive ? ext.exports : await ext.activate();
        return exports?.getAPI(1);
    } catch (err) {
        logError(`git extension activation failed: ${(err as Error).message}`);
        return undefined;
    }
}

export function pickGitRepository(api: GitAPI): GitRepository | undefined {
    const active = vs.activeTextEditor?.document.uri;
    if (active) {
        const repo = api.getRepository(active);
        if (repo) { return repo; }
    }
    return api.repositories[0];
}

export function clipDiff(diff: string, max = 12000): string {
    return diff.length > max ? diff.slice(0, max) + '\n… (truncated)' : diff;
}
