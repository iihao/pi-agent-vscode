<div align="center">
  <img src="https://raw.githubusercontent.com/iihao/pi-agent-vscode/main/docs/images/cover.png" alt="Pi Agent for VS Code — 本地 pi coding agent，就在侧边栏" width="100%">
</div>

# Pi Agent for VS Code

[![CI](https://github.com/iihao/pi-agent-vscode/actions/workflows/ci.yml/badge.svg)](https://github.com/iihao/pi-agent-vscode/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![VS Code](https://img.shields.io/badge/VS%20Code-1.80%2B-007ACC.svg)](https://code.visualstudio.com/)
[![Marketplace](https://img.shields.io/badge/VS%20Code%20Marketplace-Pi%20Agent-007ACC?logo=visualstudiocode)](https://marketplace.visualstudio.com/items?itemName=iihao.pi-agent-assistant)

[English](./README.md) · **简体中文**

为本地 [pi](https://github.com/earendil-works/pi) coding agent 打造的 VS Code
**侧边栏 + 编辑器标签**聊天界面 —— 类似 Claude Code / Codex 的体验，但完全跑在
**你自己的 `pi`** 上：你的模型、你的凭据、你的会话。

> ⚠️ **Pi Agent 只是前端。** 它会启动你本机安装的 `pi` CLI，而 `pi` 可以
> **读写工作区文件、执行 shell 命令**。仅在你的**受信任工作区**中激活，请自行判断风险。

---

## 安装

### 从插件市场安装

- 在 VS Code 中打开 **扩展**，搜索 **Pi Agent**，点击 **安装**。
- 或用命令行：
  ```bash
  code --install-extension iihao.pi-agent-assistant
  ```
- 市场页面：<https://marketplace.visualstudio.com/items?itemName=iihao.pi-agent-assistant>

### 从 VSIX 安装

- **最新发布：** <https://github.com/iihao/pi-agent-vscode/releases/latest>
- **直接下载：** [`pi-agent-vscode.vsix`](https://github.com/iihao/pi-agent-vscode/releases/latest/download/pi-agent-vscode.vsix)

然后任选一种方式安装：

- VS Code：**扩展 → ⋯（更多操作）→ 从 VSIX 安装…**
- 命令行：
  ```bash
  code --install-extension pi-agent-vscode.vsix
  ```

### 前置条件

1. 安装 pi CLI：
   ```bash
   npm install -g @earendil-works/pi-coding-agent
   ```
2. 先运行一次 `pi` 完成登录并选择模型。
3. 在 VS Code 中打开一个**受信任**的文件夹，然后点击活动栏的 **Pi** 图标
   （或运行 **Pi: 打开对话**）。

插件**不保存任何 API Key** —— 它复用你现有的 `~/.pi` 配置（模型、会话、技能、提示模板）。

---

## 亮点

- 💬 **流式对话**：思考过程、实时工具调用卡片。
- ⏯️ **排队 + 插入（steer）**：pi 工作时可继续输入 —— **Enter** 排队，**Ctrl/⌘+Enter** 立即插入当前回合。
- 🧰 **直接跑 shell**：输入框以 `!` 开头即可执行命令。
- 🎯 **免复制粘贴的上下文**：附加文件/选区（以 `@路径:12-30` 引用发送）、输入 `@` 提及文件、拖拽文件，或开启**自动上下文**（当前文件、选区、诊断、Git）。
- 🧭 **问题导航**：右侧刻度条 + `‹ 5/6 ▾ ›`，在本次会话的提问间快速跳转。
- 🗂️ **会话**：新建 / 切换 / 重命名 / **克隆**；未命名会话显示首条提问，新会话会**自动命名**。
- 🧩 **斜杠命令与技能**：输入 `/` 自动补全 pi 的命令、提示模板、技能。
- 🖼️ **粘贴图片**：粘贴截图发送给多模态模型。
- 🌿 **Git 集成**：生成提交信息（源代码管理标题栏按钮）或 PR 描述。
- ↩️ **改动审阅与撤销**：每个回合列出改动的文件，一键还原到回合前。
- 🗜️ **压缩上下文**：上下文将满时提示，一键 Compact。
- 🪟 **编辑器标签**：可在编辑器标签或分栏打开对话；所有界面共享同一会话。
- 📝 **富文本输出**：Markdown、带高亮和「应用/复制」的代码块、KaTeX 公式、按需加载的 Mermaid 图。
- 🛡️ **权限模式**：手动 / 自动 / 只读。
- 🌐 **多语言**：跟随 VS Code 显示语言。

## 命令与快捷键

| 操作 | 方式 |
|------|------|
| 打开对话 | `⌥⌘P` / `Ctrl+Alt+P`、状态栏 ✨Pi，或 **Pi: 打开对话** |
| 新建对话 | 侧边栏内 `⌘⇧N` / `Ctrl+Shift+N`，或 **Pi: 新建对话** |
| 在编辑器标签 / 分栏打开 | **Pi: 在编辑器标签打开对话** / **Pi: 在侧边打开对话** |
| 提问间跳转 | `Alt+↑` / `Alt+↓`，或 `‹ ›` 按钮与右侧刻度条 |
| 搜索消息 | 输入框内 `Ctrl+F` / `⌘F` |
| 解释 / 重构选中代码 | 选中代码 → 右键 → **Pi: 解释代码** / **Pi: 重构代码** |
| 生成代码 | **Pi: 生成代码** |
| 附加文件 / 选区 | 输入框的 📎，或右键 → **Pi: 附加…** |
| 切换模型 / 思考档位 | **Pi: 切换模型** / **Pi: 切换思考档位** |
| 压缩会话 | **Pi: 压缩会话上下文** |
| 生成提交信息 / PR 描述 | **Pi: 生成提交信息** / **Pi: 生成 PR 描述** |
| 撤销本回合改动 | **Pi: 撤销本回合改动** |
| 克隆会话 | **Pi: 克隆会话** |
| 重启会话 | **Pi: 重启会话** |
| 导出诊断信息 | **Pi: 导出诊断信息** |

## 设置（`pi-agent.*`）

| 设置 | 默认 | 说明 |
|------|------|------|
| `pi-agent.pi.executable` | *空* | 自定义 `pi` CLI 路径（留空则自动探测） |
| `pi-agent.pi.arguments` | `[]` | 附加到 `pi` 启动参数 |
| `pi-agent.agent.permissionMode` | `ask` | `ask` / `autoConfirm`（`--approve`）/ `restricted`（`--exclude-tools bash,edit,write`） |
| `pi-agent.context.autoAttach` | `false` | 每条消息自动附加当前文件/选区 |
| `pi-agent.context.includeDiagnostics` | `false` | 自动上下文中包含编辑器诊断 |
| `pi-agent.context.includeGit` | `false` | 自动上下文中包含 Git 分支/改动 |
| `pi-agent.sessions.autoName` | `true` | 根据首条消息自动命名新会话 |
| `pi-agent.notifications.enabled` | `true` | 窗口失焦时，任务完成弹出通知 |
| `pi-agent.diagnostics.level` | `info` | 输出通道日志级别（`error`/`info`/`debug`） |

修改 `pi.executable`、`pi.arguments` 或 `agent.permissionMode` 会自动重启会话
（也可手动运行 **Pi: 重启会话**）。

---

## 架构

```
VS Code 扩展（本仓库）
    │  RpcClient (@earendil-works/pi-coding-agent)
    ▼
pi --mode rpc  （本地 agent 引擎）
    │  tools: read / bash / edit / write
    ▼
你的项目文件
```

- 扩展是**前端**：聊天界面、流式输出、工具活动。
- **pi 是引擎**：文件读写、命令执行、多步任务、模型与凭据都来自你的 pi 配置。

## 开发

```bash
npm ci
npm run compile      # tsc（扩展宿主）+ esbuild（webview）
# 在 VS Code 中按 F5 启动「扩展开发宿主」

npm run watch          # tsc --watch
npm run watch:webview  # esbuild --watch
npm run lint
npm test               # vitest
```

详见 [CONTRIBUTING.md](./CONTRIBUTING.md) 与 [RELEASING.md](./RELEASING.md)。

## 链接

- [CHANGELOG.md](./CHANGELOG.md)
- [PRIVACY.md](./PRIVACY.md) —— 无遥测，数据不出本机
- [SECURITY.md](./SECURITY.md) —— 私下报告安全问题
- [CONTRIBUTING.md](./CONTRIBUTING.md) · [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
- [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)

## 许可证

[MIT](./LICENSE) © Pi Agent contributors
