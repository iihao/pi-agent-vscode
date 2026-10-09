# Pi Assistant - VSCode 插件

基于本地 [pi](https://pi.dev) agent 的 VSCode 编程助手——类似 Claude Code 插件，但由 pi 驱动。

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

## 前置要求

1. 安装 pi CLI：

   ```bash
   npm install -g @earendil-works/pi-coding-agent
   ```

2. 在终端里运行 `pi` 完成登录/模型配置（`/login` 或已有配置即可）

## 安装插件（开发模式）

```bash
npm install
npm run compile
# 在 VSCode 中按 F5 启动扩展开发宿主
```

## 使用

| 操作 | 方式 |
|------|------|
| 打开对话面板 | `⌘⇧I` / 状态栏 ✨Pi / 命令面板 "Pi: 打开对话" |
| 解释选中代码 | 选中代码 → 右键 "Pi: 解释代码" |
| 重构选中代码 | 选中代码 → 右键 "Pi: 重构代码" |
| 生成代码 | 命令面板 "Pi: 生成代码" |
| 停止生成 | 生成中点击「停止」按钮 |
| 清空对话 | 命令面板 "Pi: 清空对话" |

## 功能

- 💬 **对话面板** - 流式输出、思考状态、工具活动实时展示
- 🔧 **完整 agent 能力** - pi 可以直接读写文件、运行命令完成任务
- 📖 **右键快捷操作** - 解释/重构选中代码（自动携带文件与行号上下文）
- ⏹️ **中止支持** - 生成中可随时停止
- 🔐 **零配置凭证** - 复用 pi 的模型与登录状态

## 打包发布

```bash
npm install -g @vscode/vsce
vsce package
code --install-extension pi-assistant-0.1.0.vsix
```

## 许可证

MIT
