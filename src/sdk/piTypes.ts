// ---------------------------------------------------------------------------
// pi SDK 的最小类型接口
// ---------------------------------------------------------------------------

export interface PiUsage {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
}

export interface PiAssistantMessageEvent {
    type: string;
    delta?: string;
    toolName?: string;
}

export interface PiToolResultBlock {
    type?: string;
    text?: string;
}

export interface PiToolResultDetails {
    /** 编辑工具：展示用 diff */
    diff?: string;
    /** 编辑工具：unified patch */
    patch?: string;
    firstChangedLine?: number;
    fullOutputPath?: string;
    truncation?: unknown;
}

export interface PiToolResult {
    content?: PiToolResultBlock[] | string;
    details?: PiToolResultDetails;
}

export interface PiAgentEvent {
    type: string;
    usage?: PiUsage;
    assistantMessageEvent?: PiAssistantMessageEvent;
    toolName?: string;
    toolCallId?: string;
    args?: unknown;
    result?: PiToolResult;
    partialResult?: PiToolResult;
    durationMs?: number;
    isError?: boolean;
    attempt?: number;
    maxAttempts?: number;
    errorMessage?: string;
    aborted?: boolean;
    // queue_update
    steering?: string[];
    followUp?: string[];
    // extension_ui_request 字段
    id?: string;
    method?: string;
    title?: string;
    message?: string;
    options?: string[];
    placeholder?: string;
    prefill?: string;
    notifyType?: string;
}

/** 向 pi 回一个 extension_ui_response（fire-and-forget，写入子进程 stdin） */
export function respondExtensionUI(
    client: PiRpcClient,
    id: string,
    response: { value?: string; confirmed?: boolean; cancelled?: boolean }
): boolean {
    const proc = (client as unknown as {
        process?: { stdin?: { write(data: string): boolean } };
    }).process;
    const stdin = proc?.stdin;
    if (!stdin || typeof stdin.write !== 'function') { return false; }
    try {
        stdin.write(JSON.stringify({ type: 'extension_ui_response', id, ...response }) + '\n');
        return true;
    } catch (err) {
        logError(`respondExtensionUI failed: ${(err as Error).message}`);
        return false;
    }
}

export interface PiSessionState {
    sessionId?: string;
    messageCount?: number;
    sessionFile?: string;
    isStreaming?: boolean;
    model?: { provider?: string; id?: string };
    thinkingLevel?: string;
    sessionName?: string;
    autoCompactionEnabled?: boolean;
}

export interface PiSessionStats {
    tokens?: {
        input?: number;
        output?: number;
        cacheRead?: number;
        cacheWrite?: number;
        total?: number;
    };
    contextUsage?: {
        tokens?: number | null;
        contextWindow?: number;
        percent?: number | null;
    };
}

export interface PiSlashCommand {
    name: string;
    description?: string;
    source?: string;
}

export interface PiModelInfo {
    provider: string;
    id: string;
    contextWindow?: number;
    reasoning?: boolean;
}

export interface PiRawMessage {
    role?: string;
    content?: unknown;
}

export interface PiRpcClient {
    start(): Promise<void>;
    stop(): Promise<void>;
    onEvent(listener: (event: PiAgentEvent) => void): () => void;
    prompt(message: string, images?: unknown[], streamingBehavior?: 'steer' | 'followUp'): Promise<string>;
    /** 向运行中的回合插入消息（打断当前回合） */
    steer?(message: string, images?: unknown[]): Promise<string>;
    /** 排队一条消息，当前回合结束后处理 */
    followUp?(message: string, images?: unknown[]): Promise<string>;
    /** 清空排队的 steer / follow-up 消息 */
    clearQueue?(): Promise<{ steering: string[]; followUp: string[] }>;
    /** 切换到下一个模型 */
    cycleModel?(): Promise<{ model?: { provider?: string; id?: string } } | null>;
    /** 切换到下一个思考档位 */
    cycleThinkingLevel?(): Promise<{ level?: string } | null>;
    /** 压缩会话上下文 */
    compact?(customInstructions?: string): Promise<{ summary?: string; tokensBefore?: number; estimatedTokensAfter?: number }>;
    /** 直接执行 shell 命令（不经过模型回合） */
    bash?(command: string): Promise<{ output: string; exitCode?: number; cancelled: boolean; truncated: boolean; fullOutputPath?: string }>;
    abort(): Promise<void>;
    newSession(parentSession?: string): Promise<{ cancelled: boolean }>;
    switchSession(sessionPath: string): Promise<{ cancelled: boolean }>;
    setSessionName(name: string): Promise<void>;
    getState(): Promise<PiSessionState>;
    getMessages(): Promise<PiRawMessage[]>;
    getAvailableModels(): Promise<PiModelInfo[]>;
    /** 可用的斜杠命令 / 提示模板 / 技能 */
    getCommands?(): Promise<PiSlashCommand[]>;
    setModel(provider: string, modelId: string): Promise<{ provider: string; id: string }>;
    getAvailableThinkingLevels?(): Promise<string[]>;
    setThinkingLevel?(level: string): Promise<void>;
    getSessionStats?(): Promise<PiSessionStats>;
    getStderr(): string;
}

export interface PiRpcClientCtor {
    new (options: { cliPath?: string; cwd?: string; args?: string[] }): PiRpcClient;
}

export interface PiSdkModule {
    RpcClient: PiRpcClientCtor;
}

// ---------------------------------------------------------------------------
// SDK 加载与缓存
// ---------------------------------------------------------------------------

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { pathToFileURL } from 'url';
import { logError } from '../utils/logger';

