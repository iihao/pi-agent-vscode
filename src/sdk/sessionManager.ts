// ---------------------------------------------------------------------------
// 会话管理器
// ---------------------------------------------------------------------------

import * as path from 'path';
import * as fs from 'fs';
import { PiRpcClient } from './piTypes';
import { logError } from '../utils/logger';

export interface SessionInfo {
    id: string;
    file: string;
    createdAt: number;
    messageCount: number;
    name?: string;
}

/** 读取会话元数据时的读取上限，避免把大文件整体读入内存 */
const HEAD_BYTES = 64 * 1024;
const TAIL_CHUNK_BYTES = 256 * 1024;
const MAX_TAIL_SCAN_BYTES = 8 * 1024 * 1024;

export class SessionManager {
    private _sessions: SessionInfo[] = [];
    private _currentSessionId: string | undefined;
    private _fileCache = new Map<string, { mtimeMs: number; id: string; name?: string }>();

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
                        const files = fs.readdirSync(sessionDir)
                            .filter((f) => f.endsWith('.jsonl'))
                            .map((f) => {
                                const full = path.join(sessionDir, f);
                                const stat = fs.statSync(full);
                                const meta = this._readMeta(full, stat.mtimeMs);
                                return {
                                    id: meta.id,
                                    name: meta.name,
                                    file: full,
                                    createdAt: stat.mtimeMs,
                                    messageCount: 0,
                                };
                            })
                            .sort((a, b) => b.createdAt - a.createdAt)
                            .slice(0, 20);
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
        } catch (err) {
            logError(`loadSessions failed: ${(err as Error).message}`);
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
            // 恢复历史会话必须用 switchSession(sessionPath)；newSession() 是新建，不能用于切换。
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

    /** 重命名会话。SDK 只作用于当前会话，必要时先切过去、改完再切回，避免状态脱节。 */
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

    /** 读取会话文件元数据：真实 id（首行 header）与名称（最后一个 session_info）。
     *  只读取文件头部与尾部，避免把大文件整体读入内存、阻塞扩展宿主。 */
    private _readMeta(file: string, mtimeMs: number): { id: string; name?: string } {
        const cached = this._fileCache.get(file);
        if (cached && cached.mtimeMs === mtimeMs) {
            return { id: cached.id, name: cached.name };
        }
        let id = path.basename(file, '.jsonl');
        let name: string | undefined;
        try {
            const stat = fs.statSync(file);
            if (stat.size > 0) {
                const head = this._readRange(file, 0, Math.min(HEAD_BYTES, stat.size));
                const first = head.split('\n').find((l) => l.trim());
                if (first) {
                    try {
                        const o = JSON.parse(first);
                        if (o.type === 'session' && typeof o.id === 'string') { id = o.id; }
                    } catch (err) {
                        logError(`_readMeta: bad header in ${file}: ${(err as Error).message}`);
                    }
                }
                name = this._readLastName(file, stat.size);
            }
        } catch (err) {
            logError(`_readMeta failed for ${file}: ${(err as Error).message}`);
        }
        this._fileCache.set(file, { mtimeMs, id, name });
        return { id, name };
    }

    /** 读取 [start, start+len) 区间的文本 */
    private _readRange(file: string, start: number, len: number): string {
        if (len <= 0) { return ''; }
        const fd = fs.openSync(file, 'r');
        try {
            const buf = Buffer.allocUnsafe(len);
            fs.readSync(fd, buf, 0, len, start);
            return buf.toString('utf8');
        } finally {
            fs.closeSync(fd);
        }
    }

    /** 从文件尾部向前分块扫描，返回最后一个 session_info 的名称。
     *  每字节最多读一次，且总量不超过 MAX_TAIL_SCAN_BYTES。 */
    private _readLastName(file: string, size: number): string | undefined {
        const fd = fs.openSync(file, 'r');
        try {
            let pos = size;
            let scanned = 0;
            let pending = ''; // 右侧已扫描区块开头那段不完整的行
            while (pos > 0 && scanned < MAX_TAIL_SCAN_BYTES) {
                const len = Math.min(TAIL_CHUNK_BYTES, pos, MAX_TAIL_SCAN_BYTES - scanned);
                pos -= len;
                scanned += len;
                const buf = Buffer.allocUnsafe(len);
                fs.readSync(fd, buf, 0, len, pos);
                const lines = (buf.toString('utf8') + pending).split('\n');
                pending = pos > 0 ? lines[0] : '';
                // pos>0 时 lines[0] 可能被截断，跳过；文件头那一块则完整
                for (let i = lines.length - 1; i >= (pos > 0 ? 1 : 0); i--) {
                    if (lines[i].indexOf('session_info') === -1) { continue; }
                    try {
                        const o = JSON.parse(lines[i]);
                        if (o.type === 'session_info') {
                            return (typeof o.name === 'string' ? o.name.trim() : '') || undefined;
                        }
                    } catch {
                        // 跨块边界可能截断，忽略该行
                    }
                }
            }
        } finally {
            fs.closeSync(fd);
        }
        return undefined;
    }
}
