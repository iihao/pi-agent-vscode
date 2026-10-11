// ---------------------------------------------------------------------------
// VSCode API 服务接口
// ---------------------------------------------------------------------------

import * as vscode from 'vscode';

export interface IVSCodeService {
    // 消息提示
    showInformationMessage(message: string, ...items: string[]): Thenable<string | undefined>;
    showWarningMessage(message: string, ...items: string[]): Thenable<string | undefined>;
    showErrorMessage(message: string, ...items: string[]): Thenable<string | undefined>;

    // 配置
    getConfiguration(section: string): vscode.WorkspaceConfiguration;

    // 命令
    registerCommand(command: string, callback: (...args: any[]) => any): vscode.Disposable;

    // 工作区
    workspaceFolders: readonly vscode.WorkspaceFolder[] | undefined;
    asRelativePath(path: string): string;

    // 编辑器
    activeTextEditor: vscode.TextEditor | undefined;

    // 剪贴板
    clipboard: vscode.Clipboard;

    // 环境
    language: string;
    appName: string;
    version: string;
}

export class VSCodeService implements IVSCodeService {
    public get showInformationMessage() {
        return vscode.window.showInformationMessage;
    }

    public get showWarningMessage() {
        return vscode.window.showWarningMessage;
    }

    public get showErrorMessage() {
        return vscode.window.showErrorMessage;
    }

    public get getConfiguration() {
        return vscode.workspace.getConfiguration;
    }

    public get registerCommand() {
        return vscode.commands.registerCommand;
    }

    public get workspaceFolders() {
        return vscode.workspace.workspaceFolders;
    }

    public get asRelativePath() {
        return vscode.workspace.asRelativePath;
    }

    public get activeTextEditor() {
        return vscode.window.activeTextEditor;
    }

    public get clipboard() {
        return vscode.env.clipboard;
    }

    public get language() {
        return vscode.env.language;
    }

    public get appName() {
        return vscode.env.appName;
    }

    public get version() {
        return vscode.version;
    }
}
