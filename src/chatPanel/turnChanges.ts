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
    if (!change.edits) { return change.before !== undefined; }  // 覆盖写 -> 有快照才能还原
    return change.edits.every((e) => e.newText.length > 0);
}

/**
 * 行级 diff（LCS），用于「快照 → 当前内容」的对比（主要是 write）。
 * 上下文行以空格开头，删除行 `-`，新增行 `+`，与 webview 的渲染约定一致。
 * 大文件退化为整体替换，并限制总行数。
 */
export function lineDiff(before: string, after: string, maxLines = 120): string {
    // 空字符串视为「没有行」（新文件 / 清空），而不是「一个空行」
    const a = before === '' ? [] : before.split('\n');
    const b = after === '' ? [] : after.split('\n');
    const MAX = 900;
    if (a.length > MAX || b.length > MAX) {
        return clip(a.map((l) => '-' + l).concat(b.map((l) => '+' + l)), maxLines);
    }
    const n = a.length;
    const m = b.length;
    // dp[i][j] = a[i:] 与 b[j:] 的 LCS 长度
    const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
    }
    const out: string[] = [];
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
        if (a[i] === b[j]) { out.push(' ' + a[i]); i++; j++; }
        else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push('-' + a[i]); i++; }
        else { out.push('+' + b[j]); j++; }
    }
    while (i < n) { out.push('-' + a[i++]); }
    while (j < m) { out.push('+' + b[j++]); }
    return clip(out, maxLines);
}

function clip(lines: string[], maxLines: number): string {
    if (lines.length > maxLines) {
        return lines.slice(0, maxLines).join('\n') + '\n… (' + (lines.length - maxLines) + ' more lines)';
    }
    return lines.join('\n');
}

/** 把记录的 edit 对渲染成一段简易 unified diff（预览用，非严格算法） */
export function editsToDiff(edits: Array<{ oldText: string; newText: string }>, maxLines = 60): string {
    const lines: string[] = [];
    for (const e of edits) {
        for (const l of e.oldText.split('\n')) { lines.push('-' + l); }
        for (const l of e.newText.split('\n')) { lines.push('+' + l); }
    }
    if (lines.length > maxLines) {
        return lines.slice(0, maxLines).join('\n') + '\n… (' + (lines.length - maxLines) + ' more lines)';
    }
    return lines.join('\n');
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
