// ---------------------------------------------------------------------------
// 输出通道 + 内存环形缓冲（供诊断导出）
// ---------------------------------------------------------------------------

import * as vscode from 'vscode';

export type LogLevel = 'error' | 'info' | 'debug';

let channel: vscode.OutputChannel | undefined;
let level: LogLevel = 'info';
const buffer: string[] = [];
const MAX_LINES = 2000;

export function initLogger(): vscode.OutputChannel {
    if (!channel) {
        channel = vscode.window.createOutputChannel('Pi Agent');
    }
    return channel;
}

export function setLogLevel(next: LogLevel): void {
    level = next;
}

function write(tag: string, msg: string): void {
    const line = `[${new Date().toISOString()}] [${tag}] ${msg}`;
    buffer.push(line);
    if (buffer.length > MAX_LINES) { buffer.shift(); }
    channel?.appendLine(line);
}

export function logInfo(msg: string): void {
    if (level !== 'error') { write('info', msg); }
}

export function logError(msg: string): void {
    write('error', msg);
}

/** 显示输出通道（错误气泡里的「查看日志」） */
export function showLogs(): void {
    channel?.show(true);
}

/** 导出诊断文本（日志 + 基本环境信息） */
export function buildDiagnostics(extensionPath: string): string {
    const header = [
        vscode.l10n.t('# Pi Agent diagnostics'),
        vscode.l10n.t('Time: {0}', new Date().toISOString()),
        vscode.l10n.t('VSCode: {0}', vscode.version),
        vscode.l10n.t('Platform: {0} {1}', process.platform, process.arch),
        vscode.l10n.t('Node: {0}', process.version),
        vscode.l10n.t('Extension path: {0}', extensionPath),
        vscode.l10n.t('Log level: {0}', level),
        '',
        vscode.l10n.t('## Log'),
        '',
    ].join('\n');
    return header + buffer.join('\n') + '\n';
}
