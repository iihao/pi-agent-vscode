# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1] - 2026-10-10

### Added

- **Editor tabs**: open the chat in an editor tab (or beside) with
  **Pi: Open Chat in Editor Tab** / **Pi: Open Chat Beside**. All surfaces share
  one pi client and session, so the sidebar and tabs stay in sync.
- **Image paste**: paste an image into the composer to send it to vision models;
  thumbnails show above the input and can be removed before sending.
- **Automatic context**: optionally attach the open file and selection to every
  message, plus diagnostics and Git branch/changes (`pi-agent.context.autoAttach`,
  `includeDiagnostics`, `includeGit`). Sent as a `<editor-context>` /
  `<git-context>` block alongside manual references.
- **Session auto-naming** (on by default): name a new session from its first
  message with a one-shot ephemeral pi run; if it fails, the session falls back
  to the first question. Disable with `pi-agent.sessions.autoName`.
- **Clone Session**: fork the current session branch into a new one.
- **Git integration**: generate a commit message from the current diff
  (button in the Source Control title bar) and a pull request description from
  the branch's commits. Both run a one-shot, ephemeral pi process
  (`--no-session`) so they don't pollute the chat session.
- **Turn change review**: after each turn, a card lists the files changed by
  `edit`/`write`; click to open a file, or **Revert** to restore them to their
  pre-turn state (created files go to the trash; overwritten files are
  reported as not auto-revertible).
- **Slash commands & skills**: type `/` in the composer to autocomplete pi's
  commands, prompt templates, and skills (from `get_commands`); selecting one
  inserts it and pi expands it on send.
- **`@` file mentions**: type `@` to autocomplete workspace files, or drop files
  from the editor/explorer onto the composer; mentions are inserted as
  `@path` references.
- **Question navigator**: a right-edge rail with one tick per user question
  (hover for a preview, click to jump), a header button that opens a jump list,
  and `Alt+↑/↓` to step between questions. The active tick tracks scroll.
- **Prev/Next question** buttons (`‹`/`›`) in the session bar jump between
  questions in the current session; they disable at the ends and hide when there
  are fewer than two questions.
- **Queue & steer**: send while pi is working — Enter queues the message
  (follow-up), Ctrl/Cmd+Enter steers the running turn. Queued messages show a
  badge that clears as the queue drains.
- **`!` shell commands**: start a message with `!` to run a shell command
  directly, without an agent turn; the output is shown in chat and recorded in
  the session. Disabled in read-only mode.
- New commands: **New Chat** (`Ctrl/Cmd+Shift+N` in the sidebar), **Focus
  Input**, **Edit Last Message**, **Cycle Model**, **Cycle Thinking Level**,
  **Compact Session**.
- Context meter warning when the window is nearly full, with a one-click
  **Compact** action.

### Changed

- Richer empty state for new conversations: a proper Pi logo mark, a
  "Getting started" guide (ask a task / add context / control permissions),
  and a short tagline instead of the bare `›_` placeholder.
- Renamed the Marketplace extension to `pi-agent-assistant`
  (`pi-agent-vscode` was already taken; extension id is now
  `iihao.pi-agent-assistant`).
- Session metadata is now read with a bounded head/tail scan instead of
  loading whole session files (up to 8 MB each) into memory, avoiding
  extension-host stalls on large sessions.
- `ensureView` waits up to ~5s for the webview to be created (was 2s).
- Attached files/selections are sent as **references** (`@path:12-30`) instead
  of copied text, so pi reads the current file itself. Context blocks are
  stripped from displayed history.
- The activity bar now uses the Pi `>_` mark (a bold monochrome 24×24 SVG,
  `assets/icon-activity.svg`) instead of a robot codicon; the in-panel header
  mark matches it.
- Internally, chat state is now centralized in a state store (`src/state`) and
  VS Code access goes through a service container (`src/services`) — a
  testable seam for future work.
- Sessions the user has not renamed now display their first question (trimmed,
  whitespace-collapsed, truncated to 60 chars) instead of the raw session id.

### Fixed

- Keep the welcome/guide screen visible after creating a new session or
  switching to an empty one — the "New session created" notice no longer
  hides it, leaving a blank panel.
- Notices in general no longer dismiss the empty state.
- Report when applying generated code fails (`applyEdit` returned false).
- Log when a response to a pi `extension_ui_request` could not be written,
  so a stalled prompt is diagnosable.
- The model picker no longer stays on "Connecting…" when the model list
  fails to load.
- Show a notice when a prompt is queued behind the current turn.
- Added `pi-agent.clearChat` to `activationEvents` for consistency.
- Dropped dev/CI files (`.github/`, `.nvmrc`, `.editorconfig`, `RELEASING.md`,
  `.DS_Store`) from the packaged VSIX.
- Dispose the pi event subscription with the panel and ignore events once the
  panel is disposed, so a closed tab no longer reacts to pi events or
  accumulates listeners.
- A new chat surface no longer resets the shared state; `busy` is reconciled
  from pi's streaming state on connect, so messages sent while pi works are
  queued instead of bypassing the queue.

### Security

- Remote images in model output are no longer loaded automatically. The webview
  CSP drops `https:` from `img-src`, and Markdown images with `http(s)` URLs
  render as click-to-open links (opened in the system browser), preventing
  tracking pixels and IP leaks.

## [0.1.0] - 2026-10-10

### Added

- Sidebar chat panel powered by the local **pi** coding agent (via the
  `@earendil-works/pi-coding-agent` RPC SDK).
- Streaming assistant output, thinking display, and per-tool activity cards
  showing command output and edit diffs.
- Markdown rendering (`markdown-it`) with syntax highlighting (`highlight.js`),
  KaTeX math, and Mermaid diagrams (lazy-loaded).
- Session list: **new / switch / rename**; switching restores history.
- Model picker and thinking-level picker in the composer.
- Permission modes: **Manual / Auto / Read-only** (`--approve`,
  `--exclude-tools bash,edit,write`).
- Editor context chips (attach current file or selection to the prompt).
- Context-usage indicator in the header.
- Completion notifications and diagnostics export.
- Localization (English / Simplified Chinese) following the VS Code display
  language.
- Trusted-workspace gating and a settings namespace (`pi-agent.*`).

[Unreleased]: https://github.com/iihao/pi-agent-vscode/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/iihao/pi-agent-vscode/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/iihao/pi-agent-vscode/releases/tag/v0.1.0
