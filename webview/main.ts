// ---------------------------------------------------------------------------
// Webview 入口 — 组装所有模块
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

const ctx = createContext();

// 初始化所有模块
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

// 初始渲染
scrollToBottom(ctx.els.chat);
ctx.els.input.focus();
ctx.vscode.postMessage({ type: 'ready' });
