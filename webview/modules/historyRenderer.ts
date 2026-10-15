// ---------------------------------------------------------------------------
// Transcript replay
//
// After a reconnect (the "Reload Session" button, a crash, a config change) or
// a session switch, the host clears the webview and replays the session log as
// a list of items. They are fed through exactly the same renderers the live
// event stream uses, so a restored transcript looks like the one that was
// streamed: same tool cards, same diffs, same collapsed thinking blocks.
// ---------------------------------------------------------------------------

import type { WebviewContext, HistoryItem } from '../types';
import { scrollToBottom } from '../utils';
import { renderMermaid } from '../markdown';
import { addMessage, addHistoryThinking, addNotice } from './messageRenderer';
import { addTool, endTool, endToolGroup, resetToolGroup } from './toolRenderer';

let ctx: WebviewContext;

export function initHistoryRenderer(c: WebviewContext): void {
    ctx = c;
}

export function renderHistory(items: HistoryItem[], hidden = 0): void {
    if (!items.length) { return; }
    ctx.els.welcome.style.display = 'none';
    resetToolGroup();
    // Anything dropped to keep the replay bounded is reported up front rather
    // than silently missing from the top of the transcript.
    if (hidden > 0) { addNotice(ctx.S.historyTrimmed.replace('{0}', String(hidden))); }
    for (const item of items) {
        switch (item.kind) {
            case 'user':
                endToolGroup();
                addMessage('user', item.text || '', false, undefined, item.images as never, item.attachments);
                break;
            case 'assistant':
                // Same boundary rule as the live stream: text ends the running tool group
                endToolGroup();
                addMessage('assistant', item.text || '');
                break;
            case 'thinking':
                endToolGroup();
                addHistoryThinking(item.text || '');
                break;
            case 'tool':
                addTool(item.tool || 'tool', item.detail, item.toolCallId, item.args);
                break;
            case 'toolResult':
                endTool(item.toolCallId, item);
                break;
            case 'compaction':
                endToolGroup();
                addCompactionMarker(item.text);
                break;
            case 'notice':
                endToolGroup();
                addNotice(item.text || '');
                break;
            default:
                break;
        }
    }
    endToolGroup();
    const divider = document.createElement('div');
    divider.className = 'history-divider';
    divider.textContent = ctx.S.historyDivider;
    ctx.els.chat.appendChild(divider);
    scrollToBottom(ctx.els.chat);
    void renderMermaid(ctx.els.chat);
}

/** A checkpoint pi's auto-compaction left in the transcript */
function addCompactionMarker(summary?: string): void {
    const wrap = document.createElement('div');
    wrap.className = 'compaction-marker collapsed';
    const head = document.createElement('div');
    head.className = 'compaction-marker-head';
    head.innerHTML = '<span class="chevron">▾</span>';
    const title = document.createElement('span');
    title.textContent = ctx.S.compactedHere;
    head.appendChild(title);
    wrap.appendChild(head);
    if (summary && summary.trim()) {
        const body = document.createElement('div');
        body.className = 'compaction-marker-summary';
        body.textContent = summary;
        wrap.appendChild(body);
        head.addEventListener('click', function () { wrap.classList.toggle('collapsed'); });
    } else {
        wrap.classList.remove('collapsed');
        head.classList.add('plain');
    }
    ctx.els.chat.appendChild(wrap);
    scrollToBottom(ctx.els.chat);
}
