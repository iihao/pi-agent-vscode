# Pi Assistant - VSCode AI 编程助手

在 VSCode 中直接使用 Claude AI 进行代码对话、解释、生成和重构。

## 功能

- 💬 **对话面板** - 侧边栏聊天窗口，直接与 Claude 对话
- 📖 **解释代码** - 选中代码后右键解释
- 🔧 **重构代码** - 选中代码后右键重构
- ✨ **生成代码** - 根据描述生成代码
- 📋 **代码操作** - 一键插入或复制 AI 生成的代码
- 🔐 **API Key 配置** - 直接配置 Anthropic API Key

## 安装

### 开发模式

1. 克隆项目
2. `npm install`
3. 按 `F5` 启动调试

### 打包安装

```bash
npm install -g @vscode/vsce
vsce package
code --install-extension pi-assistant-0.1.0.vsix
```

## 配置

首次使用时，插件会提示输入 Anthropic API Key。

也可以在 VSCode 设置中手动配置：

```json
{
  "pi-assistant.apiKey": "sk-ant-...",
  "pi-assistant.model": "claude-sonnet-4-20250514",
  "pi-assistant.maxTokens": 4096,
  "pi-assistant.temperature": 0.7
}
```

### 可用模型

| 模型 | 说明 |
|------|------|
| `claude-sonnet-4-20250514` | Claude 4 Sonnet（推荐） |
| `claude-opus-4-20250514` | Claude 4 Opus（最强） |
| `claude-3-5-sonnet-20241022` | Claude 3.5 Sonnet |
| `claude-3-haiku-20240307` | Claude 3 Haiku（最快） |

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Cmd+Shift+P` / `Ctrl+Shift+P` | 打开对话面板 |

## 使用

1. **打开对话** - 点击状态栏的 🤖 Pi 图标或按快捷键
2. **解释代码** - 选中代码 → 右键 → "Pi: 解释代码"
3. **重构代码** - 选中代码 → 右键 → "Pi: 重构代码"
4. **生成代码** - 命令面板 → "Pi: 生成代码"
5. **设置 API Key** - 命令面板 → "Pi: 设置 API Key"

## 获取 API Key

1. 访问 [Anthropic Console](https://console.anthropic.com/)
2. 注册/登录账号
3. 获取 API Key（格式：`sk-ant-...`）

## 许可证

MIT
