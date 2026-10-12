// ---------------------------------------------------------------------------
// 消息协议共享类型（扩展宿主 ↔ webview 双向）
//
// 本文件是两边唯一的消息契约定义，src/ 与 webview/ 均从此文件导入。
// ---------------------------------------------------------------------------

import { PiImageBlock } from '../sdk/piTypes';

export type ImageAttachment = { type?: string; data?: string; mimeType?: string };

// ---- 扩展宿主 → webview ----

export interface PostMessage {
    type: string;
    text?: string;
    busy?: boolean;
    isError?: boolean;
    messages?: Array<{ role: string; text: string; images?: PiImageBlock[] }>;
    models?: Array<{ provider: string; id: string }>;
    current?: { provider: string; id: string } | string | null;
    levels?: string[];
    currentThinking?: string | null;
    permissionMode?: string;
    sessions?: Array<{ id: string; file: string; createdAt: number; messageCount: number; name?: string; preview?: string }>;
    tool?: string;
    detail?: string;
    toolCallId?: string;
    output?: string;
    diff?: string;
    durationMs?: number;
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
    contexts?: Array<{ id: string; type: string; path: string; lineRange?: string }>;
    images?: ImageAttachment[];
    pending?: 'steering' | 'queued';
    steering?: string[];
    followUp?: string[];
    paths?: string[];
    openEditors?: Array<{ path: string; label: string; range?: string }>;
    recentFiles?: Array<{ path: string; label: string }>;
    code?: string;
    [key: string]: unknown;
}

// ---- webview → 扩展宿主 ----

export interface WebviewMessage {
    type: string;
    text?: string;
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
