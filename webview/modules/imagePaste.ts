// ---------------------------------------------------------------------------
// Image paste
// ---------------------------------------------------------------------------

import type { WebviewContext, PendingImage } from '../types';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
let ctx: WebviewContext;

export function initImagePaste(context: WebviewContext): void {
    ctx = context;
}

export function readImage(file: File): void {
    if (file.size > MAX_IMAGE_BYTES) {
        ctx.vscode.postMessage({ type: 'notify', text: ctx.S.imageTooLarge });
        return;
    }
    const reader = new FileReader();
    reader.onload = function () {
        const dataUrl = String(reader.result || '');
        const comma = dataUrl.indexOf(',');
        if (comma === -1) { return; }
        ctx.pendingImages.push({ mimeType: file.type || 'image/png', data: dataUrl.slice(comma + 1), dataUrl: dataUrl });
        renderImages();
    };
    reader.readAsDataURL(file);
}

export function renderImages(): void {
    if (!ctx.pendingImages.length) { ctx.els.imageRow.classList.add('hidden'); ctx.els.imageRow.innerHTML = ''; return; }
    ctx.els.imageRow.classList.remove('hidden');
    let html = '';
    ctx.pendingImages.forEach(function (img, i) {
        html += '<div class="image-thumb"><img src="' + img.dataUrl + '" alt=""><button data-i="' + i + '" title="' + ctx.S.remove + '">✕</button></div>';
    });
    ctx.els.imageRow.innerHTML = html;
}

export function getPendingImages(): PendingImage[] {
    return ctx.pendingImages;
}

export function clearPendingImages(): void {
    ctx.pendingImages = [];
    renderImages();
}

export function resetImageState(): void {
    ctx.pendingImages = [];
}
