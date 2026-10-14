// ---------------------------------------------------------------------------
// Question navigation: right-edge rail + outline panel
// ---------------------------------------------------------------------------

import type { WebviewContext } from '../types';
import { escapeHtml, getMessageText } from '../utils';

let ctx: WebviewContext;

export function initNavigator(c: WebviewContext): void {
    ctx = c;
}

export function getUserMessageEls(): HTMLElement[] {
    return Array.prototype.slice.call(ctx.els.chat.querySelectorAll('.message.user'));
}

export function messagePreview(el: HTMLElement): string {
    if (el.dataset.preview !== undefined) { return el.dataset.preview; }
    const body = el.querySelector('.message-body') as HTMLElement | null;
    const p = (getMessageText(body) || '').replace(/\s+/g, ' ').trim();
    el.dataset.preview = p;
    return p;
}

export function renderRail(): void {
    const els = ctx.els;
    const users = getUserMessageEls();
    if (users.length === ctx.railCount) { return; }
    ctx.railCount = users.length;
    const show = users.length >= 2;
    els.msgNav.classList.toggle('hidden', !show);
    if (!show) { els.msgRail.classList.add('hidden'); els.msgRail.innerHTML = ''; return; }
    els.msgRail.classList.remove('hidden');
    let html = '';
    users.forEach(function (el, i) {
        const preview = escapeHtml(messagePreview(el).slice(0, 140));
        html += '<button class="rail-dot" data-i="' + i + '" title="' + preview + '" aria-label="' + preview + '"></button>';
    });
    els.msgRail.innerHTML = html;
    updateRailActive();
}

export function currentActiveIndex(): number {
    const els = ctx.els;
    const users = getUserMessageEls();
    if (!users.length) { return -1; }
    const anchor = els.chat.getBoundingClientRect().top + 40;
    let active = 0;
    for (let i = 0; i < users.length; i++) {
        if (users[i].getBoundingClientRect().top <= anchor) { active = i; }
        else { break; }
    }
    return active;
}

export function updateRailActive(): void {
    const els = ctx.els;
    const active = currentActiveIndex();
    els.msgRail.querySelectorAll('.rail-dot').forEach(function (d, i) {
        d.classList.toggle('active', i === active);
    });
    const users = getUserMessageEls();
    els.qPrev.disabled = active <= 0;
    els.qNext.disabled = active < 0 || active >= users.length - 1;
    if (users.length) {
        const idx = Math.max(0, active);
        els.qCount.textContent = (idx + 1) + '/' + users.length;
        const preview = messagePreview(users[idx]).trim();
        els.qCurrent.textContent = preview;
        els.qCounter.title = preview || ctx.S.outlineTitle;
    }
}

export function jumpToUserMessage(i: number): void {
    const users = getUserMessageEls();
    if (i < 0 || i >= users.length) { return; }
    const el = users[i];
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.classList.add('flash');
    setTimeout(function () { el.classList.remove('flash'); }, 1200);
}

export function navigateUserMessage(dir: number): void {
    const users = getUserMessageEls();
    if (!users.length) { return; }
    const cur = currentActiveIndex();
    const next = Math.min(users.length - 1, Math.max(0, cur + dir));
    if (next !== cur) { jumpToUserMessage(next); }
}

export function renderOutline(): void {
    const els = ctx.els;
    const users = getUserMessageEls();
    if (!users.length) {
        els.outlinePanel.innerHTML = '<div class="popover-empty">' + ctx.S.noMessages + '</div>';
        return;
    }
    const active = currentActiveIndex();
    let html = '';
    users.forEach(function (el, i) {
        const p = escapeHtml(messagePreview(el).slice(0, 200));
        html += '<button class="popover-item outline-item' + (i === active ? ' active' : '') + '" data-i="' + i + '">' +
            '<span class="outline-index">' + (i + 1) + '</span>' +
            '<span class="outline-text">' + p + '</span></button>';
    });
    els.outlinePanel.innerHTML = html;
}
