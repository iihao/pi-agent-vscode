// ---------------------------------------------------------------------------
// Session manager
// ---------------------------------------------------------------------------

import * as path from 'path';
import * as fs from 'fs';
import { PiRawMessage, PiRpcClient, extractMessageText } from './piTypes';
import { stripContextBlock } from '../utils/context';
import { logError } from '../utils/logger';

export interface SessionInfo {
    id: string;
    file: string;
    createdAt: number;
    messageCount: number;
    name?: string;
    /** Default display name when unnamed: the first user question (truncated) */
    preview?: string;
}

/** Read cap when reading session metadata, so large files are never loaded whole */
const HEAD_BYTES = 256 * 1024;
const PREVIEW_MAX_CHARS = 60;
/** Max sessions listed (most recent by mtime; metadata is cached by mtime) */
const SESSION_LIST_LIMIT = 60;

/** Pull the first user question out of the session file's head lines (strip the context block, collapse whitespace, truncate) */
function firstUserPreview(lines: string[]): string | undefined {
    for (const line of lines) {
        const t = line.trim();
        if (!t || t.indexOf('"message"') === -1) { continue; }
        let entry: { type?: string; message?: PiRawMessage };
        try { entry = JSON.parse(t); } catch { continue; }
        if (entry.type !== 'message' || !entry.message || entry.message.role !== 'user') { continue; }
        const text = extractMessageText(entry.message);
        if (!text) { continue; }
        const clean = stripContextBlock(text).replace(/\s+/g, ' ').trim();
        if (clean) {
            return clean.length > PREVIEW_MAX_CHARS ? clean.slice(0, PREVIEW_MAX_CHARS) + '…' : clean;
        }
    }
    return undefined;
}
const TAIL_CHUNK_BYTES = 256 * 1024;
const MAX_TAIL_SCAN_BYTES = 8 * 1024 * 1024;

export class SessionManager {
    private _sessions: SessionInfo[] = [];
    private _currentSessionId: string | undefined;
    private _fileCache = new Map<string, { mtimeMs: number; id: string; name?: string; preview?: string }>();

    public get sessions(): SessionInfo[] {
        return this._sessions;
    }

    public get currentSessionId(): string | undefined {
        return this._currentSessionId;
    }

    public async loadSessions(client: PiRpcClient): Promise<void> {
        try {
            const state = await client.getState();
            const sessionId = state.sessionId || 'default';
            const sessionFile = state.sessionFile || '';
            this._currentSessionId = sessionId;

            const sessions: SessionInfo[] = [];
            if (sessionFile) {
                try {
                    const sessionDir = path.dirname(sessionFile);
                    if (fs.existsSync(sessionDir)) {
                        // Sort by mtime and truncate first, then read: avoids head/tail scanning every session file in the directory
                        const candidates: Array<{ full: string; mtimeMs: number }> = [];
                        for (const f of fs.readdirSync(sessionDir)) {
                            if (!f.endsWith('.jsonl')) { continue; }
                            const full = path.join(sessionDir, f);
                            try {
                                candidates.push({ full, mtimeMs: fs.statSync(full).mtimeMs });
                            } catch (err) {
                                logError(`loadSessions: stat failed for ${full}: ${(err as Error).message}`);
                            }
                        }
                        const files = candidates
                            .sort((a, b) => b.mtimeMs - a.mtimeMs)
                            .slice(0, SESSION_LIST_LIMIT)
                            .map(({ full, mtimeMs }) => {
                                const meta = this._readMeta(full, mtimeMs);
                                return {
                                    id: meta.id,
                                    name: meta.name,
                                    preview: meta.preview,
                                    file: full,
                                    createdAt: mtimeMs,
                                    messageCount: 0,
                                };
                            });
                        sessions.push(...files);
                    }
                } catch (err) {
                    logError(`loadSessions: scanning session dir failed: ${(err as Error).message}`);
                }
            }

            if (!sessions.find((s) => s.id === sessionId)) {
                sessions.unshift({
                    id: sessionId,
                    name: state.sessionName,
                    file: sessionFile,
                    createdAt: Date.now(),
                    messageCount: 0,
                });
            }

            this._sessions = sessions;
            if (sessionFile) { this._pruneFileCache(path.dirname(sessionFile)); }
        } catch (err) {
            logError(`loadSessions failed: ${(err as Error).message}`);
        }
    }

    /** Drop cache entries outside the current session directory so the cache cannot grow unbounded */
    private _pruneFileCache(dir: string): void {
        for (const key of this._fileCache.keys()) {
            if (path.dirname(key) !== dir) { this._fileCache.delete(key); }
        }
    }

    public async createNewSession(client: PiRpcClient): Promise<boolean> {
        try {
            const result = await client.newSession();
            if (!result.cancelled) {
                await this.loadSessions(client);
                return true;
            }
        } catch (err) {
            logError(`createNewSession failed: ${(err as Error).message}`);
        }
        return false;
    }

