// ---------------------------------------------------------------------------
// 上下文引用：附加的文件/选区以「引用」而非「复制内容」的方式拼进 prompt。
// 只给 pi 路径（必要时带行号），让它用自己的工具读取当前磁盘内容。
// ---------------------------------------------------------------------------

export interface ContextRef {
    type: 'file' | 'selection';
    path: string;
    lineRange?: string;
}

/** 已附加的上下文条目（引用 + 稳定 id） */
export interface ContextItem extends ContextRef {
    id: string;
}

const BLOCK_START = '--- pi-extension-context:start ---';
const BLOCK_END = '--- pi-extension-context:end ---';

/** 单个引用：选区带行号，文件只给路径 */
export function contextRef(c: ContextRef): string {
    return c.type === 'selection' && c.lineRange ? `@${c.path}:${c.lineRange}` : `@${c.path}`;
}

/**
 * 把上下文引用拼到消息前面，形成 pi 可读的 context 块。
 * 无引用时原样返回。
 */
export function buildContextBlock(contexts: ContextRef[], text: string): string {
    if (contexts.length === 0) { return text; }
    const refs = contexts.map(contextRef);
    return [
        BLOCK_START,
        '<file-context>',
        ...refs,
        '</file-context>',
        BLOCK_END,
    ].join('\n') + '\n\n' + text;
}

/** 从消息文本中剥离 context 块（用于展示历史消息，避免暴露内部格式） */
export function stripContextBlock(text: string): string {
    const start = text.indexOf(BLOCK_START);
    if (start === -1) { return text; }
    const end = text.indexOf(BLOCK_END, start);
    if (end === -1) { return text; }
    return text.slice(end + BLOCK_END.length).replace(/^\s+/, '');
}
