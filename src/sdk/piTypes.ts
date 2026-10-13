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
    /** 增量文本（text_delta / thinking_delta） */
    delta?: string;
    toolName?: string;
    /** 内容块下标：text_* / thinking_* / toolcall_* 事件都会携带 */
    contentIndex?: number;
    /** text_end 携带的该文本块完整内容（增量缺失时的权威来源） */
    content?: string;
    /**
     * thinking_end 携带的该思考块完整内容。
     * 各 provider 适配器用 `content`，pi-messages 通道用 `thinking`，两者都要兜住。
     */
    thinking?: string;
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
    /** 输出被 pi 截断时，完整输出的落盘路径 */
    fullOutputPath?: string;
    /** pi 自身的截断信息（注意：这是 pi 的截断，扩展不应再截断一次） */
    truncation?: PiToolTruncation;
}

/** pi 对超长工具输出的截断信息 */
export interface PiToolTruncation {
    truncated?: boolean;
    truncatedBy?: string;
    totalLines?: number;
    totalBytes?: number;
    outputLines?: number;
    outputBytes?: number;
    maxLines?: number;
    maxBytes?: number;
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
    /** extension_ui_request 的提示文本；message_start / message_end 时是完整消息 */
    message?: string | PiRawMessage;
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

// ---------------------------------------------------------------------------
// 长任务超时补丁
// ---------------------------------------------------------------------------

/**
 * pi SDK 的 `RpcClient.send` 内部硬编码了 30s 响应超时，且 RpcClientOptions
 * 没有提供配置项。`compact`（模型总结长会话）与 `bash`（长命令）很容易超过，
 * 于是抛「Timeout waiting for response to ...」。
 *
 * 这里在实例上包一层 `send`：长任务命令使用更长的超时，其余命令仍走原实现。
 * 依赖 SDK 的私有字段（process / pendingRequests / requestId / ...），
 * 结构不符时安全回退（不改动 send）。
 */
const LONG_RUNNING_COMMAND_TIMEOUT_MS: Record<string, number> = {
    compact: 10 * 60 * 1000,
    bash: 10 * 60 * 1000,
};

interface PatchedRpcClient {
    send?: (command: { type: string }) => Promise<unknown>;
    pendingRequests?: Map<string, { resolve: (value: unknown) => void; reject: (error: unknown) => void }>;
    requestId?: number;
    process?: {
        stdin?: { write(data: string): boolean; destroyed?: boolean; writable?: boolean };
        exitCode?: number | null;
        signalCode?: string | null;
    };
    stderr?: string;
    exitError?: unknown;
    createProcessExitError?: (code: number | null, signal: string | null) => Error;
    __piTimeoutPatched?: boolean;
}

export function patchLongRunningTimeouts(client: PiRpcClient): void {
    const c = client as unknown as PatchedRpcClient;
    if (c.__piTimeoutPatched) { return; }
    const originalSend = c.send;
    const pendingRequests = c.pendingRequests;
    if (typeof originalSend !== 'function' || !(pendingRequests instanceof Map)) { return; }

    c.send = function sendWithLongTimeout(command: { type: string }): Promise<unknown> {
        const timeoutMs = LONG_RUNNING_COMMAND_TIMEOUT_MS[command?.type];
        if (!timeoutMs) { return originalSend.call(this, command); }

        const proc = c.process;
        const stdin = proc?.stdin;
        if (!proc || !stdin) { return Promise.reject(new Error('Pi client not started')); }
        if (c.exitError) { return Promise.reject(c.exitError); }
        if (proc.exitCode !== null && proc.exitCode !== undefined) {
            const error = c.createProcessExitError?.(proc.exitCode, proc.signalCode ?? null)
                ?? new Error(`Agent process exited (code=${proc.exitCode} signal=${proc.signalCode ?? ''})`);
            c.exitError = error;
            return Promise.reject(error);
        }
        if (stdin.destroyed || !stdin.writable) {
            return Promise.reject(new Error('Agent process stdin is not writable'));
        }

        c.requestId = (c.requestId ?? 0) + 1;
        const id = `req_${c.requestId}`;
        const fullCommand = { ...command, id };
        return new Promise<unknown>((resolve, reject) => {
            const timer = setTimeout(() => {
                pendingRequests.delete(id);
                reject(new Error(`Timeout waiting for response to ${command.type} after ${timeoutMs}ms. Stderr: ${c.stderr ?? ''}`));
            }, timeoutMs);
            pendingRequests.set(id, {
                resolve: (value) => { clearTimeout(timer); resolve(value); },
                reject: (error) => { clearTimeout(timer); reject(error); },
            });
            try {
                // SDK 的 serializeJsonLine 即 `${JSON.stringify(value)}\n`，这里等价实现
                stdin.write(JSON.stringify(fullCommand) + '\n');
            } catch (error) {
                const writeError = error instanceof Error ? error : new Error(String(error));
                pendingRequests.delete(id);
                reject(writeError);
            }
        });
    };
    c.__piTimeoutPatched = true;
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
    /** assistant：stop / toolUse / length / error / aborted */
    stopReason?: string;
    /** assistant：本回合失败原因（pi 用一条空消息承载错误） */
    errorMessage?: string;
    /** toolResult：对应的 toolCallId */
    toolCallId?: string;
    /** toolResult：工具名 */
    toolName?: string;
    /** toolResult：是否失败 */
    isError?: boolean;
    /** toolResult：耗时 */
    durationMs?: number;
}

/** 助手消息里的工具调用块 */
export interface PiToolCallBlock {
    id?: string;
    name?: string;
    arguments?: unknown;
}

/** 工具结果消息（role: 'toolResult'） */
export interface PiToolResultMessage {
    toolCallId: string;
    toolName: string;
    isError: boolean;
    durationMs?: number;
    content?: PiToolResultBlock[] | string;
    details?: PiToolResultDetails;
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
    /** 克隆当前分支为一个新会话 */
    clone?(): Promise<{ cancelled: boolean }>;
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
    /** 等待 agent 空闲（收到 agent_settled） */
    waitForIdle?(timeout?: number): Promise<void>;
    /** 取最后一条助手消息的文本 */
    getLastAssistantText?(): Promise<string | null>;
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
import { execFileSync } from 'child_process';
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

/** 把「包目录」解析为 pi 的 CLI + SDK 入口（要求 dist/cli.js 与 dist/index.js 同时存在） */
function resolvePackageDir(dir: string): ResolvedPi | null {
    if (!dir) { return null; }
    const cliPath = path.join(dir, 'dist', 'cli.js');
    const sdkEntry = path.join(dir, 'dist', 'index.js');
    if (fs.existsSync(cliPath) && fs.existsSync(sdkEntry)) {
        return { cliPath, sdkEntry };
    }
    return null;
}

/** 从起始目录向上查找最近的 package.json 所在目录；到文件系统根仍找不到时返回起始目录 */
function findPackageRoot(startDir: string): string {
    let dir = startDir;
    let parent = path.dirname(dir);
    while (!fs.existsSync(path.join(dir, 'package.json')) && parent !== dir) {
        dir = parent;
        parent = path.dirname(dir);
    }
    return dir;
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
        return resolvePackageDir(findPackageRoot(dir));
    } catch (err) {
        logError(`resolvePiFromCli failed for ${cliPath}: ${(err as Error).message}`);
    }
    return null;
}

/** pi 的可执行文件名（Windows 需要 .cmd/.exe） */
function piExecutableNames(): string[] {
    return process.platform === 'win32' ? ['pi.cmd', 'pi.exe', 'pi'] : ['pi'];
}

/** 从可执行文件路径解析 pi：先解软链向上找 package.json，再回退同目录 node_modules */
function resolveFromBin(bin: string): ResolvedPi | null {
    try {
        const real = fs.realpathSync(bin);
        const found = resolvePackageDir(findPackageRoot(path.dirname(real)));
        if (found) { return found; }
    } catch { /* 文件不存在或不是软链：继续尝试同目录 node_modules */ }
    // Windows 的 npm 全局：bin（%APPDATA%\npm）与 node_modules 同级
    const binDir = path.dirname(bin);
    for (const rel of [
        path.join('node_modules', '@earendil-works', 'pi-coding-agent'),
        path.join('..', 'node_modules', '@earendil-works', 'pi-coding-agent'),
    ]) {
        const found = resolvePackageDir(path.join(binDir, rel));
        if (found) { return found; }
    }
    return null;
}

/** 在 PATH 中查找第一个存在的可执行文件名 */
function findOnPath(names: string[]): string | null {
    const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
    for (const dir of dirs) {
        for (const name of names) {
            const candidate = path.join(dir, name);
            if (fs.existsSync(candidate)) { return candidate; }
        }
    }
    return null;
}

/** 通过 `npm root -g` 定位全局安装的 pi */
function resolveNpmGlobal(): ResolvedPi | null {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    try {
        const root = execFileSync(npm, ['root', '-g'], {
            encoding: 'utf8',
            timeout: 5000,
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
        if (!root) { return null; }
        const inModules = resolvePackageDir(path.join(root, '@earendil-works', 'pi-coding-agent'));
        if (inModules) { return inModules; }
        // 回退：npm 的 bin 目录（Windows: root 本身即全局目录）
        for (const binDir of [root, path.dirname(root)]) {
            for (const name of piExecutableNames()) {
                const bin = path.join(binDir, name);
                if (fs.existsSync(bin)) {
                    const found = resolveFromBin(bin);
                    if (found) { return found; }
                }
            }
        }
    } catch (err) {
        logError(`npm root -g probe failed: ${(err as Error).message}`);
    }
    return null;
}

export function resolvePi(extensionPath: string, executableOverride?: string): ResolvedPi | null {
    // 0. 用户显式配置的可执行文件优先
    if (executableOverride) {
        const custom = resolvePiFromCli(executableOverride);
        if (custom) { return custom; }
    }

    // 1. 优先使用插件内置的 pi
    const bundled = resolvePackageDir(
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
            const projectBundled = resolvePackageDir(
                path.join(searchDir, 'node_modules', '@earendil-works', 'pi-coding-agent')
            );
            if (projectBundled) { return projectBundled; }
            break;
        }
        const parent = path.dirname(searchDir);
        if (parent === searchDir) { break; }
        searchDir = parent;
    }

    // 2. PATH 上的 pi（覆盖 nvm/fnm/asdf/volta/bun/pnpm/自定义 prefix 等）
    const onPath = findOnPath(piExecutableNames());
    if (onPath) {
        const found = resolveFromBin(onPath);
        if (found) { return found; }
    }

    // 2.5 npm 全局安装（npm i -g @earendil-works/pi-coding-agent）
    const npmGlobal = resolveNpmGlobal();
    if (npmGlobal) { return npmGlobal; }

    // 3. 常见安装位置
    const home = os.homedir();
    const binCandidates: string[] = [];
    if (process.platform === 'win32') {
        const appData = process.env.APPDATA;
        const localAppData = process.env.LOCALAPPDATA;
        if (appData) {
            binCandidates.push(path.join(appData, 'npm', 'pi.cmd'));
            binCandidates.push(path.join(appData, 'npm', 'pi'));
        }
        if (localAppData) {
            binCandidates.push(path.join(localAppData, 'pnpm', 'pi.cmd'));
            binCandidates.push(path.join(localAppData, 'Volta', 'bin', 'pi.exe'));
        }
    } else {
        binCandidates.push(
            path.join(home, '.local', 'opt', 'node', 'bin', 'pi'),
            path.join(home, '.local', 'bin', 'pi'),
            path.join(home, '.bun', 'bin', 'pi'),
            path.join(home, '.volta', 'bin', 'pi'),
            path.join(home, '.asdf', 'shims', 'pi'),
            path.join(home, '.nodenv', 'shims', 'pi'),
            path.join(home, '.yarn', 'bin', 'pi'),
            path.join(home, '.npm-global', 'bin', 'pi'),
            path.join(home, 'Library', 'pnpm', 'pi'),
            path.join(home, '.local', 'share', 'pnpm', 'pi'),
            '/opt/homebrew/bin/pi',
            '/usr/local/bin/pi',
            '/usr/bin/pi',
        );
    }

    // 3.5 nvm 各版本目录 + fnm 默认别名
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
    binCandidates.push(
        path.join(home, '.local', 'share', 'fnm', 'aliases', 'default', 'bin', 'pi'),
        path.join(home, '.fnm', 'aliases', 'default', 'bin', 'pi'),
    );

    for (const bin of binCandidates) {
        const found = resolveFromBin(bin);
        if (found) { return found; }
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

export interface PiMessageParts {
    /** 所有 text 块按顺序原样拼接（不加分隔符，便于与流式增量做前缀比对） */
    text: string;
    /** 所有 thinking 块按顺序原样拼接 */
    thinking: string;
    toolCalls: PiToolCallBlock[];
}

/** 拆解助手消息内容块（text / thinking / toolCall），用于漏内容补齐 */
export function extractMessageParts(m: PiRawMessage): PiMessageParts {
    const out: PiMessageParts = { text: '', thinking: '', toolCalls: [] };
    const c = m.content;
    if (typeof c === 'string') { out.text = c; return out; }
    if (!Array.isArray(c)) { return out; }
    for (const block of c) {
        if (!block || typeof block !== 'object') { continue; }
        const b = block as { type?: string; text?: string; thinking?: string; id?: string; name?: string; arguments?: unknown };
        if (b.type === 'text' && typeof b.text === 'string') { out.text += b.text; }
        else if (b.type === 'thinking' && typeof b.thinking === 'string') { out.thinking += b.thinking; }
        else if (b.type === 'toolCall') {
            out.toolCalls.push({ id: b.id, name: b.name, arguments: b.arguments });
        }
    }
    return out;
}

/** 读取工具结果消息（role: 'toolResult'），非工具结果返回 null */
export function extractToolResult(m: PiRawMessage): PiToolResultMessage | null {
    if (m.role !== 'toolResult' || !m.toolCallId) { return null; }
    return {
        toolCallId: m.toolCallId,
        toolName: m.toolName || 'tool',
        isError: Boolean(m.isError),
        durationMs: m.durationMs,
        content: m.content as PiToolResultBlock[] | string | undefined,
        details: (m as { details?: PiToolResultDetails }).details,
    };
}

export interface PiImageBlock {
    data?: string;
    mimeType?: string;
}

/** 从消息内容中提取图片块（用于在聊天里回显用户粘贴的图片） */
export function extractMessageImages(m: PiRawMessage): PiImageBlock[] {
    const c = m.content;
    if (!Array.isArray(c)) { return []; }
    const out: PiImageBlock[] = [];
    for (const block of c) {
        if (block && typeof block === 'object') {
            const b = block as { type?: string; data?: string; mimeType?: string };
            if (b.type === 'image' && typeof b.data === 'string') {
                out.push({ data: b.data, mimeType: b.mimeType });
            }
        }
    }
    return out;
}

export const PI_INSTALL_HINT = 'npm install -g @earendil-works/pi-coding-agent';
