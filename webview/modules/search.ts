// ---------------------------------------------------------------------------
// Message search
// ---------------------------------------------------------------------------

import type { WebviewContext, MessageInfo } from '../types';
import { getMessageText } from '../utils';

let ctx: WebviewContext;

export function initSearch(c: WebviewContext): void {
    ctx = c;
}

export function getAllMessages(): MessageInfo[] {
    const messages: MessageInfo[] = [];
    ctx.els.chat.querySelectorAll('.message').forEach(function (el) {
        const node = el as HTMLElement;
        const role = node.classList.contains('user') ? 'user' : 'assistant';
        const body = node.querySelector('.message-body') as HTMLElement | null;
        messages.push({ role: role, text: getMessageText(body), element: node });
    });
    return messages;
}

/**
 * Lowercased message text for matching, cached per rendered body.
 *
 * Extracting text means cloning the message into the document and reading
 * innerText — a forced layout for every message, on every keystroke, when a
 * long transcript turned typing into a slideshow. A finished message renders
 * once and never changes, so the entry lives as long as the node (WeakMap
 * drops it with the DOM); only the still-growing live bubble is re-extracted.
 */
const searchTextCache = new WeakMap<HTMLElement, string>();

export function messageSearchText(el: HTMLElement): string {
    const body = el.querySelector('.message-body') as HTMLElement | null;
    if (!body) { return ''; }
    if (body.classList.contains('stream-cursor')) { return getMessageText(body).toLowerCase(); }
    let text = searchTextCache.get(body);
    if (text === undefined) {
        text = getMessageText(body).toLowerCase();
        searchTextCache.set(body, text);
    }
    return text;
}

export function searchMessages(query: string): void {
    if (!query) { clearSearch(); return; }
    ctx.searchQuery = query.toLowerCase();
    const matches: MessageInfo[] = [];
    ctx.els.chat.querySelectorAll('.message').forEach(function (el) {
        const node = el as HTMLElement;
        const text = messageSearchText(node);
        if (text.indexOf(ctx.searchQuery) !== -1) {
            matches.push({
                role: node.classList.contains('user') ? 'user' : 'assistant',
                text: text,
                element: node,
            });
        }
    });
    ctx.searchMatches = matches;
    ctx.searchIndex = 0;
    updateSearchUI();
    highlightMatches();
}

export function updateSearchUI(): void {
    if (ctx.searchMatches.length === 0) {
        ctx.els.searchResults.textContent = ctx.S.noResults;
    } else {
        ctx.els.searchResults.textContent = (ctx.searchIndex + 1) + ' / ' + ctx.searchMatches.length;
    }
}

export function highlightMatches(): void {
    clearHighlights();
    if (ctx.searchMatches.length > 0 && ctx.searchIndex < ctx.searchMatches.length) {
        const match = ctx.searchMatches[ctx.searchIndex];
        match.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        match.element.style.backgroundColor = 'var(--vscode-findMatchHighlightBackground, rgba(255,255,0,.2))';
        setTimeout(function () {
            match.element.style.backgroundColor = '';
        }, 3000);
    }
}

export function clearHighlights(): void {
    ctx.els.chat.querySelectorAll('.message').forEach(function (el) {
        (el as HTMLElement).style.backgroundColor = '';
    });
}

export function clearSearch(): void {
    ctx.searchQuery = '';
    ctx.searchMatches = [];
    ctx.searchIndex = 0;
    ctx.els.searchResults.textContent = '';
    clearHighlights();
}

export function goToMatch(direction: number): void {
    if (ctx.searchMatches.length === 0) { return; }
    ctx.searchIndex += direction;
    if (ctx.searchIndex < 0) { ctx.searchIndex = ctx.searchMatches.length - 1; }
    if (ctx.searchIndex >= ctx.searchMatches.length) { ctx.searchIndex = 0; }
    updateSearchUI();
    highlightMatches();
}

export function openSearchBar(): void {
    ctx.els.searchBar.classList.add('visible');
    ctx.els.searchInput.focus();
}

export function closeSearchBar(): void {
    ctx.els.searchBar.classList.remove('visible');
    clearSearch();
}
