// ---------------------------------------------------------------------------
// VSCode API 服务接口（交互 / 工作区 / 编辑器 / 环境的可测试封装）
// ---------------------------------------------------------------------------

import * as vscode from 'vscode';

export interface IVSCodeService {
    // 消息提示
    showInformationMessage(message: string, ...items: any[]): Thenable<string | undefined>;
    showWarningMessage(message: string, ...items: any[]): Thenable<string | undefined>;
    showErrorMessage(message: string, ...items: any[]): Thenable<string | undefined>;

    // 输入
    showInputBox(options?: vscode.InputBoxOptions): Thenable<string | undefined>;
    showQuickPick<T = string>(items: readonly any[], options?: vscode.QuickPickOptions): Thenable<T | undefined>;
    showSaveDialog(options?: vscode.SaveDialogOptions): Thenable<vscode.Uri | undefined>;
    showOpenDialog(options?: vscode.OpenDialogOptions): Thenable<vscode.Uri[] | undefined>;

    // 编辑器 / 文档
    showTextDocument(document: vscode.TextDocument, options?: vscode.TextDocumentShowOptions): Thenable<vscode.TextEditor>;
    openTextDocument(options: any): Thenable<vscode.TextDocument>;
    activeTextEditor: vscode.TextEditor | undefined;
    applyEdit(edit: vscode.WorkspaceEdit): Thenable<boolean>;

    // 配置 / 命令
    getConfiguration(section?: string): vscode.WorkspaceConfiguration;
    registerCommand(command: string, callback: (...args: any[]) => any): vscode.Disposable;
    executeCommand<T = unknown>(command: string, ...args: any[]): Thenable<T | undefined>;

    // 工作区
    workspaceFolders: readonly vscode.WorkspaceFolder[] | undefined;
    asRelativePath(pathOrUri: string | vscode.Uri, includeWorkspaceFolder?: boolean): string;
    getWorkspaceFolder(uri: vscode.Uri): vscode.WorkspaceFolder | undefined;
    findFiles(include: vscode.GlobPattern, exclude?: vscode.GlobPattern | null, maxResults?: number): Thenable<vscode.Uri[]>;

    // 环境
    clipboard: vscode.Clipboard;
    openExternal(target: vscode.Uri): Thenable<boolean>;
    language: string;
    appName: string;
    version: string;
    windowFocused(): boolean;

    // 命名空间（保持调用形态接近原生）
    uri: typeof vscode.Uri;
    fs: typeof vscode.workspace.fs;
    extensions: typeof vscode.extensions;
    languages: typeof vscode.languages;
    configurationTarget: typeof vscode.ConfigurationTarget;
}

export class VSCodeService implements IVSCodeService {
    public showInformationMessage(message: string, ...items: any[]): Thenable<string | undefined> {
        return (vscode.window.showInformationMessage as (...a: any[]) => Thenable<string | undefined>)(message, ...items);
    }

    public showWarningMessage(message: string, ...items: any[]): Thenable<string | undefined> {
        return (vscode.window.showWarningMessage as (...a: any[]) => Thenable<string | undefined>)(message, ...items);
    }

    public showErrorMessage(message: string, ...items: any[]): Thenable<string | undefined> {
        return (vscode.window.showErrorMessage as (...a: any[]) => Thenable<string | undefined>)(message, ...items);
    }

    public showInputBox(options?: vscode.InputBoxOptions): Thenable<string | undefined> {
        return vscode.window.showInputBox(options);
    }

    public showQuickPick<T = string>(items: readonly any[], options?: vscode.QuickPickOptions): Thenable<T | undefined> {
        return vscode.window.showQuickPick(items as any[], options) as Thenable<T | undefined>;
    }

    public showSaveDialog(options?: vscode.SaveDialogOptions): Thenable<vscode.Uri | undefined> {
        return vscode.window.showSaveDialog(options);
    }

    public showOpenDialog(options?: vscode.OpenDialogOptions): Thenable<vscode.Uri[] | undefined> {
        return vscode.window.showOpenDialog(options);
    }

    public showTextDocument(document: vscode.TextDocument, options?: vscode.TextDocumentShowOptions): Thenable<vscode.TextEditor> {
        return vscode.window.showTextDocument(document, options);
    }

    public openTextDocument(options: any): Thenable<vscode.TextDocument> {
        return (vscode.workspace.openTextDocument as (o: any) => Thenable<vscode.TextDocument>)(options);
    }

    public get activeTextEditor(): vscode.TextEditor | undefined {
        return vscode.window.activeTextEditor;
    }

    public applyEdit(edit: vscode.WorkspaceEdit): Thenable<boolean> {
        return vscode.workspace.applyEdit(edit);
    }

    public getConfiguration(section?: string): vscode.WorkspaceConfiguration {
        return vscode.workspace.getConfiguration(section);
    }

    public registerCommand(command: string, callback: (...args: any[]) => any): vscode.Disposable {
        return vscode.commands.registerCommand(command, callback);
    }

    public executeCommand<T = unknown>(command: string, ...args: any[]): Thenable<T | undefined> {
        return vscode.commands.executeCommand<T>(command, ...args);
    }

    public get workspaceFolders(): readonly vscode.WorkspaceFolder[] | undefined {
        return vscode.workspace.workspaceFolders;
    }

    public asRelativePath(pathOrUri: string | vscode.Uri, includeWorkspaceFolder?: boolean): string {
        return vscode.workspace.asRelativePath(pathOrUri, includeWorkspaceFolder);
    }

    public getWorkspaceFolder(uri: vscode.Uri): vscode.WorkspaceFolder | undefined {
        return vscode.workspace.getWorkspaceFolder(uri);
    }

    public findFiles(include: vscode.GlobPattern, exclude?: vscode.GlobPattern | null, maxResults?: number): Thenable<vscode.Uri[]> {
        return vscode.workspace.findFiles(include, exclude, maxResults);
    }

    public get clipboard(): vscode.Clipboard {
        return vscode.env.clipboard;
    }

    public openExternal(target: vscode.Uri): Thenable<boolean> {
        return vscode.env.openExternal(target);
    }

    public get language(): string {
        return vscode.env.language;
    }

    public get appName(): string {
        return vscode.env.appName;
    }

    public get version(): string {
        return vscode.version;
    }

    public windowFocused(): boolean {
        return vscode.window.state.focused;
    }

    public get uri(): typeof vscode.Uri {
        return vscode.Uri;
    }

    public get fs(): typeof vscode.workspace.fs {
        return vscode.workspace.fs;
    }

    public get extensions(): typeof vscode.extensions {
        return vscode.extensions;
    }

    public get languages(): typeof vscode.languages {
        return vscode.languages;
    }

    public get configurationTarget(): typeof vscode.ConfigurationTarget {
        return vscode.ConfigurationTarget;
    }
}
