// ---------------------------------------------------------------------------
// Per-turn change tracking and revert
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
    if (!change.existed) { return true; }          // created this turn -> delete
    if (!change.edits) { return change.before !== undefined; }  // overwritten (write) -> revertible only with a snapshot
    return change.edits.every((e) => e.newText.length > 0);
}

/**
 * Line-level diff (LCS) comparing "snapshot -> current content" (mainly for write).
 * Context lines start with a space, removals with `-` and additions with `+`,
 * matching how the webview renders diffs. Huge files fall back to a whole-file
 * replace, and the total line count is capped.
 */
export function lineDiff(before: string, after: string, maxLines = 120): string {
    // Treat an empty string as "no lines" (new / cleared file), not "one empty line"
    const a = before === '' ? [] : before.split('\n');
    const b = after === '' ? [] : after.split('\n');
    const MAX = 900;
    if (a.length > MAX || b.length > MAX) {
        return clip(a.map((l) => '-' + l).concat(b.map((l) => '+' + l)), maxLines);
    }
    const n = a.length;
    const m = b.length;
    // dp[i][j] = LCS length of a[i:] and b[j:]
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

/** Render recorded edit pairs as a simple unified diff (preview only; not a strict algorithm) */
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

/** Why a revert could not be performed */
export type RevertFailure = 'missing' | 'ambiguous';

export type RevertResult = { ok: true; content: string } | { ok: false; reason: RevertFailure };

/**
 * Exploration budget for the ambiguity search: an edit whose newText also
 * occurs elsewhere in the file (unrelated identical text, or the result of an
 * earlier edit) has several candidate positions, and combinations grow
 * multiplicatively. The counter keeps a pathological file bounded instead of
 * turning Revert into a search problem — past the budget the result is
 * "ambiguous" (refuse) rather than a guess.
 */
const REVERT_SEARCH_BUDGET = 256;

/** All start positions of needle in haystack (non-overlapping) */
function occurrences(haystack: string, needle: string): number[] {
    const out: number[] = [];
    if (!needle) { return out; }
    let from = 0;
    for (;;) {
        const idx = haystack.indexOf(needle, from);
        if (idx < 0) { return out; }
        out.push(idx);
        from = idx + needle.length;
    }
}

/**
 * Reverse the edits, exploring every position where a newText matches, and
 * accept the result only when exactly ONE consistent original exists.
 *
 * A single `indexOf(newText)` cannot know which occurrence is the one the edit
 * produced: if the replaced text already appeared earlier in the file, the
 * first-occurrence guess rewrites the wrong place — silent corruption of a file
 * the user trusted Revert with. When several originals are content-consistent
 * there is genuinely not enough information to choose; that is reported as
 * `ambiguous` so the user is told to do it by hand instead of guessing.
 */
export function revertEditsDetailed(content: string, edits: Array<{ oldText: string; newText: string }>): RevertResult {
    if (!edits.length) { return { ok: true, content }; }
    const finals = new Set<string>();
    let budget = REVERT_SEARCH_BUDGET;
    let exhausted = false;
    const walk = (current: string, i: number): void => {
        if (i < 0) { finals.add(current); return; }
        if (budget <= 0) { exhausted = true; return; }
        const { oldText, newText } = edits[i];
        // Nothing to undo (isRevertible keeps empty newText out of this path)
        if (!newText) { return; }
        const hits = occurrences(current, newText);
        // No occurrence left: this branch cannot be the original
        if (!hits.length) { return; }
        for (const idx of hits) {
            if (budget <= 0) { exhausted = true; return; }
            budget--;
            walk(current.slice(0, idx) + oldText + current.slice(idx + newText.length), i - 1);
        }
    };
    walk(content, edits.length - 1);
    if (exhausted) { return { ok: false, reason: 'ambiguous' }; }
    if (finals.size === 1) { return { ok: true, content: [...finals][0] }; }
    return { ok: false, reason: finals.size === 0 ? 'missing' : 'ambiguous' };
}

/** Replace newText back with oldText in reverse order; null when it no longer matches OR is ambiguous */
export function revertEdits(content: string, edits: Array<{ oldText: string; newText: string }>): string | null {
    const result = revertEditsDetailed(content, edits);
    return result.ok ? result.content : null;
}
