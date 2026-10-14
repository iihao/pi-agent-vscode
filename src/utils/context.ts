// ---------------------------------------------------------------------------
// Context references: attached files / selections are woven into the prompt as
// references, not copied content. Only the path (plus a line range when needed)
// is given, so pi reads the current on-disk content with its own tools.
// ---------------------------------------------------------------------------

export interface ContextRef {
    type: 'file' | 'selection';
    path: string;
    lineRange?: string;
}

/** An attached context entry (reference + stable id) */
export interface ContextItem extends ContextRef {
    id: string;
    /** Auto-attached from the active editor (user can remove it), unlike a manual attachment */
    auto?: boolean;
}

/** Reserved id for the auto-attached entry (at most one at a time) */
export const AUTO_CONTEXT_ID = 'auto';

const BLOCK_START = '--- pi-extension-context:start ---';
const BLOCK_END = '--- pi-extension-context:end ---';

/** A single reference: a selection carries a line range, a file just its path */
export function contextRef(c: ContextRef): string {
    return c.type === 'selection' && c.lineRange ? `@${c.path}:${c.lineRange}` : `@${c.path}`;
}

/**
 * Prefix the message with the context references as a pi-readable context block.
 * Returns the text unchanged when there are no references.
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

/** Strip the context block from a message (for history display, to hide the internal format) */
export function stripContextBlock(text: string): string {
    const start = text.indexOf(BLOCK_START);
    if (start === -1) { return text; }
    const end = text.indexOf(BLOCK_END, start);
    if (end === -1) { return text; }
    return text.slice(end + BLOCK_END.length).replace(/^\s+/, '');
}

/**
 * Parse the references out of a context block (used to echo attachments on
 * history messages). Recognizes `@`-prefixed lines inside `<file-context>`;
 * a trailing `:line[-line]` is treated as a selection.
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
