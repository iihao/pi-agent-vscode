// ---------------------------------------------------------------------------
// Webview 全局类型声明
// ---------------------------------------------------------------------------

declare function acquireVsCodeApi(): {
    postMessage(message: unknown): void;
    getState(): unknown;
    setState(state: unknown): void;
};

// markdown-it 类型（简化声明，覆盖 webview 中的使用方式）
declare module 'markdown-it' {
    /** markdown-it Token 类型 */
    export interface Token {
        info?: string;
        content?: string;
        children?: Token[];
        attrSet(name: string, value: string): void;
        attrGet(name: string): string | null;
    }
    class MarkdownIt {
        constructor(options?: unknown);
        use(plugin: unknown, ...args: unknown[]): MarkdownIt;
        render(src: string): string;
        renderer: {
            rules: Record<string, ((tokens: Token[], idx: number, options: unknown, env: unknown, self: MarkdownIt) => string) | undefined>;
            renderToken(tokens: Token[], idx: number, options: unknown): string;
            renderInlineAsText(tokens: Token[]): string;
        };
        renderToken(tokens: Token[], idx: number, options: unknown): string;
        renderInlineAsText(tokens: Token[]): string;
    }
    export default MarkdownIt;
}

declare module '@vscode/markdown-it-katex' {
    const plugin: unknown;
    export default plugin;
}
