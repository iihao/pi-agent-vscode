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
    /** 由当前活动编辑器自动附加（可被用户叉掉），区别于用户手动附加 */
    auto?: boolean;
}

/** 自动附加条目的保留 id（同一时刻至多一个） */
export const AUTO_CONTEXT_ID = 'auto';

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
export function buildContextBlock(contexts: ContextRef[], text: string, extraBlocks: string[] = []): string {
    if (contexts.length === 0 && extraBlocks.length === 0) { return text; }
    const parts: string[] = [BLOCK_START];
    if (contexts.length) {
        parts.push('<file-context>', ...contexts.map(contextRef), '</file-context>');
    }
    parts.push(...extraBlocks);
    parts.push(BLOCK_END);
    return parts.join('\n') + '\n\n' + text;
}

/** 从消息文本中剥离 context 块（用于展示历史消息，避免暴露内部格式） */
export function stripContextBlock(text: string): string {
    const start = text.indexOf(BLOCK_START);
    if (start === -1) { return text; }
    const end = text.indexOf(BLOCK_END, start);
    if (end === -1) { return text; }
    return text.slice(end + BLOCK_END.length).replace(/^\s+/, '');
}

/**
 * 从消息文本里解析 context 块中的引用（用于历史消息回显附件）。
 * 识别 `<file-context>` 内以 `@` 开头的行；尾部 `:行号[-行号]` 视为选区。
 */
export function parseContextRefs(text: string): ContextRef[] {
    const start = text.indexOf(BLOCK_START);
    if (start === -1) { return []; }
    const end = text.indexOf(BLOCK_END, start);
    if (end === -1) { return []; }
    const block = text.slice(start + BLOCK_START.length, end);
    const open = block.indexOf('<file-context>');
    const close = block.indexOf('</file-context>');
    if (open === -1 || close === -1 || close < open) { return []; }
    const body = block.slice(open + '<file-context>'.length, close);
    const refs: ContextRef[] = [];
    const seen = new Set<string>();
    for (const raw of body.split('\n')) {
        const line = raw.trim();
        if (!line.startsWith('@')) { continue; }
        const value = line.slice(1).trim();
        if (!value) { continue; }
        const m = value.match(/^(.*):(\d+(?:-\d+)?)$/);
        const ref: ContextRef = m
            ? { type: 'selection', path: m[1], lineRange: m[2] }
            : { type: 'file', path: value };
        const key = `${ref.type}:${ref.path}:${ref.lineRange || ''}`;
        if (!seen.has(key)) { seen.add(key); refs.push(ref); }
    }
    return refs;
}
