import * as vscode from 'vscode';
import { ChatPanel } from './chatPanel';

export function activate(context: vscode.ExtensionContext) {
    console.log('Pi Assistant 已激活（基于本地 pi agent）');

    // ---- 打开对话面板 ----
    const openChat = vscode.commands.registerCommand('pi-assistant.openChat', () => {
        ChatPanel.createOrShow(context.extensionPath);
    });

    // ---- 解释选中代码 ----
    const explainCode = vscode.commands.registerCommand('pi-assistant.explainCode', async () => {
        const ctx = getSelectionContext();
        if (!ctx) {
            return;
        }
        const panel = ChatPanel.createOrShow(context.extensionPath);
        await panel.askQuestion(
            `请解释 ${ctx.relPath} 第 ${ctx.lineRange} 行（当前选中）的代码：\n\n\`\`\`${ctx.languageId}\n${ctx.code}\n\`\`\`\n\n说明整体功能、关键逻辑与潜在问题。`
        );
    });

    // ---- 重构选中代码 ----
    const refactorCode = vscode.commands.registerCommand('pi-assistant.refactorCode', async () => {
        const ctx = getSelectionContext();
        if (!ctx) {
            return;
        }
        const panel = ChatPanel.createOrShow(context.extensionPath);
        await panel.askQuestion(
            `请重构 ${ctx.relPath} 第 ${ctx.lineRange} 行（当前选中）的代码：\n\n\`\`\`${ctx.languageId}\n${ctx.code}\n\`\`\`\n\n要求：提高可读性、修复潜在问题、保持对外行为不变。直接修改文件并说明改动理由。`
        );
    });

    // ---- 生成代码 ----
    const generateCode = vscode.commands.registerCommand('pi-assistant.generateCode', async () => {
        const description = await vscode.window.showInputBox({
            prompt: '描述你想生成的代码',
            placeHolder: '例如：一个带重试的 HTTP 请求函数',
            ignoreFocusOut: true,
        });
        if (!description) {
            return;
        }
        const editor = vscode.window.activeTextEditor;
        const locationHint = editor
            ? `\n\n目标文件：${vscode.workspace.asRelativePath(editor.document.uri)}（语言：${editor.document.languageId}）`
            : '';
        const panel = ChatPanel.createOrShow(context.extensionPath);
        await panel.askQuestion(`请实现以下功能：${description}${locationHint}`);
    });

    // ---- 清空对话 ----
    const clearChat = vscode.commands.registerCommand('pi-assistant.clearChat', () => {
        if (ChatPanel.currentPanel) {
            ChatPanel.currentPanel.clear();
        } else {
            vscode.window.showInformationMessage('Pi 对话面板尚未打开');
        }
    });

    // 状态栏按钮
    const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBar.text = '$(sparkle) Pi';
    statusBar.tooltip = '打开 Pi Assistant（本地 pi agent）';
    statusBar.command = 'pi-assistant.openChat';
    statusBar.show();

    context.subscriptions.push(
        openChat,
        explainCode,
        refactorCode,
        generateCode,
        clearChat,
        statusBar
    );
}

/** 获取当前编辑器选区上下文（无选区时提示并返回 undefined） */
function getSelectionContext(): {
    relPath: string;
    languageId: string;
    code: string;
    lineRange: string;
} | undefined {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty) {
        vscode.window.showWarningMessage('请先选中一段代码');
        return undefined;
    }
    const sel = editor.selection;
    const code = editor.document.getText(sel);
    const relPath = vscode.workspace.asRelativePath(editor.document.uri);
    const lineRange = sel.start.line === sel.end.line
        ? `${sel.start.line + 1}`
        : `${sel.start.line + 1}-${sel.end.line + 1}`;
    return {
        relPath,
        languageId: editor.document.languageId,
        code,
        lineRange,
    };
}

export function deactivate() {
    // 面板由 VSCode 自动销毁
}
