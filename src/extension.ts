import * as vscode from 'vscode';
import { ChatPanel } from './chatPanel';

export function activate(context: vscode.ExtensionContext) {
    console.log('Pi Assistant 已激活');

    // ---- 打开对话面板 ----
    const openChat = vscode.commands.registerCommand('pi-assistant.openChat', () => {
        ChatPanel.createOrShow(context.extensionUri);
    });

    // ---- 解释选中代码 ----
    const explainCode = vscode.commands.registerCommand('pi-assistant.explainCode', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.selection.isEmpty) {
            vscode.window.showWarningMessage('请先选中要解释的代码');
            return;
        }
        const panel = ChatPanel.createOrShow(context.extensionUri);
        await panel.askQuestion('请解释这段代码的功能和关键逻辑，指出潜在问题。');
    });

    // ---- 重构选中代码 ----
    const refactorCode = vscode.commands.registerCommand('pi-assistant.refactorCode', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.selection.isEmpty) {
            vscode.window.showWarningMessage('请先选中要重构的代码');
            return;
        }
        const panel = ChatPanel.createOrShow(context.extensionUri);
        await panel.askQuestion('请重构这段代码：提高可读性、修复潜在问题、保持对外行为不变，并简要说明改动理由。');
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
        const panel = ChatPanel.createOrShow(context.extensionUri);
        await panel.askQuestion(`请实现以下功能：${description}`);
    });

    // ---- 设置 API Key ----
    const setApiKey = vscode.commands.registerCommand('pi-assistant.setApiKey', async () => {
        const config = vscode.workspace.getConfiguration('pi-assistant');
        const current = config.get<string>('apiKey', '');
        const key = await vscode.window.showInputBox({
            prompt: current ? '当前已配置 API Key，输入新的以替换' : '请输入 Anthropic API Key',
            placeHolder: 'sk-ant-...',
            password: true,
            ignoreFocusOut: true,
        });
        if (key) {
            await config.update('apiKey', key, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage('API Key 已保存');
        }
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
    statusBar.tooltip = '打开 Pi Assistant 对话面板';
    statusBar.command = 'pi-assistant.openChat';
    statusBar.show();

    context.subscriptions.push(
        openChat,
        explainCode,
        refactorCode,
        generateCode,
        setApiKey,
        clearChat,
        statusBar
    );
}

export function deactivate() {
    // 面板由 VSCode 自动销毁
}
