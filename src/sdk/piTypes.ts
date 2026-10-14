// ---------------------------------------------------------------------------
// Minimal type interfaces for the pi SDK
// ---------------------------------------------------------------------------

export interface PiUsage {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
}

export interface PiAssistantMessageEvent {
    type: string;
    /** Incremental text (text_delta / thinking_delta) */
    delta?: string;
    toolName?: string;
    /** Content-block index; carried by every text_* / thinking_* / toolcall_* event */
    contentIndex?: number;
    /** Full text of the block, carried by text_end (authoritative when deltas are missing) */
    content?: string;
    /**
     * Full thinking text of the block, carried by thinking_end.
     * Provider adapters use `content`; the pi-messages channel uses `thinking`.
     * Both must be handled.
     */
    thinking?: string;
}

export interface PiToolResultBlock {
    type?: string;
    text?: string;
}

export interface PiToolResultDetails {
    /** Edit tool: diff for display */
    diff?: string;
    /** Edit tool: unified patch */
    patch?: string;
    firstChangedLine?: number;
    /** Path to the full output on disk when pi truncated it */
    fullOutputPath?: string;
    /** pi's own truncation info (pi truncating; the extension must not truncate again) */
    truncation?: PiToolTruncation;
}

/** pi's truncation info for very long tool output */
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
    // extension_ui_request fields
    id?: string;
    method?: string;
    title?: string;
    /** Prompt text for extension_ui_request; the full message for message_start / message_end */
    message?: string | PiRawMessage;
    options?: string[];
    placeholder?: string;
    prefill?: string;
    notifyType?: string;
}

/** Reply to pi with an extension_ui_response (fire-and-forget, written to the child's stdin) */
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
// Long-running command timeout patch
// ---------------------------------------------------------------------------

/**
 * The pi SDK's `RpcClient.send` hard-codes a 30s response timeout, and
 * RpcClientOptions exposes no override. `compact` (summarizing a long session)
 * and `bash` (long commands) easily exceed it and then throw
 * "Timeout waiting for response to ...".
 *
 * This wraps `send` on the instance: long-running commands get a longer timeout,
 * everything else still goes through the original implementation. It relies on
 * the SDK's private fields (process / pendingRequests / requestId / ...) and
 * safely falls back (leaving `send` untouched) when the shape differs.
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
                // The SDK's serializeJsonLine is just `${JSON.stringify(value)}\n`; same thing here
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
    /** assistant: why this turn failed (pi carries the error on an empty message) */
    errorMessage?: string;
    /** toolResult: the matching toolCallId */
    toolCallId?: string;
    /** toolResult: tool name */
    toolName?: string;
    /** toolResult: whether it failed */
    isError?: boolean;
    /** toolResult: duration */
    durationMs?: number;
}

/** A tool-call block inside an assistant message */
export interface PiToolCallBlock {
    id?: string;
    name?: string;
    arguments?: unknown;
}

/** A tool-result message (role: 'toolResult') */
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
    /** Insert a message into the running turn (interrupts it) */
    steer?(message: string, images?: unknown[]): Promise<string>;
    /** Queue a message to be handled after the current turn */
    followUp?(message: string, images?: unknown[]): Promise<string>;
    /** Clear queued steer / follow-up messages */
    clearQueue?(): Promise<{ steering: string[]; followUp: string[] }>;
    /** Switch to the next model */
    cycleModel?(): Promise<{ model?: { provider?: string; id?: string } } | null>;
    /** Switch to the next thinking level */
    cycleThinkingLevel?(): Promise<{ level?: string } | null>;
    /** Compact the session context */
    compact?(customInstructions?: string): Promise<{ summary?: string; tokensBefore?: number; estimatedTokensAfter?: number }>;
    /** Clone the current branch into a new session */
    clone?(): Promise<{ cancelled: boolean }>;
    /** Run a shell command directly (no model turn) */
    bash?(command: string): Promise<{ output: string; exitCode?: number; cancelled: boolean; truncated: boolean; fullOutputPath?: string }>;
    abort(): Promise<void>;
    newSession(parentSession?: string): Promise<{ cancelled: boolean }>;
    switchSession(sessionPath: string): Promise<{ cancelled: boolean }>;
    setSessionName(name: string): Promise<void>;
    getState(): Promise<PiSessionState>;
    getMessages(): Promise<PiRawMessage[]>;
    getAvailableModels(): Promise<PiModelInfo[]>;
    /** Available slash commands / prompt templates / skills */
    getCommands?(): Promise<PiSlashCommand[]>;
    setModel(provider: string, modelId: string): Promise<{ provider: string; id: string }>;
    getAvailableThinkingLevels?(): Promise<string[]>;
    setThinkingLevel?(level: string): Promise<void>;
    getSessionStats?(): Promise<PiSessionStats>;
    /** Wait until the agent is idle (an agent_settled event) */
    waitForIdle?(timeout?: number): Promise<void>;
    /** Text of the last assistant message */
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
// SDK loading and caching
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
// pi CLI path resolution
// ---------------------------------------------------------------------------

