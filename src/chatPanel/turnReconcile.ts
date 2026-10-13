// ---------------------------------------------------------------------------
// 漏内容补齐（回合结束时的对账）
//
// 设计原则：扩展只决定「呈现形式」，内容一律以 pi 的权威消息为准。
//  - 流式事件（*_delta）负责即时体验，可能因为丢包/重连而缺片段；
//  - 消息结束事件（*_end / message_end）携带完整内容，是权威来源；
//  - 每个消息结束时做一次对账，把没渲染出去的部分补上。
// 任何情况下都不允许「内容被静默丢弃」：宁可重复，也不漏。
// ---------------------------------------------------------------------------

import {
    PiRawMessage,
    PiToolResultBlock,
    PiToolResultDetails,
    extractMessageParts,
    extractToolResult,
} from '../sdk/piTypes';

/** 一条消息流式阶段已经下发给 webview 的内容 */
export interface StreamedContent {
    text: string;
    thinking: string;
}

export interface MissingSuffix {
    /** 仍需下发的部分（空字符串 = 已经不缺） */
    suffix: string;
    /** 流式内容与权威内容不是前缀关系（说明增量丢失/被改写） */
    mismatch: boolean;
}

/**
 * 计算 full 相对 streamed 缺了什么。
 * streamed 为空 → 全量补发；streamed 是 full 的前缀 → 只补后缀。
 */
export function missingSuffix(full: string, streamed: string): MissingSuffix {
    if (!full || full === streamed) { return { suffix: '', mismatch: false }; }
    if (!streamed) { return { suffix: full, mismatch: false }; }
    if (full.startsWith(streamed)) { return { suffix: full.slice(streamed.length), mismatch: false }; }
    // 对不上：补发权威全文，避免漏内容（调用方会记一条诊断日志）
    return { suffix: full, mismatch: true };
}

export interface MissingToolCall {
    id: string;
    name: string;
    arguments?: unknown;
}

export interface AssistantCompletion {
    /** 仍缺的正文 */
    textSuffix: string;
    /** 仍缺的思考内容 */
    thinkingSuffix: string;
    /** 还没有渲染成卡片的工具调用 */
    toolCalls: MissingToolCall[];
    /** 该消息的失败原因（pi 用一条空助手消息承载错误） */
    error?: string;
    /** 该回合是被中止的（用户主动停止 / 被 abort），不是失败 */
    aborted: boolean;
    textMismatch: boolean;
    thinkingMismatch: boolean;
}

/**
 * 依据已结束的助手消息，算出还需要补发给 webview 的内容。
 * renderedToolIds：已经建过卡片的 toolCallId 集合。
 */
export function planAssistantCompletion(
    m: PiRawMessage,
    streamed: StreamedContent,
    renderedToolIds: ReadonlySet<string>,
): AssistantCompletion {
    const parts = extractMessageParts(m);
    const text = missingSuffix(parts.text, streamed.text);
    const thinking = missingSuffix(parts.thinking, streamed.thinking);
    const toolCalls: MissingToolCall[] = [];
    for (const tc of parts.toolCalls) {
        if (!tc.id || renderedToolIds.has(tc.id)) { continue; }
        toolCalls.push({ id: tc.id, name: tc.name || 'tool', arguments: tc.arguments });
    }
    const error = typeof m.errorMessage === 'string' && m.errorMessage ? m.errorMessage : undefined;
    return {
        textSuffix: text.suffix,
        thinkingSuffix: thinking.suffix,
        toolCalls,
        error,
        aborted: m.stopReason === 'aborted',
        textMismatch: text.mismatch,
        thinkingMismatch: thinking.mismatch,
    };
}

export interface ToolResultCompletion {
    toolCallId: string;
    toolName: string;
    isError: boolean;
    durationMs?: number;
    content?: PiToolResultBlock[] | string;
    details?: PiToolResultDetails;
    /** 卡片还没建过：需要先补一条 toolCall 再补结果 */
    needCard: boolean;
}

/**
 * 依据已结束的工具结果消息，算出需要补发的工具结果。
 * 已完成的结果重复下发是幂等的（webview 按 toolCallId 定位卡片）。
 */
export function planToolResultCompletion(
    m: PiRawMessage,
    renderedToolIds: ReadonlySet<string>,
): ToolResultCompletion | null {
    const r = extractToolResult(m);
    if (!r) { return null; }
    return {
        toolCallId: r.toolCallId,
        toolName: r.toolName,
        isError: r.isError,
        durationMs: r.durationMs,
        content: r.content,
        details: r.details,
        needCard: !renderedToolIds.has(r.toolCallId),
    };
}
