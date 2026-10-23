// ---------------------------------------------------------------------------
// Webview entry — assembles all modules
// ---------------------------------------------------------------------------

import './styles.css';
import { createContext } from './context';
import { scrollToBottom } from './utils';
import { initMessageRenderer } from './modules/messageRenderer';
import { initToolRenderer } from './modules/toolRenderer';
import { initPanels } from './modules/panels';
import { initNavigator } from './modules/navigator';
import { initQueue } from './modules/queue';
import { initSearch } from './modules/search';
import { initSlashCommands } from './modules/slashCommands';
import { initExporter } from './modules/exporter';
import { initImagePaste } from './modules/imagePaste';
import { initInputHandling } from './modules/inputHandling';
import { initEventBindings } from './modules/eventBindings';
import { initMessageHandler } from './modules/messageHandler';
import { initContextUsage } from './modules/contextUsage';
import { initHistoryRenderer } from './modules/historyRenderer';
import { initCopyShortcut, bindCopyShortcut } from './modules/copyShortcut';

const ctx = createContext();

// Initialize all modules
initPanels(ctx);
initNavigator(ctx);
initImagePaste(ctx);
initQueue(ctx);
initSearch(ctx);
initToolRenderer(ctx);
initMessageRenderer(ctx);
initSlashCommands(ctx);
initExporter(ctx);
initInputHandling(ctx);
initEventBindings(ctx);
initMessageHandler(ctx);
initContextUsage(ctx);
initHistoryRenderer(ctx);
initCopyShortcut(ctx);
bindCopyShortcut();

// Initial render
scrollToBottom(ctx.els.chat);
ctx.els.input.focus();
ctx.vscode.postMessage({ type: 'ready' });
