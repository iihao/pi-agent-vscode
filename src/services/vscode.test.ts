import { describe, it, expect, beforeEach } from 'vitest';
import { VSCodeService } from './vscode';

describe('VSCodeService', () => {
    let service: VSCodeService;

    beforeEach(() => {
        service = new VSCodeService();
    });

    it('forwards showInformationMessage and its action items', async () => {
        await expect(service.showInformationMessage('hi', 'Open')).resolves.toBe('Open');
    });

    it('forwards showWarningMessage / showErrorMessage', async () => {
        await expect(service.showWarningMessage('w')).resolves.toBeUndefined();
        await expect(service.showErrorMessage('e', 'Retry')).resolves.toBe('Retry');
    });

    it('forwards showInputBox', async () => {
        await expect(service.showInputBox({ prompt: 'p' })).resolves.toBe('typed');
    });

    it('forwards showQuickPick', async () => {
        await expect(service.showQuickPick(['a', 'b'])).resolves.toBe('a');
    });

    it('reads configuration through the workspace', () => {
        expect(service.getConfiguration('pi-agent').get('x', 42)).toBe(42);
    });

    it('exposes workspaceFolders and resolves relative paths', () => {
        expect(service.workspaceFolders).toEqual([]);
        expect(service.asRelativePath('/a/b')).toBe('/a/b');
    });

    it('forwards findFiles and applyEdit', async () => {
        await expect(service.findFiles('**/*')).resolves.toEqual([]);
        await expect(service.applyEdit({} as never)).resolves.toBe(true);
    });

    it('exposes clipboard, language, appName and version', async () => {
        await expect(service.clipboard.writeText('x')).resolves.toBeUndefined();
        expect(service.language).toBe('en');
        expect(service.appName).toBe('VS Code');
        expect(service.version).toBe('1.90.0');
    });

    it('reports window focus', () => {
        expect(service.windowFocused()).toBe(true);
    });

    it('builds file URIs through the uri namespace', () => {
        expect(service.uri.file('/x').fsPath).toBe('/x');
        expect(service.uri.joinPath(service.uri.file('/a'), 'b').fsPath).toBe('/a/b');
    });

    it('exposes ConfigurationTarget', () => {
        expect(service.configurationTarget.Workspace).toBe(2);
        expect(service.configurationTarget.Global).toBe(1);
    });
});
