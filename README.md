# Pi Assistant - VSCode 插件

[![CI](https://github.com/your-github-username/pi-assistant/actions/workflows/ci.yml/badge.svg)](https://github.com/your-github-username/pi-assistant/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![VS Code](https://img.shields.io/badge/VS%20Code-1.80%2B-007ACC.svg)](https://code.visualstudio.com/)

基于本地 [pi](https://pi.dev) agent 的 VSCode 编程助手——类似 Claude Code 插件，但由 pi 驱动。

> ⚠️ 本扩展是 **前端**，会调用你本机安装的 `pi` CLI，后者可以**读写工作区文件、执行 shell 命令**。仅在**受信任工作区**启用，请自行评估风险。

## 架构

```
VSCode 插件（本仓库）
    │  RpcClient（@earendil-works/pi-coding-agent 官方 SDK）
    ▼
pi --mode rpc（本地 agent harness）
    │  工具：read / bash / edit / write
    ▼
你的项目文件
```

- 插件是**前端**：聊天 UI、流式输出、工具活动展示
- **pi 是引擎**：读写文件、运行命令、多步任务、模型与凭证全部复用 pi 的配置
- 不需要在插件里配置 API Key——用你在 pi 里已配置的模型

### 目录结构

```
src/                 扩展宿主（TypeScript，tsc -> out/）
webview/             webview 源码（main.js + styles.css）
media/               webview 构建产物（esbuild，gitignore）
  main.js / main.css   主包
  chunks/*             按需懒加载（mermaid 等）
  assets/*             katex 字体（仅 woff2）
esbuild.webview.mjs  webview 构建脚本（ESM + 代码分割）
```

- webview 用 **esbuild** 打包，通过 `webview.asWebviewUri` 引用，不再内联进模板字符串
- Markdown 由 **markdown-it** 渲染，代码高亮由 **highlight.js** 提供（两者都打包进 `media/main.js`）

## 前置要求

1. 安装 pi CLI：

   ```bash
   npm install -g @earendil-works/pi-coding-agent
   ```

2. 在终端里运行 `pi` 完成登录/模型配置（`/login` 或已有配置即可）

## 安装插件（开发模式）

```bash
npm install
npm run compile   # tsc 编译扩展宿主 + esbuild 打包 webview -> media/
# 在 VSCode 中按 F5 启动扩展开发宿主
```

开发时可用两个监听：

```bash
npm run watch          # tsc --watch（扩展宿主）
npm run watch:webview  # esbuild --watch（webview）
```

## 使用

| 操作 | 方式 |
|------|------|
| 打开对话面板 | `⌥⌘P`（macOS）/ `Ctrl+Alt+P` / 状态栏 ✨Pi / 命令面板 "Pi: 打开对话" |
| 解释选中代码 | 选中代码 → 右键 "Pi: 解释代码" |
| 重构选中代码 | 选中代码 → 右键 "Pi: 重构代码" |
| 附加文件/选区 | 输入框左侧 📎 / 右键 "Pi: 附加…" |
| 生成代码 | 命令面板 "Pi: 生成代码" |
| 停止生成 | 生成中点击「停止」按钮 |
| 清空对话 | 命令面板 "Pi: 清空对话" |

## 功能

- 💬 **对话面板** - 流式输出、思考状态、工具活动实时展示
- 📝 **Markdown 渲染** - 标题/列表/表格/链接，代码块带语法高亮、行号与「应用/复制」
- 📐 **公式与图表** - KaTeX 数学公式；Mermaid 流程图/时序图等（按需懒加载）
- 🔎 **工具结果** - 命令输出实时流式展示；编辑改动以 diff（+/−）高亮
- 🗂️ **会话管理** - 会话列表：新建 / 切换 / 重命名（按工作区，切换会恢复历史记录）
- 📎 **编辑器上下文** - 一键附加当前文件 / 选中代码为 chip，随下一条消息发送
- 🎚️ **模型 / 思考档位** - 输入框内 pill 选择模型与思考级别（off…max）
- 🛡️ **权限模式** - 输入框内 pill 切换：手动 / 自动 / 只读（禁用 bash·edit·write）
- ✅ **确认弹窗** - pi（或扩展）发起确认/选择/输入时弹原生对话框；自动模式自动确认
- 📊 **上下文指示** - 顶栏显示上下文占用 %（>90% 变红），悬停看累计 ↑↓R/W 与窗口大小
- 🔔 **完成通知** - 窗口失焦时任务完成弹通知
- 🩺 **诊断导出** - 一键导出日志与环境信息
- 🔧 **完整 agent 能力** - pi 可以直接读写文件、运行命令完成任务
- 📖 **右键快捷操作** - 解释/重构选中代码（自动携带文件与行号上下文）
- ⏹️ **中止支持** - 生成中可随时停止
- 🔐 **零配置凭证** - 复用 pi 的模型与登录状态

## 设置（`pi-assistant.*`）

| 设置 | 默认 | 说明 |
|------|------|------|
| `pi-assistant.pi.executable` | 空 | 自定义 pi CLI 路径（留空自动探测） |
| `pi-assistant.pi.arguments` | `[]` | 附加到 pi 的启动参数 |
| `pi-assistant.agent.permissionMode` | `ask` | `ask` / `autoConfirm`（`--approve`）/ `restricted`（`--exclude-tools bash,edit,write`） |
| `pi-assistant.notifications.enabled` | `true` | 窗口失焦时的完成通知 |
| `pi-assistant.diagnostics.level` | `info` | 输出通道日志级别（`error`/`info`/`debug`） |

`agent.permissionMode` 也可在输入框左侧的锁图标 pill 里直接切换（切换会自动重启会话）。
修改 `pi.executable` / `pi.arguments` 后会自动重启会话生效；也可手动执行命令 **Pi: 重启会话**。

> 说明：pi 的内置工具（bash/edit/write）默认自主执行，不像 Claude Code 逐条询问。`手动`= 正常；`自动`= `--approve` 并自动确认 pi 发起的确认；`只读`= 禁用写/命令工具。

扩展仅在**受信任工作区**激活（Pi 会读写文件、执行命令）。

## 多语言

界面文案跟随 VS Code 的显示语言（`vscode.env.language`），目前提供 **简体中文** 与 **英文**：

- 清单（命令/视图/设置）：`package.nls.json`（英文）/ `package.nls.zh-cn.json`（中文）
- 扩展宿主提示：`l10n/bundle.l10n.json` / `l10n/bundle.l10n.zh-cn.json`
- Webview UI：由宿主用 `vscode.l10n` 本地化后注入

新增语言只需加 `package.nls.<locale>.json` 与 `l10n/bundle.l10n.<locale>.json`。

## 打包发布

```bash
npm install -g @vscode/vsce
vsce package
code --install-extension pi-assistant-0.1.0.vsix
```

## 贡献

- 开发/构建/测试说明见 [CONTRIBUTING.md](./CONTRIBUTING.md)
- 安全问题的私密上报方式见 [SECURITY.md](./SECURITY.md)
- 社区行为准则见 [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
- 变更记录见 [CHANGELOG.md](./CHANGELOG.md)
- 第三方依赖许可见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)

## 许可证

[MIT](./LICENSE) © Pi Assistant contributors

> 本项目为独立实现，未复制任何 AGPL 项目代码。注意：[yesho/pi-coding-agent-vscode](https://github.com/YeSho-cpp/pi-coding-agent) 等同类插件为 **AGPL-3.0**，请勿从其复制代码。
