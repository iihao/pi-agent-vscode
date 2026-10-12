// ---------------------------------------------------------------------------
// window message 路由（扩展宿主 → webview）
// ---------------------------------------------------------------------------

import type { WebviewContext, PostMessage } from '../types';
import { scrollToBottom, getMessageText } from '../utils';
import { renderMermaid } from '../markdown';
import {
    addMessage, addNotice, setBusy, showThinking, appendThinking, hideThinking, resetThinking,
    startAssistantStream, appendAssistantChunk, endAssistantStream, abortAssistantStream,
    renderTurnChanges, resetWorking,
} from './messageRenderer';
import { addTool, setToolOutput, endTool, finishBash } from './toolRenderer';
import {
    renderModelPanel, renderThinkingPanel, renderPermissionPanel, renderChips, renderStats,
    renderAttachPanel, renderSessionPanel, updateConnectionStatus, updateMessageCount,
} from './panels';
import { updateQueueBadges } from './queue';
import { updateSuggest, closeSuggest } from './slashCommands';
import { clearSearch } from './search';
import { renderRail } from './navigator';
import { autoResizeInput, editMessage } from './inputHandling';
import { renderImages } from './imagePaste';
import { updateContextUsage, resetContextUsage } from './contextUsage';

let ctx: WebviewContext;

export function initMessageHandler(c: WebviewContext): void {
    ctx = c;
    window.addEventListener('message', function (e: MessageEvent) {
        handle(e.data as PostMessage);
    });
}

