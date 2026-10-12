// ---------------------------------------------------------------------------
// 本回合改动追踪与还原
// ---------------------------------------------------------------------------

import { TurnChange } from '../state/types';

export function parseEdits(args: { edits?: unknown } | undefined): Array<{ oldText: string; newText: string }> {
    const raw = args?.edits;
    if (!Array.isArray(raw)) { return []; }
    const out: Array<{ oldText: string; newText: string }> = [];
    for (const e of raw) {
        if (e && typeof e === 'object') {
            const o = e as { oldText?: unknown; newText?: unknown };
            if (typeof o.oldText === 'string' && typeof o.newText === 'string') {
                out.push({ oldText: o.oldText, newText: o.newText });
            }
        }
    }
    return out;
}

export function isRevertible(change: TurnChange): boolean {
    if (!change.existed) { return true; }          // 本回合新建 -> 删除
    if (!change.edits) { return false; }           // 覆盖写 -> 无法安全还原
    return change.edits.every((e) => e.newText.length > 0);
}

/** 把 newText 反向替换回 oldText（倒序），失败返回 null */
export function revertEdits(content: string, edits: Array<{ oldText: string; newText: string }>): string | null {
    let out = content;
    for (let i = edits.length - 1; i >= 0; i--) {
        const { oldText, newText } = edits[i];
        const idx = out.indexOf(newText);
        if (idx === -1) { return null; }
        out = out.slice(0, idx) + oldText + out.slice(idx + newText.length);
    }
    return out;
}
