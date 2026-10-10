# Pi Agent for VS Code

[![CI](https://github.com/iihao/pi-agent-vscode/actions/workflows/ci.yml/badge.svg)](https://github.com/iihao/pi-agent-vscode/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![VS Code](https://img.shields.io/badge/VS%20Code-1.80%2B-007ACC.svg)](https://code.visualstudio.com/)
[![Download VSIX](https://img.shields.io/badge/Download-VSIX-2ea44f?logo=visualstudiocode)](https://github.com/iihao/pi-agent-vscode/releases/latest)

**English** · [简体中文](./README.zh-CN.md)

A VS Code sidebar for the local [pi](https://github.com/earendil-works/pi) coding
agent — a Claude Code / Codex-style chat UI that runs entirely on **your own
`pi`**: your models, your credentials, your sessions.

> ⚠️ **Pi Agent is a front-end.** It launches the `pi` CLI installed on your
> machine, which can **read/write workspace files and run shell commands**. It
> activates **only in trusted workspaces**. Use at your own discretion.

---

## Install

### Download the VSIX

- **Latest release:** https://github.com/iihao/pi-agent-vscode/releases/latest
- **Direct download:** [`pi-agent-vscode.vsix`](https://github.com/iihao/pi-agent-vscode/releases/latest/download/pi-agent-vscode.vsix)

Then install it either way:

- VS Code: **Extensions → ⋯ (More Actions) → Install from VSIX…**
- CLI:
  ```bash
  code --install-extension pi-agent-vscode.vsix
  ```

> Marketplace publishing is planned. Until then, use the VSIX above.

### Prerequisites

1. Install the pi CLI:
   ```bash
   npm install -g @earendil-works/pi-coding-agent
   ```
2. Run `pi` once to log in and pick a model.
3. Open a **trusted** folder in VS Code, then click the **Pi** icon in the
   Activity Bar.

The extension stores **no API keys** — it reuses your existing `~/.pi`
configuration (models, sessions, skills).

---

## Architecture

```
VS Code extension (this repo)
    │  RpcClient (@earendil-works/pi-coding-agent)
    ▼
pi --mode rpc  (local agent harness)
    │  tools: read / bash / edit / write
    ▼
your project files
```

- The extension is the **front-end**: chat UI, streaming output, tool activity.
- **pi is the engine**: file access, commands, multi-step tasks, models and
  credentials all come from your pi setup.

### Project layout

```
src/                  Extension host (TypeScript, tsc -> out/)
  extension.ts        Activation, commands
  chatPanel.ts        Webview <-> pi bridge, sessions, events
  sdk/                pi RPC client lifecycle, session manager, types
  utils/              formatters, logger
  views/              webview HTML shell + localized UI strings
webview/              Webview source (main.js + styles.css)
media/                Webview build output (esbuild, gitignored)
l10n/                 Runtime localization bundles (bundle.l10n.*.json)
package.nls.*.json    Manifest localization
esbuild.webview.mjs   Webview build script
```

---

## Features

- 💬 **Chat panel** — streaming output, thinking display, live tool activity.
- 📝 **Markdown** — headings, lists, tables, links; code blocks with syntax
  highlighting, line numbers, and Apply / Copy.
- 📐 **Math & diagrams** — KaTeX formulas and Mermaid diagrams (lazy-loaded).
- 🔎 **Tool results** — command output streams in; edits render as colored diffs.
- 🗂️ **Sessions** — new / switch / rename; switching restores history.
- 🎚️ **Model & thinking level** — pick both from the composer.
- 🛡️ **Permission modes** — Manual / Auto / Read-only (`--exclude-tools bash,edit,write`).
- 📎 **Editor context** — attach the current file or selection to your prompt.
- 📊 **Context indicator** — context-window usage in the header.
- ✅ **Confirmations** — native dialogs when pi asks for approval.
- 🔔 **Notifications** — completion notice when the window is unfocused.
- 🩺 **Diagnostics export** and a `pi-agent.*` settings namespace.
- 🌐 **Localized** — English / Simplified Chinese, following the VS Code display
  language.

## Usage

| Action | How |
|--------|-----|
| Open chat | `⌥⌘P` (macOS) / `Ctrl+Alt+P`, status bar ✨Pi, or Command Palette → "Pi: Open Chat" |
| Explain selection | Select code → right-click → **Pi: Explain Code** |
| Refactor selection | Select code → right-click → **Pi: Refactor Code** |
| Generate code | Command Palette → "Pi: Generate Code" |
| Attach file / selection | 📎 in the composer, or right-click → **Pi: Attach…** |
| Stop generation | Click **Stop** while streaming |
| New / switch / rename session | Session pill above the composer |
| Restart session | Command Palette → "Pi: Restart Session" |

## Settings (`pi-agent.*`)

| Setting | Default | Description |
|---------|---------|-------------|
| `pi-agent.pi.executable` | *(empty)* | Custom `pi` CLI path (auto-detected when empty) |
| `pi-agent.pi.arguments` | `[]` | Extra arguments passed to `pi` |
| `pi-agent.agent.permissionMode` | `ask` | `ask` / `autoConfirm` (`--approve`) / `restricted` (`--exclude-tools bash,edit,write`) |
| `pi-agent.notifications.enabled` | `true` | Notify on completion while the window is unfocused |
| `pi-agent.diagnostics.level` | `info` | Output-channel log level (`error`/`info`/`debug`) |

Changing `pi.executable`, `pi.arguments` or `agent.permissionMode` restarts the
session automatically (or run **Pi: Restart Session**).

## Development

```bash
npm ci
npm run compile      # tsc (extension host) + esbuild (webview)
# press F5 in VS Code to launch the Extension Development Host

npm run watch          # tsc --watch
npm run watch:webview  # esbuild --watch
npm run lint
npm test               # vitest
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for details, and
[RELEASING.md](./RELEASING.md) for the release process.

## Contributing

- [CONTRIBUTING.md](./CONTRIBUTING.md)
- [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
- [SECURITY.md](./SECURITY.md) — report vulnerabilities privately
- [CHANGELOG.md](./CHANGELOG.md)
- [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)

## License

[MIT](./LICENSE) © Pi Agent contributors
