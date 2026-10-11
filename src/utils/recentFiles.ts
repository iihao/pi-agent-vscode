// ---------------------------------------------------------------------------
// 最近附加的文件（持久化在 globalState，供「+ 添加上下文」菜单展示）
// ---------------------------------------------------------------------------

import * as vscode from 'vscode';

const KEY = 'pi-agent.recentFiles';
const MAX = 8;

let memento: vscode.Memento | undefined;

/** 扩展激活时注入全局存储 */
export function initRecentFiles(ctx: vscode.ExtensionContext): void {
    memento = ctx.globalState;
}

/** 最近附加的文件路径（最新在前） */
export function getRecentFiles(): string[] {
    return memento?.get<string[]>(KEY, []) ?? [];
}

/** 记录一次附加（去重、置顶、限量） */
export function addRecentFile(path: string): void {
    if (!memento || !path) { return; }
    const next = [path, ...getRecentFiles().filter((p) => p !== path)].slice(0, MAX);
    void memento.update(KEY, next);
}
