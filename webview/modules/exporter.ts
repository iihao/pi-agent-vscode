// ---------------------------------------------------------------------------
// 导出对话为 Markdown
// ---------------------------------------------------------------------------

import type { WebviewContext } from '../types';
import { getAllMessages } from './search';

let ctx: WebviewContext;

export function initExporter(c: WebviewContext): void {
    ctx = c;
}

export function exportConversation(): void {
    const S = ctx.S;
    const messages = getAllMessages();
    if (messages.length === 0) {
        ctx.vscode.postMessage({ type: 'notify', text: S.exportEmpty });
        return;
    }
    let markdown = S.exportHeader + '\n\n';
    markdown += S.exportTime + new Date().toLocaleString() + '\n\n---\n\n';
    messages.forEach(function (m) {
        const role = m.role === 'user' ? '**' + S.you + '**' : '**Pi**';
        markdown += '### ' + role + '\n\n' + m.text + '\n\n---\n\n';
    });
    ctx.vscode.postMessage({ type: 'exportConversation', markdown: markdown });
}