export interface ResolvedPi {
    cliPath: string;
    sdkEntry: string;
}

/** Resolve a package directory to pi's CLI + SDK entry points (both dist/cli.js and dist/index.js must exist) */
function resolvePackageDir(dir: string): ResolvedPi | null {
    if (!dir) { return null; }
    const cliPath = path.join(dir, 'dist', 'cli.js');
    const sdkEntry = path.join(dir, 'dist', 'index.js');
    if (fs.existsSync(cliPath) && fs.existsSync(sdkEntry)) {
        return { cliPath, sdkEntry };
    }
    return null;
}

/** Walk up from the start directory to the nearest package.json; returns the start directory if the filesystem root is reached */
function findPackageRoot(startDir: string): string {
    let dir = startDir;
    let parent = path.dirname(dir);
    while (!fs.existsSync(path.join(dir, 'package.json')) && parent !== dir) {
        dir = parent;
        parent = path.dirname(dir);
    }
    return dir;
}

/** Resolve cliPath + sdkEntry from a custom pi executable path */
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

/** pi executable names (Windows needs .cmd/.exe) */
function piExecutableNames(): string[] {
    return process.platform === 'win32' ? ['pi.cmd', 'pi.exe', 'pi'] : ['pi'];
}

/** Resolve pi from an executable path: follow the symlink up to package.json, else fall back to a sibling node_modules */
function resolveFromBin(bin: string): ResolvedPi | null {
    try {
        const real = fs.realpathSync(bin);
        const found = resolvePackageDir(findPackageRoot(path.dirname(real)));
        if (found) { return found; }
    } catch { /* not a file or not a symlink: keep trying the sibling node_modules */ }
    // Windows npm global: the bin dir (%APPDATA%\npm) sits next to node_modules
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

/** Find the first existing executable name on PATH */
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

/** Locate a global pi via `npm root -g` */
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
        // Fallback: npm's bin directory (on Windows, root itself is the global dir)
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
    // 0. A user-configured executable wins
    if (executableOverride) {
        const custom = resolvePiFromCli(executableOverride);
        if (custom) { return custom; }
    }

    // 1. Prefer pi bundled with the extension
    const bundled = resolvePackageDir(
        path.join(extensionPath, 'node_modules', '@earendil-works', 'pi-coding-agent')
    );
    if (bundled) { return bundled; }

    // 1.5 Dev mode: look from the project root.
    // extensionPath may be a .vscode-test/... directory, so walk upwards.
    let searchDir = extensionPath;
    for (let i = 0; i < 5; i++) {
        const packageJsonPath = path.join(searchDir, 'package.json');
        if (fs.existsSync(packageJsonPath)) {
            // Found the project root; look for node_modules
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

    // 2. pi on PATH (covers nvm/fnm/asdf/volta/bun/pnpm/custom prefixes, ...)
    const onPath = findOnPath(piExecutableNames());
    if (onPath) {
        const found = resolveFromBin(onPath);
        if (found) { return found; }
    }

    // 2.5 npm global install (npm i -g @earendil-works/pi-coding-agent)
    const npmGlobal = resolveNpmGlobal();
    if (npmGlobal) { return npmGlobal; }

    // 3. Common install locations
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

    // 3.5 nvm version dirs + the fnm default alias
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
// Message text extraction
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
    /** All text blocks concatenated in order, verbatim (no separator, so it can be prefix-compared with streamed deltas) */
    text: string;
    /** All thinking blocks concatenated in order, verbatim */
    thinking: string;
    toolCalls: PiToolCallBlock[];
}

/** Split an assistant message into content blocks (text / thinking / toolCall) for filling in missing content */
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

/** Read a tool-result message (role: 'toolResult'); returns null for anything else */
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

/** Extract image blocks from message content (to echo images the user pasted) */
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
