// ---------------------------------------------------------------------------
// 消息协议共享类型（扩展宿主 ↔ webview 双向）
//
// 本文件是两边唯一的消息契约定义，src/ 与 webview/ 均从此文件导入。
// ---------------------------------------------------------------------------

import { PiImageBlock } from '../sdk/piTypes';

export type ImageAttachment = { type?: string; data?: string; mimeType?: string };

/** 文件/选区引用（输入框附件与消息回显共用） */
export interface ContextAttachment {
    type: string;
    path: string;
    lineRange?: string;
}

/** 首次环境自检状态 */
export interface SetupStatus {
    connecting: boolean;
    connected: boolean;
    piFound: boolean;
    hasModels: boolean;
    workspaceTrusted: boolean;
}

// ---- 扩展宿主 → webview ----

export interface PostMessage {
    type: string;
    text?: string;
    busy?: boolean;
    isError?: boolean;
    /** 错误气泡上的可操作按钮 */
    actions?: Array<{ id: string; label: string }>;
    /** 首次环境自检 */
    setup?: SetupStatus;
    messages?: Array<{ role: string; text: string; images?: PiImageBlock[]; attachments?: ContextAttachment[] }>;
    models?: Array<{ provider: string; id: string }>;
    current?: { provider: string; id: string } | string | null;
    levels?: string[];
    currentThinking?: string | null;
    permissionMode?: string;
    sessions?: Array<{ id: string; file: string; createdAt: number; messageCount: number; name?: string; preview?: string }>;
    tool?: string;
    detail?: string;
    /** 工具参数全文（卡片正文展示，避免长命令只看到摘要） */
    toolArgs?: string;
    toolCallId?: string;
    output?: string;
    diff?: string;
    durationMs?: number;
    /** 工具输出被 pi 截断 */
    truncated?: boolean;
    /** 被截断时的完整输出文件路径（可打开） */
    fullOutputPath?: string;
    toolCalls?: Array<{ tool: string; detail: string; isError?: boolean }>;
    stats?: {
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite: number;
        contextPercent: number | null;
        contextWindow: number;
        autoCompact: boolean;
    };
    contexts?: Array<ContextAttachment & { id: string; auto?: boolean }>;
    /** 本条用户消息携带的文件/选区附件（消息回显用） */
    attachments?: ContextAttachment[];
    images?: ImageAttachment[];
    pending?: 'steering' | 'queued';
    steering?: string[];
    followUp?: string[];
    paths?: string[];
    openEditors?: Array<{ path: string; label: string; range?: string }>;
    recentFiles?: Array<{ path: string; label: string }>;
    code?: string;
    // 工作区文件列表（@ 提及补全）
    files?: string[];
    // 本回合改动 / 撤销
    turnFiles?: Array<{ path: string; status: 'created' | 'modified'; revertible: boolean; state: 'pending' | 'reverted' | 'deleted' | 'failed' | 'skipped'; diff?: string }>;
    results?: Array<{ path: string; result: 'reverted' | 'deleted' | 'failed' | 'skipped'; error?: string }>;
    canUndo?: boolean;
    restored?: number;
    autoHideMs?: number;
    [key: string]: unknown;
}

// ---- webview → 扩展宿主 ----

export interface WebviewMessage {
    type: string;
    text?: string;
    /** 错误气泡按钮的动作 id（retry / logs …） */
    action?: string;
    code?: string;
    provider?: string;
    modelId?: string;
    sessionId?: string;
    markdown?: string;
    href?: string;
    level?: string;
    currentName?: string;
    id?: string;
    mode?: string;
    paths?: string[];
    path?: string;
    range?: string;
    images?: ImageAttachment[];
}
