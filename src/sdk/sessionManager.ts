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

const MAX_PARSE_BYTES = 8 * 1024 * 1024;

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

    /** 读取会话文件元数据：真实 id（首行 header）与名称（最后一个 session_info） */
    private _readMeta(file: string, mtimeMs: number): { id: string; name?: string } {
        const cached = this._fileCache.get(file);
        if (cached && cached.mtimeMs === mtimeMs) {
            return { id: cached.id, name: cached.name };
        }
        let id = path.basename(file, '.jsonl');
        let name: string | undefined;
        try {
            const stat = fs.statSync(file);
            if (stat.size <= MAX_PARSE_BYTES) {
                const lines = fs.readFileSync(file, 'utf8').split('\n');
                const first = lines.find((l) => l.trim());
                if (first) {
                    try {
                        const o = JSON.parse(first);
                        if (o.type === 'session' && typeof o.id === 'string') { id = o.id; }
                    } catch (err) {
                        logError(`_readMeta: bad header in ${file}: ${(err as Error).message}`);
                    }
                }
                for (let i = lines.length - 1; i >= 0; i--) {
                    if (lines[i].indexOf('session_info') === -1) { continue; }
                    try {
                        const o = JSON.parse(lines[i]);
                        if (o.type === 'session_info') {
                            name = (typeof o.name === 'string' ? o.name.trim() : '') || undefined;
                            break;
                        }
                    } catch (err) {
                        logError(`_readMeta: bad session_info line in ${file}: ${(err as Error).message}`);
                    }
                }
            }
        } catch (err) {
            logError(`_readMeta failed for ${file}: ${(err as Error).message}`);
        }
        this._fileCache.set(file, { mtimeMs, id, name });
        return { id, name };
    }
}
