// ---------------------------------------------------------------------------
// Queue / steer badges
//
// Two things the badge matching got wrong or could drift on:
//  - a pending message with no text (images only) matched "any leftover queued
//    entry", so it stayed badged as long as anything at all was queued;
//  - the webview carried its own copy of the context-block marker strings, so
//    the host and the webview could quietly disagree about what to strip.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import { pendingStillQueued } from '../webview/modules/queue';

describe('pending message badges', () => {
    it('matches queued messages by text, consuming each entry once', () => {
        expect(pendingStillQueued(['a', 'a'], ['a', 'a'])).toEqual([true, true]);
        expect(pendingStillQueued(['a', 'a'], ['a'])).toEqual([true, false]);
        expect(pendingStillQueued(['b'], ['a'])).toEqual([false]);
        expect(pendingStillQueued([], ['a'])).toEqual([]);
    });

    it('gives an images-only message the next unconsumed entry, not any leftover', () => {
        // One pending is a pasted image, the other has text. pi only still holds the
        // text one, so the image's badge must clear instead of latching onto it.
        expect(pendingStillQueued(['', 'later'], ['later'])).toEqual([false, true]);
        // …and it takes the next slot when the queue really does still hold it
        expect(pendingStillQueued(['', 'later'], ['later', 'x'])).toEqual([true, true]);
    });

    it('keeps a single images-only message while its entry is still queued', () => {
        expect(pendingStillQueued([''], [''])).toEqual([true]);
        expect(pendingStillQueued([''], [])).toEqual([false]);
    });
});

describe('context block markers', () => {
    it('are defined in one place only (the host module the webview imports)', () => {
        const offenders: string[] = [];
        for (const dir of ['../webview', '../webview/modules']) {
            const base = fileURLToPath(new URL(dir, import.meta.url));
            for (const name of readdirSync(base)) {
                if (!name.endsWith('.ts')) { continue; }
                const source = readFileSync(path.join(base, name), 'utf8');
                if (source.includes('pi-extension-context')) { offenders.push(name); }
            }
        }
        expect(offenders).toEqual([]);
    });
});