const sdkCache = new Map<string, Promise<PiSdkModule>>();

export function loadPiSdk(entryPath: string): Promise<PiSdkModule> {
    let cached = sdkCache.get(entryPath);
    if (!cached) {
        cached = (import(pathToFileURL(entryPath).href) as unknown as Promise<PiSdkModule>).catch(
            (err) => {
                sdkCache.delete(entryPath);
                throw err;
            }
        );
        sdkCache.set(entryPath, cached);
    }
    return cached;
}

// ---------------------------------------------------------------------------
// pi CLI 路径解析
// ---------------------------------------------------------------------------

export interface ResolvedPi {
    cliPath: string;
    sdkEntry: string;
}

/** 从自定义 pi 可执行文件路径解析 cliPath + sdkEntry */
export function resolvePiFromCli(cliPath: string): ResolvedPi | null {
    try {
        const real = fs.realpathSync(cliPath);
        const dir = path.dirname(real);
        const siblingEntry = path.join(dir, 'index.js');
        if (fs.existsSync(siblingEntry)) {
            return { cliPath: real, sdkEntry: siblingEntry };
        }
        let d = dir;
        let parent = path.dirname(d);
        while (!fs.existsSync(path.join(d, 'package.json')) && parent !== d) {
            d = parent;
            parent = path.dirname(d);
        }
        const cli = path.join(d, 'dist', 'cli.js');
        const entry = path.join(d, 'dist', 'index.js');
        if (fs.existsSync(cli) && fs.existsSync(entry)) {
            return { cliPath: cli, sdkEntry: entry };
        }
    } catch (err) {
        logError(`resolvePiFromCli failed for ${cliPath}: ${(err as Error).message}`);
    }
    return null;
}

export function resolvePi(extensionPath: string, executableOverride?: string): ResolvedPi | null {
    // 0. 用户显式配置的可执行文件优先
    if (executableOverride) {
        const custom = resolvePiFromCli(executableOverride);
        if (custom) { return custom; }
    }

    const tryPackageDir = (dir: string): ResolvedPi | null => {
        if (!dir) { return null; }
        const cliPath = path.join(dir, 'dist', 'cli.js');
        const sdkEntry = path.join(dir, 'dist', 'index.js');
        if (fs.existsSync(cliPath) && fs.existsSync(sdkEntry)) {
            return { cliPath, sdkEntry };
        }
        return null;
    };

    // 1. 优先使用插件内置的 pi
    const bundled = tryPackageDir(
        path.join(extensionPath, 'node_modules', '@earendil-works', 'pi-coding-agent')
    );
    if (bundled) { return bundled; }

    // 1.5 开发模式：尝试从项目根目录查找
    // extensionPath 可能是 .vscode-test/... 目录，需要向上查找
    let searchDir = extensionPath;
    for (let i = 0; i < 5; i++) {
        const packageJsonPath = path.join(searchDir, 'package.json');
        if (fs.existsSync(packageJsonPath)) {
            // 找到项目根目录，尝试查找 node_modules
            const projectBundled = tryPackageDir(
                path.join(searchDir, 'node_modules', '@earendil-works', 'pi-coding-agent')
            );
            if (projectBundled) { return projectBundled; }
            break;
        }
        const parent = path.dirname(searchDir);
        if (parent === searchDir) { break; }
        searchDir = parent;
    }

    // 2. 探测用户全局安装的 pi
    const home = os.homedir();
    const binCandidates: string[] = [
        path.join(home, '.local', 'opt', 'node', 'bin', 'pi'),
        '/opt/homebrew/bin/pi',
        '/usr/local/bin/pi',
        path.join(home, '.volta', 'bin', 'pi'),
        path.join(home, 'Library', 'pnpm', 'pi'),
    ];

    // 3. 探测 nvm 安装的 pi
    try {
        const nvmRoot = path.join(home, '.nvm', 'versions', 'node');
        if (fs.existsSync(nvmRoot)) {
            const versions = fs.readdirSync(nvmRoot).sort().reverse();
            for (const v of versions) {
                binCandidates.push(path.join(nvmRoot, v, 'bin', 'pi'));
            }
        }
    } catch (err) {
        logError(`scanning nvm versions failed: ${(err as Error).message}`);
    }

    for (const bin of binCandidates) {
        try {
            const real = fs.realpathSync(bin);
            let dir = path.dirname(real);
            let parent = path.dirname(dir);
            // 跨平台向上查找 package.json，parent === dir 表示已到文件系统根目录
            while (!fs.existsSync(path.join(dir, 'package.json')) && parent !== dir) {
                dir = parent;
                parent = path.dirname(dir);
            }
            const found = tryPackageDir(dir);
            if (found) { return found; }
        } catch (err) {
            logError(`probe pi candidate failed (${bin}): ${(err as Error).message}`);
        }
    }

    return null;
}

// ---------------------------------------------------------------------------
// 消息文本提取
// ---------------------------------------------------------------------------

export function extractMessageText(m: PiRawMessage): string | null {
    if (m.role !== 'user' && m.role !== 'assistant') { return null; }
    const c = m.content;
    if (typeof c === 'string') { return c.trim() || null; }
    if (Array.isArray(c)) {
        const texts: string[] = [];
        for (const block of c) {
            if (block && typeof block === 'object') {
                const b = block as { type?: string; text?: string };
                if (b.type === 'text' && typeof b.text === 'string') {
                    texts.push(b.text);
                }
            }
        }
        const joined = texts.join('\n').trim();
        return joined || null;
    }
    return null;
}

export const PI_INSTALL_HINT = 'npm install -g @earendil-works/pi-coding-agent';