    public async switchSession(client: PiRpcClient, sessionId: string): Promise<boolean> {
        const session = this._sessions.find((s) => s.id === sessionId);
        if (!session || !session.file) { return false; }
        try {
            // Resuming a session must use switchSession(sessionPath); newSession() creates a new one and cannot switch.
            const result = await client.switchSession(session.file);
            if (!result.cancelled) {
                await this.loadSessions(client);
                return true;
            }
        } catch (err) {
            logError(`switchSession failed: ${(err as Error).message}`);
        }
        return false;
    }

    /** Rename a session. The SDK only acts on the current session, so switch to it first and switch back after, keeping state in sync. */
    public async renameSession(client: PiRpcClient, sessionId: string, name: string): Promise<boolean> {
        const originalId = this._currentSessionId;
        const isCurrent = sessionId === originalId;
        if (!isCurrent) {
            const ok = await this.switchSession(client, sessionId);
            if (!ok) { return false; }
        }
        try {
            await client.setSessionName(name);
            await this.loadSessions(client);
            if (!isCurrent && originalId) {
                const back = await this.switchSession(client, originalId);
                if (!back) {
                    logError(`renameSession: failed to switch back to ${originalId}`);
                }
            }
            return true;
        } catch (err) {
            logError(`renameSession failed: ${(err as Error).message}`);
            return false;
        }
    }

    /** Read session metadata: the real id (header on the first line) and the name
     *  (the last session_info). Only the head and tail are read, so a large file
     *  is never loaded whole and the extension host is not blocked. */
    private _readMeta(file: string, mtimeMs: number): { id: string; name?: string; preview?: string } {
        const cached = this._fileCache.get(file);
        if (cached && cached.mtimeMs === mtimeMs) {
            return { id: cached.id, name: cached.name, preview: cached.preview };
        }
        let id = path.basename(file, '.jsonl');
        let name: string | undefined;
        let preview: string | undefined;
        try {
            const stat = fs.statSync(file);
            if (stat.size > 0) {
                const head = this._readRange(file, 0, Math.min(HEAD_BYTES, stat.size));
                const lines = head.split('\n');
                const first = lines.find((l) => l.trim());
                if (first) {
                    try {
                        const o = JSON.parse(first);
                        if (o.type === 'session' && typeof o.id === 'string') { id = o.id; }
                    } catch (err) {
                        logError(`_readMeta: bad header in ${file}: ${(err as Error).message}`);
                    }
                }
                preview = firstUserPreview(lines);
                name = this._readLastName(file, stat.size);
            }
        } catch (err) {
            logError(`_readMeta failed for ${file}: ${(err as Error).message}`);
        }
        this._fileCache.set(file, { mtimeMs, id, name, preview });
        return { id, name, preview };
    }

    /** Read the text in [start, start+len) */
    private _readRange(file: string, start: number, len: number): string {
        if (len <= 0) { return ''; }
        const fd = fs.openSync(file, 'r');
        try {
            const buf = Buffer.allocUnsafe(len);
            const read = fs.readSync(fd, buf, 0, len, start);
            return buf.subarray(0, read).toString('utf8');
        } finally {
            fs.closeSync(fd);
        }
    }

    /** Scan backwards from the end of the file in chunks and return the name of the
     *  last session_info. Each byte is read at most once and the total stays under
     *  MAX_TAIL_SCAN_BYTES. */
    private _readLastName(file: string, size: number): string | undefined {
        const fd = fs.openSync(file, 'r');
        try {
            let pos = size;
            let scanned = 0;
            let pending = ''; // the incomplete line at the start of the already-scanned chunk
            while (pos > 0 && scanned < MAX_TAIL_SCAN_BYTES) {
                const len = Math.min(TAIL_CHUNK_BYTES, pos, MAX_TAIL_SCAN_BYTES - scanned);
                pos -= len;
                scanned += len;
                const buf = Buffer.allocUnsafe(len);
                fs.readSync(fd, buf, 0, len, pos);
                const lines = (buf.toString('utf8') + pending).split('\n');
                pending = pos > 0 ? lines[0] : '';
                // when pos>0, lines[0] may be truncated, so skip it; the file-head chunk is complete
                for (let i = lines.length - 1; i >= (pos > 0 ? 1 : 0); i--) {
                    if (lines[i].indexOf('session_info') === -1) { continue; }
                    try {
                        const o = JSON.parse(lines[i]);
                        if (o.type === 'session_info') {
                            return (typeof o.name === 'string' ? o.name.trim() : '') || undefined;
                        }
                    } catch {
                        // may be truncated across a chunk boundary; ignore this line
                    }
                }
            }
        } finally {
            fs.closeSync(fd);
        }
        return undefined;
    }
}
