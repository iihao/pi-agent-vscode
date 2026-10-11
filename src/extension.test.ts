import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getSelectionContext } from './extension';
import * as vscodeMock from '../test/vscode.mock';

function fakeEditor(selection: { isEmpty: boolean; startLine: number; endLine: number }) {
    return {
        selection: { isEmpty: selection.isEmpty, start: { line: selection.startLine }, end: { line: selection.endLine } },
        document: { getText: () => 'selected code', languageId: 'typescript', uri: { fsPath: '/x/a.ts' } },
    };
}

describe('getSelectionContext', () => {
    beforeEach(() => {
        (vscodeMock.window as { activeTextEditor?: unknown }).activeTextEditor = undefined;
    });
    afterEach(() => {
        vi.restoreAllMocks();
        (vscodeMock.window as { activeTextEditor?: unknown }).activeTextEditor = undefined;
    });

    it('returns undefined and warns when there is no editor', () => {
        const warn = vi.spyOn(vscodeMock.window, 'showWarningMessage');
        expect(getSelectionContext()).toBeUndefined();
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it('returns undefined when the selection is empty', () => {
        (vscodeMock.window as { activeTextEditor?: unknown }).activeTextEditor =
            fakeEditor({ isEmpty: true, startLine: 0, endLine: 0 });
        expect(getSelectionContext()).toBeUndefined();
    });

    it('returns the selection context with a 1-based line range', () => {
        (vscodeMock.window as { activeTextEditor?: unknown }).activeTextEditor =
            fakeEditor({ isEmpty: false, startLine: 2, endLine: 4 });
        expect(getSelectionContext()).toEqual({
            relPath: '/x/a.ts',
            languageId: 'typescript',
            code: 'selected code',
            lineRange: '3-5',
        });
    });

    it('uses a single line number when start and end match', () => {
        (vscodeMock.window as { activeTextEditor?: unknown }).activeTextEditor =
            fakeEditor({ isEmpty: false, startLine: 6, endLine: 6 });
        expect(getSelectionContext()?.lineRange).toBe('7');
    });
});
