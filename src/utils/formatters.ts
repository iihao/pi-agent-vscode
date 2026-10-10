// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

import * as vscode from 'vscode';
import { PiToolResult } from '../sdk/piTypes';
import { logError } from './logger';

/**
 * 从工具结果中提取可展示的文本输出（超长则截断）
 */
export function extractToolOutput(result: PiToolResult | undefined, maxLen = 20000): string {
    if (!result) { return ''; }
    const c = result.content;
    let text = '';
    if (typeof c === 'string') {
        text = c;
    } else if (Array.isArray(c)) {
        const parts: string[] = [];
        for (const block of c) {
            if (block && typeof block.text === 'string') { parts.push(block.text); }
        }
        text = parts.join('\n');
    }
    text = text.trim();
    if (text.length > maxLen) {
        text = text.slice(0, maxLen) + '\n' + vscode.l10n.t('… (output truncated, {0} characters total)', text.length);
    }
    return text;
}

/**
 * 工具参数摘要
 */
export function summarizeToolArgs(args: unknown): string {
    try {
        const a = args as Record<string, unknown> | undefined;
        if (!a) { return ''; }
        if (typeof a.path === 'string') { return a.path; }
        if (typeof a.command === 'string') {
            const cmd = String(a.command);
            return cmd.length > 90 ? cmd.slice(0, 90) + '…' : cmd;
        }
        const json = JSON.stringify(a);
        return json.length > 90 ? json.slice(0, 90) + '…' : json;
    } catch (err) {
        logError(`summarizeToolArgs failed: ${(err as Error).message}`);
        return '';
    }
}

/**
 * 格式化 token 用量
 */
export function formatUsage(usage: { input?: number; output?: number; cacheRead?: number }): string {
    const parts: string[] = [];
    if (usage.input) { parts.push(vscode.l10n.t('Input {0}', usage.input.toLocaleString())); }
    if (usage.output) { parts.push(vscode.l10n.t('Output {0}', usage.output.toLocaleString())); }
    if (usage.cacheRead) { parts.push(vscode.l10n.t('Cache hit {0}', usage.cacheRead.toLocaleString())); }
    return parts.join(' / ');
}

/**
 * 验证用户消息
 */
export function validateMessage(text: string): { valid: boolean; error?: string } {
    if (!text.trim()) {
        return { valid: false, error: vscode.l10n.t('Message cannot be empty') };
    }
    if (text.length > 10000) {
        return { valid: false, error: vscode.l10n.t('Message too long (max {0} characters)', 10000) };
    }
    return { valid: true };
}
