// ---------------------------------------------------------------------------
// window message routing (extension host -> webview)
// ---------------------------------------------------------------------------

import type { WebviewContext, PostMessage, HistoryItem } from '../types';
import { scrollToBottom, getMessageText } from '../utils';
import { renderMermaid } from '../markdown';
import {
    addMessage, addNotice, setBusy, showThinking, appendThinking, hideThinking, resetThinking,
    startAssistantStream, appendAssistantChunk, endAssistantStream,
    renderTurnChanges, updateTurnChangesResult, finishUndoRevert, resetWorking, renderErrorActions,
} from './messageRenderer';
import { addTool, setToolOutput, endTool, finishBash, settleTools, endToolGroup, resetToolGroup } from './toolRenderer';
import {
    renderModelPanel, renderThinkingPanel, renderPermissionPanel, renderChips, renderStats,
    renderAttachPanel, renderSessionPanel, updateConnectionStatus, updateMessageCount, renderSetup,
} from './panels';
import { updateQueueBadges } from './queue';
import { updateSuggest, closeSuggest } from './slashCommands';
import { clearSearch } from './search';
import { renderRail } from './navigator';
import { autoResizeInput, editMessage } from './inputHandling';
import { renderImages } from './imagePaste';
import { updateContextUsage, resetContextUsage } from './contextUsage';
import { renderHistory } from './historyRenderer';
import { clearTranscript } from './transcript';
import { enterBoot, settleBoot } from './boot';

let ctx: WebviewContext;

export function initMessageHandler(c: WebviewContext): void {
    ctx = c;
    window.addEventListener('message', function (e: MessageEvent) {
        handle(e.data as PostMessage);
    });
}

function handle(m: PostMessage): void {
    try {
        _handle(m);
    } catch (err) {
        // Don't let one failed message block the rest
        console.error('[Pi Agent] message handler error:', err, m.type);
    }
}

function _handle(m: PostMessage): void {
    const els = ctx.els;
    const S = ctx.S;
    switch (m.type) {
        case 'addUserMessage':
            // Typing before the transcript settled: this is content now
            settleBoot();
            addMessage('user', m.text || '', false, m.pending, m.images, m.attachments);
            break;

        case 'history':
            if (m.items) {
                renderHistory(m.items as HistoryItem[], m.hidden);
            } else if (m.messages && m.messages.length) {
                // Legacy text-only replay (pi builds without the get_entries RPC)
                settleBoot();
                els.welcome.style.display = 'none';
                m.messages.forEach(function (msg) { addMessage(msg.role, msg.text, false, undefined, msg.images, msg.attachments); });
                const div = document.createElement('div');
                div.className = 'history-divider';
                div.textContent = S.historyDivider;
                els.chat.appendChild(div);
                scrollToBottom(els.chat);
                void renderMermaid(els.chat);
            } else {
                settleBoot();
            }
            break;

        // A new thinking block is a tool-group boundary: close the previous group
        // first, otherwise later tools get appended to it (showing above the
        // thinking block, which looks like they were pushed away).
        case 'thinkingStart': endToolGroup(); showThinking(); break;
        case 'thinkingDelta': appendThinking(m.text || ''); break;
        case 'thinkingEnd': hideThinking(); break;
        case 'toolCall': addTool(m.tool || 'tool', m.detail, m.toolCallId, m.toolArgs); break;
        case 'toolUpdate': setToolOutput(m.toolCallId, m.output || ''); break;
        case 'toolEnd': endTool(m.toolCallId, m); break;
        case 'toolSettle': settleTools(); break;

        case 'assistantStart':
            endToolGroup();
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
            if (last) { editMessage(getMessageText(last.querySelector('.message-body') as HTMLElement | null)); }
            break;
        }
        case 'queue': updateQueueBadges(m.steering, m.followUp); break;
        case 'bashResult': if (m.id) { finishBash(m as unknown as { id: string; isError?: boolean; cancelled?: boolean; exitCode?: number; output?: string; truncated?: boolean }); } break;
        case 'turnChanges': renderTurnChanges((m.turnFiles as Array<{ path: string; status: 'created' | 'modified'; revertible: boolean }>) || []); break;
        case 'turnRevertResult': updateTurnChangesResult(
            (m.results as Array<{ path: string; result: 'reverted' | 'deleted' | 'failed' | 'skipped'; error?: string }>) || [],
            (m.turnFiles as Array<{ path: string; status: 'created' | 'modified'; revertible: boolean }>) || [],
            Boolean(m.canUndo),
            (m.autoHideMs as number) || 4500,
        ); break;
        case 'turnUndoResult': finishUndoRevert((m.text as string) || ''); break;

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
            // Flush the text received so far (endAssistantStream renders the whole
            // buffer) before showing the error, so nothing unrevealed is lost.
            endAssistantStream();
            renderErrorActions(
                addMessage('assistant', m.text || '', true),
                m.actions as Array<{ id: string; label: string }> | undefined,
            );
            break;

        case 'setBusy':
            setBusy(Boolean(m.busy));
            if (!m.busy) { endToolGroup(); }
            break;

        case 'focusSearch':
            els.searchBar.classList.add('visible');
            els.searchInput.focus();
            break;

        case 'showHelp': {
            const lines = [
                S.helpTitle,
                '',
                S.helpCompact,
                S.helpClear,
                S.helpNew,
                S.helpClone,
                S.helpModel,
                S.helpThinking,
                S.helpPermission,
                S.helpSessions,
                S.helpExport,
                S.helpSearch,
                S.helpHelp,
                '',
                S.helpSdk,
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

        case 'setup':
            renderSetup(m.setup);
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
            // `boot: false` means the host already knows the session is empty
            if (m.boot === false) { settleBoot(); } else { enterBoot(); }
            clearTranscript(els.chat);
            els.welcome.style.display = '';
            ctx.currentBody = null;
            ctx.currentBuffer = '';
            resetThinking();
            resetWorking();
            ctx.runningTools = {};
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
            resetToolGroup();
            break;

        default:
            break;
    }
}