function handle(m: PostMessage): void {
    const els = ctx.els;
    const S = ctx.S;
    switch (m.type) {
        case 'addUserMessage':
            addMessage('user', m.text || '', false, m.pending, m.images);
            break;

        case 'history':
            if (m.messages && m.messages.length) {
                els.welcome.style.display = 'none';
                m.messages.forEach(function (msg) { addMessage(msg.role, msg.text, false, undefined, msg.images as never); });
                const div = document.createElement('div');
                div.className = 'history-divider';
                div.textContent = S.historyDivider;
                els.chat.appendChild(div);
                scrollToBottom(els.chat);
                void renderMermaid(els.chat);
            }
            break;

        case 'thinkingStart': showThinking(); break;
        case 'thinkingDelta': appendThinking(m.text || ''); break;
        case 'thinkingEnd': hideThinking(); break;
        case 'toolCall': addTool(m.tool || 'tool', m.detail, m.toolCallId); break;
        case 'toolUpdate': setToolOutput(m.toolCallId, m.output || ''); break;
        case 'toolEnd': endTool(m.toolCallId, m); break;

        case 'assistantStart':
            startAssistantStream();
            break;
        case 'assistantChunk':
            appendAssistantChunk(m.text || '');
            break;
        case 'assistantEnd':
            endAssistantStream();
            break;

        case 'notice': addNotice(m.text || ''); break;
        case 'focusInput': els.input.focus(); break;
        case 'editLast': {
            const users = els.chat.querySelectorAll('.message.user');
            const last = users[users.length - 1] as HTMLElement | undefined;
            if (last) { editMessage(getMessageText(last.querySelector('.message-body') as HTMLElement | null), last); }
            break;
        }
        case 'queue': updateQueueBadges(m.steering, m.followUp); break;
        case 'bashResult': if (m.id) { finishBash(m as unknown as { id: string; isError?: boolean; cancelled?: boolean; exitCode?: number; output?: string; truncated?: boolean }); } break;
        case 'turnChanges': renderTurnChanges((m.files as Array<{ path: string; status: 'created' | 'modified' }>) || []); break;

        case 'commands':
            ctx.slashCommands = (m.commands as typeof ctx.slashCommands) || [];
            if (ctx.suggestMode === 'slash') { updateSuggest(); }
            break;
        case 'files':
            ctx.filesList = (m.files as string[]) || [];
            if (ctx.suggestMode === 'file') { updateSuggest(); }
            break;
        case 'insertMentions': {
            const insert = ((m.paths as string[]) || []).map(function (p) { return '@' + p + ' '; }).join('');
            if (insert) {
                const input = els.input;
                const pos = input.selectionStart;
                input.value = input.value.slice(0, pos) + insert + input.value.slice(input.selectionEnd);
                input.selectionStart = input.selectionEnd = pos + insert.length;
                input.focus();
                autoResizeInput();
            }
            break;
        }

        case 'error':
            hideThinking();
            abortAssistantStream();
            addMessage('assistant', m.text || '', true);
            break;

        case 'setBusy': setBusy(Boolean(m.busy)); break;

        case 'focusSearch':
            els.searchBar.classList.add('visible');
            els.searchInput.focus();
            break;

        case 'showHelp': {
            const lines = [
                'Available commands:',
                '',
                '/compact — Compact session (summarize older turns)',
                '/clear — Clear the conversation',
                '/new — Start a new session',
                '/clone — Clone the current session',
                '/model — Switch model',
                '/thinking — Set thinking level',
                '/permission — Set permission mode',
                '/sessions — Switch session',
                '/export — Export conversation as Markdown',
                '/search — Search messages (Ctrl+F)',
                '/help — Show this help',
                '',
                'Pi SDK commands (from /help in pi):',
            ];
            if (ctx.slashCommands.length) {
                ctx.slashCommands.forEach(function (c) {
                    lines.push('/' + c.name + ' — ' + (c.description || ''));
                });
            }
            addNotice(lines.join('\n'));
            scrollToBottom(els.chat);
            break;
        }

        case 'connecting':
            updateConnectionStatus('connecting');
            ctx.modelsList = [];
            ctx.currentModel = null;
            els.modelLabel.textContent = S.connecting;
            els.modelPanel.innerHTML = '';
            break;

        case 'models': {
            ctx.modelsList = (m.models as typeof ctx.modelsList) || [];
            ctx.currentModel = (m.current as typeof ctx.currentModel) || null;
            if (ctx.modelsList.length === 0) {
                updateConnectionStatus('disconnected');
                els.modelLabel.textContent = S.connectionFailed;
            } else {
                updateConnectionStatus('connected');
            }
            renderModelPanel();
            break;
        }

        case 'modelsError':
            els.modelLabel.textContent = S.noModels;
            els.modelPanel.innerHTML = '<div class="popover-empty">' + S.noModels + '</div>';
            break;

        case 'thinking':
            ctx.thinkingLevels = (m.levels as string[]) || [];
            ctx.currentThinking = (m.currentThinking as string | null) || null;
            renderThinkingPanel();
            break;

        case 'permission':
            ctx.permissionMode = (m.permissionMode as string) || 'ask';
            renderPermissionPanel();
            break;

        case 'stats':
            renderStats(m.stats);
            updateContextUsage(m.stats);
            break;

        case 'contexts':
            ctx.contexts = (m.contexts as typeof ctx.contexts) || [];
            renderChips();
            break;

        case 'attachMenu':
            ctx.attachOpenEditors = (m.openEditors as typeof ctx.attachOpenEditors) || [];
            ctx.attachRecent = (m.recentFiles as typeof ctx.attachRecent) || [];
            if (ctx.attachPending) {
                renderAttachPanel();
                els.attachPanel.classList.remove('hidden');
                ctx.attachPending = false;
            }
            break;

        case 'sessions':
            ctx.sessionsList = (m.sessions as typeof ctx.sessionsList) || [];
            ctx.currentSessionId = (m.current as string | null) || null;
            renderSessionPanel();
            break;

        case 'clear':
            els.chat.querySelectorAll('.message, .status-line, .activity, .history-divider, .collapsible, .turn-changes').forEach(function (el) { el.remove(); });
            els.welcome.style.display = '';
            ctx.currentBody = null;
            ctx.currentBuffer = '';
            resetThinking();
            resetWorking();
            ctx.runningTools = {};
            ctx.editingMessageEl = null;
            ctx.contexts = [];
            renderChips();
            els.ctxStats.classList.add('hidden');
            clearSearch();
            closeSuggest();
            ctx.pendingImages = [];
            renderImages();
            updateMessageCount();
            renderRail();
            scrollToBottom(els.chat);
            resetContextUsage();
            break;

        default:
            break;
    }
}
