// ---------------------------------------------------------------------------
// 原生 Chat 参与者（@pi）
//
// 把 pi 的流式输出接到 VS Code 的 Chat 视图。pi 每次请求都用一个临时
// （--no-session）进程，避免与侧边栏聊天共用会话互相干扰。
// ---------------------------------------------------------------------------

import * as vscode from 'vscode';
import { PiClientManager } from './sdk/clientManager';
import { logError } from './utils/logger';

export const PARTICIPANT_ID = 'pi-agent.pi';

/** 由 Chat 请求构造发给 pi 的提示词：合并引用与命令前缀 */
export function buildParticipantPrompt(request: vscode.ChatRequest): string {
    const parts: string[] = [];
    for (const ref of request.references) {
        const v = ref.value;
        if (typeof v === 'string') {
            parts.push(v);
        } else if (v && typeof (v as { fsPath?: unknown }).fsPath === 'string') {
            parts.push('@' + vscode.workspace.asRelativePath(v as vscode.Uri, false));
        }
    }
    let prompt = request.prompt;
    if (request.command === 'explain') {
        prompt = prompt ? `Explain the following:\n\n${prompt}` : 'Explain the selected code.';
    }
    if (parts.length) { prompt = parts.join('\n') + '\n\n' + prompt; }
    return prompt;
}

/** 注册 @pi 聊天参与者（在支持 Chat API 的 VS Code 上） */
export function registerChatParticipant(context: vscode.ExtensionContext): void {
    const chat = (vscode as { chat?: typeof vscode.chat }).chat;
    if (!chat || typeof chat.createChatParticipant !== 'function') { return; }

    const manager = new PiClientManager();

    const handler: vscode.ChatRequestHandler = async (request, _context, stream, token) => {
        const prompt = buildParticipantPrompt(request);
        let wrote = false;
        try {
            await manager.runStreaming(context.extensionPath, prompt, (delta) => {
                wrote = true;
                stream.markdown(delta);
            }, token);
        } catch (err) {
            logError(`chat participant failed: ${(err as Error).message}`);
            stream.markdown(vscode.l10n.t('Pi failed: {0}', (err as Error).message));
            return;
        }
        if (!wrote) { stream.markdown(vscode.l10n.t('Pi returned no output.')); }
        stream.button({ command: 'pi-agent.openChat', title: vscode.l10n.t('Open in Pi panel') });
    };

    const participant = chat.createChatParticipant(PARTICIPANT_ID, handler);
    try {
        participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'assets', 'icon.png');
    } catch (err) {
        logError(`participant icon failed: ${(err as Error).message}`);
    }
    context.subscriptions.push(participant);
}
