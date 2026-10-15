// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import * as vscode from 'vscode';
import { PiToolResult } from '../sdk/piTypes';
import { MAX_MESSAGE_CHARS } from '../chatPanel/sharedTypes';
import { logError } from './logger';

/**
 * Extract displayable text output from a tool result (truncated when too long).
 */
export function extractToolOutput(result: PiToolResult | undefined, maxLen = 200000): string {
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
 * Short summary of tool arguments.
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
 * Full display text for tool arguments (used as the card body).
 * The card title stays a summary; the full text goes here so long commands /
 * arguments are never hidden. Truncated with a note when over the cap.
 */
export function formatToolArgs(args: unknown, maxLen = 20000): string {
    if (args === undefined || args === null) { return ''; }
    try {
        const text = typeof args === 'string' ? args : JSON.stringify(args, null, 2);
        if (!text) { return ''; }
        if (text.length <= maxLen) { return text; }
        return text.slice(0, maxLen) + '\n' + vscode.l10n.t('… (arguments truncated, {0} characters total)', text.length);
    } catch (err) {
        logError(`formatToolArgs failed: ${(err as Error).message}`);
        return '';
    }
}

/**
 * Format token usage.
 */
export function formatUsage(usage: { input?: number; output?: number; cacheRead?: number }): string {
    const parts: string[] = [];
    if (usage.input) { parts.push(vscode.l10n.t('Input {0}', usage.input.toLocaleString())); }
    if (usage.output) { parts.push(vscode.l10n.t('Output {0}', usage.output.toLocaleString())); }
    if (usage.cacheRead) { parts.push(vscode.l10n.t('Cache hit {0}', usage.cacheRead.toLocaleString())); }
    return parts.join(' / ');
}

/**
 * Validate a user message.
 */
export function validateMessage(text: string): { valid: boolean; error?: string } {
    if (!text.trim()) {
        return { valid: false, error: vscode.l10n.t('Message cannot be empty') };
    }
    if (text.length > MAX_MESSAGE_CHARS) {
        return { valid: false, error: vscode.l10n.t('Message too long (max {0} characters)', MAX_MESSAGE_CHARS) };
    }
    return { valid: true };
}
