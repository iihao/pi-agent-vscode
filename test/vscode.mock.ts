// Minimal `vscode` API mock for unit tests (aliased in vitest.config.ts).
// Only the surface the extension + services touch is implemented.

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
    openExternal: (_uri: unknown) => Promise.resolve(true),
};

export const version = '1.90.0';

export const window = {
    createOutputChannel: (_name: string) => ({ appendLine: (_s: string) => {}, dispose: () => {} }),
    showInformationMessage: (_msg: string, ...items: unknown[]) => Promise.resolve(items[items.length - 1]),
    showWarningMessage: (_msg: string, ...items: unknown[]) => Promise.resolve(items[items.length - 1]),
    showErrorMessage: (_msg: string, ...items: unknown[]) => Promise.resolve(items[items.length - 1]),
    showInputBox: (_opts?: unknown) => Promise.resolve('typed'),
    showQuickPick: (items: unknown[]) => Promise.resolve(items[0]),
    showSaveDialog: (_opts?: unknown) => Promise.resolve(undefined),
    showOpenDialog: (_opts?: unknown) => Promise.resolve([] as unknown[]),
    showTextDocument: (doc: unknown) => Promise.resolve({ document: doc }),
    activeTextEditor: undefined,
    state: { focused: true },
};

export const workspace = {
    getConfiguration: (_section?: string) => ({ get: (_k: string, d: unknown) => d }),
    workspaceFolders: [] as unknown[],
    asRelativePath: (p: unknown) => (typeof p === 'string' ? p : (p as { fsPath?: string }).fsPath ?? ''),
    getWorkspaceFolder: (_uri: unknown) => undefined,
    findFiles: (_include: unknown, _exclude?: unknown, _max?: unknown) => Promise.resolve([]),
    applyEdit: (_edit: unknown) => Promise.resolve(true),
    openTextDocument: (arg: unknown) => {
        const a = arg as { fsPath?: string; content?: string };
        return Promise.resolve(a && typeof a.content === 'string'
            ? { getText: () => a.content, uri: undefined }
            : { uri: arg, getText: () => '' });
    },
    fs: {
        readFile: (_uri: unknown) => Promise.resolve(new Uint8Array()),
        writeFile: (_uri: unknown, _content: unknown) => Promise.resolve(),
        delete: (_uri: unknown, _opts?: unknown) => Promise.resolve(),
    },
};

export const commands = {
    registerCommand: (_command: string, _callback: (...args: any[]) => any) => ({ dispose: () => {} }),
    executeCommand: (_command: string, ..._args: unknown[]) => Promise.resolve(undefined),
};

export const Uri = {
    file: (p: string) => ({ fsPath: p, scheme: 'file', path: p }),
    joinPath: (base: { fsPath: string }, ...segments: string[]) => ({
        fsPath: [base.fsPath, ...segments].join('/'),
        scheme: 'file',
    }),
    parse: (value: string) => ({ toString: () => value, fsPath: value }),
};

export const extensions = {
    getExtension: (_id: string) => undefined,
};

export const languages = {
    getDiagnostics: (_uri?: unknown) => [] as unknown[],
};

export const ConfigurationTarget = { Workspace: 2, Global: 1 };
