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

export const env = { language: 'en' };
export const version = '1.90.0';

export const window = {
    createOutputChannel: (_name: string) => ({ appendLine: (_s: string) => {}, dispose: () => {} }),
    showInformationMessage: (_msg: string) => Promise.resolve(undefined),
    showWarningMessage: (_msg: string) => Promise.resolve(undefined),
    showErrorMessage: (_msg: string) => Promise.resolve(undefined),
};

export const workspace = {
    getConfiguration: () => ({ get: (_k: string, d: unknown) => d }),
};

export const Uri = {
    file: (p: string) => ({ fsPath: p }),
};

export const ConfigurationTarget = { Workspace: 2, Global: 1 };
