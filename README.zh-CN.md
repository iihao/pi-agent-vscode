# Pi Agent for VS Code

[![CI](https://github.com/iihao/pi-agent-vscode/actions/workflows/ci.yml/badge.svg)](https://github.com/iihao/pi-agent-vscode/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![VS Code](https://img.shields.io/badge/VS%20Code-1.80%2B-007ACC.svg)](https://code.visualstudio.com/)
[![Download VSIX](https://img.shields.io/badge/Download-VSIX-2ea44f?logo=visualstudiocode)](https://github.com/iihao/pi-agent-vscode/releases/latest)

[English](./README.md) · **简体中文**

一个把本地 [pi](https://github.com/earendil-works/pi) coding agent 放进 VS Code
侧边栏的扩展——类似 Claude Code / Codex 的对话界面，但完全跑在**你自己的
`pi`** 上：你的模型、你的凭证、你的会话。

> ⚠️ **Pi Agent 是前端。** 它会调用你本机安装的 `pi` CLI，后者可以**读写工作区
> 文件、执行 shell 命令**。扩展仅在**受信任工作区**激活。请自行评估风险。

---

## 安装

### 下载 VSIX

- **最新发布：** https://github.com/iihao/pi-agent-vscode/releases/latest
- **直接下载：** [`pi-agent-vscode.vsix`](https://github.com/iihao/pi-agent-vscode/releases/latest/download/pi-agent-vscode.vsix)

然后任选一种方式安装：

- VS Code：**扩展 → ⋯（更多操作）→ 从 VSIX 安装…**
- 命令行：
  ```bash
  code --install-extension pi-agent-vscode.vsix
  ```

> 后续会上架 Marketplace；在那之前请用上面的 VSIX。

### 前置要求

1. 安装 pi CLI：
   ```bash
   npm install -g @earendil-works/pi-coding-agent
   ```
2. 运行一次 `pi` 完成登录并选择模型。
3. 在 VS Code 中打开一个**受信任**文件夹，点击活动栏的 **Pi** 图标。

扩展**不保存任何 API Key**——它复用你已有的 `~/.pi` 配置（模型、会话、技能）。

---

## 架构

```
VS Code 扩展（本仓库）
    │  RpcClient（@earendil-works/pi-coding-agent）
    ▼
pi --mode rpc（本地 agent harness）
    │  工具：read / bash / edit / write
    ▼
你的项目文件
```

- 扩展是**前端**：聊天 UI、流式输出、工具活动展示。
- **pi 是引擎**：文件访问、命令执行、多步任务、模型与凭证全部来自你的 pi 配置。

### 目录结构

```
src/                  扩展宿主（TypeScript，tsc -> out/）
  extension.ts        激活、命令注册
  chatPanel.ts        Webview <-> pi 桥接、会话、事件
  sdk/                pi RPC 客户端生命周期、会话管理器、类型
  utils/              格式化、日志
  views/              webview HTML 外壳 + 本地化 UI 文案
webview/              webview 源码（main.js + styles.css）
media/                webview 构建产物（esbuild，gitignore）
l10n/                 运行时本地化 bundle（bundle.l10n.*.json）
package.nls.*.json    清单本地化
esbuild.webview.mjs   webview 构建脚本
```

---

## 功能

- 💬 **对话面板** — 流式输出、思考状态、工具活动实时展示。
- 📝 **Markdown** — 标题/列表/表格/链接；代码块带语法高亮、行号与「应用/复制」。
- 📐 **公式与图表** — KaTeX 数学公式、Mermaid 图表（按需懒加载）。
- 🔎 **工具结果** — 命令输出实时流式展示；编辑以彩色 diff 呈现。
- 🗂️ **会话管理** — 新建 / 切换 / 重命名；切换会恢复历史记录。
- 🎚️ **模型与思考档位** — 在输入框内选择。
- 🛡️ **权限模式** — 手动 / 自动 / 只读（`--exclude-tools bash,edit,write`）。
- 📎 **编辑器上下文** — 把当前文件或选区附加到 prompt。
- 📊 **上下文指示** — 顶栏显示上下文窗口占用。
- ✅ **确认弹窗** — pi 请求授权时弹原生对话框。
- 🔔 **完成通知** — 窗口失焦时任务完成弹通知。
- 🩺 **诊断导出** 与 `pi-agent.*` 设置命名空间。
- 🌐 **多语言** — 跟随 VS Code 显示语言（英文 / 简体中文）。

## 使用

| 操作 | 方式 |
|------|------|
| 打开对话 | `⌥⌘P`（macOS）/ `Ctrl+Alt+P`、状态栏 ✨Pi、或命令面板 "Pi: Open Chat" |
| 解释选中代码 | 选中代码 → 右键 → **Pi: Explain Code** |
| 重构选中代码 | 选中代码 → 右键 → **Pi: Refactor Code** |
| 生成代码 | 命令面板 → "Pi: Generate Code" |
| 附加文件 / 选区 | 输入框左侧 📎，或右键 → **Pi: Attach…** |
| 停止生成 | 生成中点击 **Stop** |
| 新建 / 切换 / 重命名会话 | 输入框上方的会话 pill |
| 重启会话 | 命令面板 → "Pi: Restart Session" |

## 设置（`pi-agent.*`）

| 设置 | 默认 | 说明 |
|------|------|------|
| `pi-agent.pi.executable` | *空* | 自定义 `pi` CLI 路径（留空自动探测） |
| `pi-agent.pi.arguments` | `[]` | 附加到 `pi` 的启动参数 |
| `pi-agent.agent.permissionMode` | `ask` | `ask` / `autoConfirm`（`--approve`）/ `restricted`（`--exclude-tools bash,edit,write`） |
| `pi-agent.notifications.enabled` | `true` | 窗口失焦时的完成通知 |
| `pi-agent.diagnostics.level` | `info` | 输出通道日志级别（`error`/`info`/`debug`） |

修改 `pi.executable` / `pi.arguments` / `agent.permissionMode` 会自动重启会话生效
（也可执行命令 **Pi: Restart Session**）。

## 开发

```bash
npm ci
npm run compile      # tsc（扩展宿主）+ esbuild（webview）
# 在 VS Code 中按 F5 启动扩展开发宿主

npm run watch          # tsc --watch
npm run watch:webview  # esbuild --watch
npm run lint
npm test               # vitest
```

详见 [CONTRIBUTING.md](./CONTRIBUTING.md) 与发版流程 [RELEASING.md](./RELEASING.md)。

## 贡献

- [CONTRIBUTING.md](./CONTRIBUTING.md)
- [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
- [SECURITY.md](./SECURITY.md) — 私密上报安全问题
- [CHANGELOG.md](./CHANGELOG.md)
- [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)

## 许可证

[MIT](./LICENSE) © Pi Agent contributors
