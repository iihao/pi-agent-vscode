// Minimal `vscode` API mock for unit tests (aliased in vitest.config.ts).

function interpolate(message: string, args: unknown[]): string {
    return String(message).replace(/\{(\d+)\}/g, (_, i) => {
        const v = args[Number(i)];
        return v !== undefined ? String(v) : `{${i}}`;
    });
}

export const l10n = {
    t: (message: string, ...args: unknown[]): string => interpolate(message, args),
};

export const env = {
    language: 'en',
    appName: 'VS Code',
    clipboard: { writeText: (_text: string) => Promise.resolve() },
};
export const version = '1.90.0';

export const window = {
    createOutputChannel: (_name: string) => ({ appendLine: (_s: string) => {}, dispose: () => {} }),
    showInformationMessage: (_msg: string) => Promise.resolve(undefined),
    showWarningMessage: (_msg: string) => Promise.resolve(undefined),
    showErrorMessage: (_msg: string) => Promise.resolve(undefined),
    activeTextEditor: undefined,
};

export const workspace = {
    getConfiguration: () => ({ get: (_k: string, d: unknown) => d }),
    workspaceFolders: [],
    asRelativePath: (p: string) => p,
};

export const commands = {
    registerCommand: (_command: string, _callback: (...args: any[]) => any) => ({ dispose: () => {} }),
};

export const Uri = {
    file: (p: string) => ({ fsPath: p }),
};

export const ConfigurationTarget = { Workspace: 2, Global: 1 };
