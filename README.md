<div align="center">
  <img src="https://raw.githubusercontent.com/iihao/pi-agent-vscode/main/docs/images/cover.png" alt="Pi Agent for VS Code — your local pi coding agent in the sidebar" width="100%">
</div>

# Pi Agent for VS Code

[![CI](https://github.com/iihao/pi-agent-vscode/actions/workflows/ci.yml/badge.svg)](https://github.com/iihao/pi-agent-vscode/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![VS Code](https://img.shields.io/badge/VS%20Code-1.80%2B-007ACC.svg)](https://code.visualstudio.com/)
[![Marketplace](https://img.shields.io/badge/VS%20Code%20Marketplace-Pi%20Agent-007ACC?logo=visualstudiocode)](https://marketplace.visualstudio.com/items?itemName=iihao.pi-agent-assistant)

**English** · [简体中文](./README.zh-CN.md)

A VS Code sidebar **and editor tab** for the local [pi](https://github.com/earendil-works/pi)
coding agent — a Claude Code / Codex-style chat UI that runs entirely on
**your own `pi`**: your models, your credentials, your sessions.

> ⚠️ **Pi Agent is a front-end.** It launches the `pi` CLI installed on your
> machine, which can **read/write workspace files and run shell commands**. It
> activates **only in trusted workspaces**. Use at your own discretion.

<div align="center">
  <img src="https://raw.githubusercontent.com/iihao/pi-agent-vscode/main/docs/images/pi-vscode-main.png" alt="Pi Agent in VS Code: the sidebar chat and the editor-tab panel side by side, with streaming answers, code blocks, and the composer with model / thinking / permission controls" width="100%">
</div>

---

## Install

### From the Marketplace

- In VS Code: open **Extensions**, search **Pi Agent**, and click **Install**.
- Or from a terminal:
  ```bash
  code --install-extension iihao.pi-agent-assistant
  ```
- Listing: <https://marketplace.visualstudio.com/items?itemName=iihao.pi-agent-assistant>

### From a VSIX

- **Latest release:** <https://github.com/iihao/pi-agent-vscode/releases/latest>
- **Direct download:** [`pi-agent-vscode.vsix`](https://github.com/iihao/pi-agent-vscode/releases/latest/download/pi-agent-vscode.vsix)

Then install it either way:

- VS Code: **Extensions → ⋯ (More Actions) → Install from VSIX…**
- CLI:
  ```bash
  code --install-extension pi-agent-vscode.vsix
  ```

### Prerequisites

1. Install the pi CLI:
   ```bash
   npm install -g @earendil-works/pi-coding-agent
   ```
2. Connect a model provider. The easiest way is from inside VS Code: open the
   **Pi** view (next step), then press **Connect** on the first-run checklist to
   add an API key (Anthropic, OpenAI, DeepSeek, OpenRouter, …), point pi at a
   custom OpenAI-compatible endpoint (third-party gateway, self-hosted,
   Ollama/LM Studio), or sign in with OAuth in a terminal. Running `pi` once
   yourself works too.
3. Open a **trusted** folder in VS Code, then click the **Pi** icon in the
   Activity Bar (or run **Pi: Open Chat**).

The extension keeps **no credentials of its own** — it reuses your existing
`~/.pi` configuration (models, sessions, skills, prompts) and, only when you ask
it to, writes to pi's own credential files (`auth.json` / `models.json`).

---

## Highlights

- 💬 **Streaming chat** with thinking display and live tool activity cards.
- ⏯️ **Queue & steer** — keep typing while pi works: **Enter** queues a
  follow-up, **Ctrl/⌘+Enter** steers the running turn.
- 🧰 **Run shell commands** straight from the composer with a leading `!`.
- 🎯 **Context without copy-paste** — attach files/selections (sent as
  `@path:12-30` references), type `@` to mention a file, drop files in, or turn
  on **automatic context** (open file, selection, diagnostics, Git).
- 🧭 **Question navigator** — a right-edge rail plus `‹ 5/6 ▾ ›` to jump between
  your questions in the current session.
- 🗂️ **Sessions** — new / switch / rename / **clone**; unnamed sessions show
  their first question, and new ones are **auto-named**.
- 🧩 **Slash commands & skills** — type `/` to autocomplete pi's commands,
  prompt templates, and skills.
- 🖼️ **Image paste** — paste a screenshot to send it to vision models.
- 🌿 **Git integration** — generate a commit message (Source Control title
  button) or a pull request description from the current changes.
- ↩️ **Review & revert** — each turn lists the files it changed; revert them to
  their pre-turn state in one click.
- 🗜️ **Compact** — summarize the context when the window fills up (with a
  one-click prompt near the limit).
- 🪟 **Editor tabs** — open the chat in an editor tab or beside your code; every
  surface shares the same session.
- 📝 **Rich output** — Markdown, syntax-highlighted code with Apply / Copy,
  KaTeX math, and lazy-loaded Mermaid diagrams.
- 🛡️ **Permission modes** — Manual / Auto / Read-only.
- 🌐 **Localized** — follows the VS Code display language.

## Commands & shortcuts

| Action | How |
|--------|-----|
| Open chat | `⌥⌘P` / `Ctrl+Alt+P`, status bar ✨Pi, or **Pi: Open Chat** |
| New chat | `⌘⇧N` / `Ctrl+Shift+N` in the sidebar, or **Pi: New Chat** |
| Open in editor tab / beside | **Pi: Open Chat in Editor Tab** / **Pi: Open Chat Beside** |
| Jump between questions | `Alt+↑` / `Alt+↓`, or the `‹ ›` buttons and rail |
| Search messages | `Ctrl+F` / `⌘F` in the composer |
| Explain / refactor selection | Select code → right-click → **Pi: Explain Code** / **Pi: Refactor Code** |
| Generate code | **Pi: Generate Code** |
| Attach file / selection | 📎 in the composer, or right-click → **Pi: Attach…** |
| Cycle model / thinking level | **Pi: Cycle Model** / **Pi: Cycle Thinking Level** |
| Compact session | **Pi: Compact Session** |
| Generate commit message / PR | **Pi: Generate Commit Message** / **Pi: Generate Pull Request Description** |
| Revert last turn's changes | **Pi: Revert Changes From Last Turn** |
| Clone session | **Pi: Clone Session** |
| Restart session | **Pi: Restart Session** |
| Export diagnostics | **Pi: Export Diagnostics** |

## Settings (`pi-agent.*`)

| Setting | Default | Description |
|---------|---------|-------------|
| `pi-agent.pi.executable` | *(empty)* | Custom `pi` CLI path (auto-detected when empty) |
| `pi-agent.pi.arguments` | `[]` | Extra arguments passed to `pi` |
| `pi-agent.agent.permissionMode` | `ask` | `ask` / `autoConfirm` (`--approve`) / `restricted` (`--exclude-tools bash,edit,write`) |
| `pi-agent.context.autoAttach` | `false` | Attach the open file/selection to every message |
| `pi-agent.context.includeDiagnostics` | `false` | Include editor diagnostics in automatic context |
| `pi-agent.context.includeGit` | `false` | Include Git branch/changes in automatic context |
| `pi-agent.sessions.autoName` | `true` | Name new sessions automatically from the first message |
| `pi-agent.notifications.enabled` | `true` | Notify on completion while the window is unfocused |
| `pi-agent.diagnostics.level` | `info` | Output-channel log level (`error`/`info`/`debug`) |

Changing `pi.executable`, `pi.arguments` or `agent.permissionMode` restarts the
session automatically (or run **Pi: Restart Session**).

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

## Links

- [CHANGELOG.md](./CHANGELOG.md)
- [PRIVACY.md](./PRIVACY.md) — no telemetry; nothing leaves your machine
- [SECURITY.md](./SECURITY.md) — report vulnerabilities privately
- [CONTRIBUTING.md](./CONTRIBUTING.md) · [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
- [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)

## License

[MIT](./LICENSE) © Pi Agent contributors
