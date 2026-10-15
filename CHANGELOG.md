# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.5] - 2026-10-15

### Changed

- **The empty state no longer flashes when the view opens.** Starting pi and
  reading the transcript from disk takes about a second, and the view used to
  spend it showing the full welcome screen — logo, quick actions and shortcut
  hints — which a session with history then replaced. It now shows just the logo
  and title for that moment, in the place they end up (the space is reserved, so
  nothing reflows); an empty session simply reveals the extras once it is known
  to be empty.
- **`Pi: Restart Session` is now `Pi: Reload Session`** (⟳ icon). "Restart" read
  as "re-open / wipe this conversation" — which is what `/clear` and **New chat**
  do — while this command replaces this session's pi process and rebuilds its
  transcript from the session file. The session list also gained its own ⟳ that
  re-reads the session directory from disk, for when another pi process created,
  renamed or appended sessions.

### Fixed

- **Stopping a turn no longer shows a red error.** pi marks a turn it aborted
  with `stopReason: 'aborted'`, but only when the abort lands mid-message: if it
  lands between turns the aborted message arrives as a plain error carrying the
  `AbortError` text (*"This operation was aborted"*), which the panel rendered as
  a failure with Retry / Switch model / Show logs — for a stop the user had just
  asked for. The panel now tracks the stop it requested (from **Stop**, or from
  switching sessions, which stops the running turn) and reports those as a
  neutral *Stopped* notice, while a genuine failure is still reported. The
  abort-recovery fallback (*"did not settle within 30 seconds"*) is a notice now
  too, instead of an actionable error bubble.
- **A long turn is no longer cut loose after 10 minutes.** A watchdog reset the
  busy state and reported *"Pi turn timed out after 10 minutes; you can send a
  new message"* once a turn had run that long. A long turn is normal, though — a
  big refactor, a slow model, a build the agent is polling — and the extension's
  own log shows the watchdog firing one second after `turn_start` while bash
  output was still streaming in. The UI was unlocked while pi was still working,
  so a message could be sent into the running turn. There is no duration cap any
  more; recovery is explicit instead: **Stop** aborts and force-unlocks if the
  turn does not settle within 30 seconds, and **Reload Session** replaces the
  process.
- **A new session now starts on the model the composer shows.** pi's `set_model`
  applies to the running session only, and a brand-new session falls back to the
  first entry of the model list — so picking a model and then hitting **New
  chat** silently ran the new conversation on a different model than the
  composer announced (pi does not persist the choice either, so it stayed wrong
  across reloads). The composer's pick is remembered now and re-applied to fresh
  sessions; a session that has already run keeps the model recorded in its own
  log, since overriding that would rewrite what the conversation actually used.
- **The first-run checklist no longer flashes when the view opens.** It was shown
  whenever `connected` / `authReady` were not both true — which also covers
  "still connecting" and "credentials not checked yet". On a healthy setup (the
  common case) the first screen therefore showed its "connecting / checking"
  rows and removed them again a moment later, on every single open. It is now
  shown only when something is actually wrong *and* the user can act on it:
  workspace not trusted, pi missing, a connection attempt that failed, or a
  provider known to have no credentials. In-progress states stay hidden and are
  left to the header's connection dot. Re-rendering identical markup is skipped
  as well, so a button the user is already reaching for is not replaced under
  the cursor.
- **Starting a new session no longer carries over the previous one's tool
  boxes.** `clear` removed a fixed list of element classes and missed the
  tool-group wrapper, so a collapsed "Bash, Read …" box from the previous
  session stayed in the transcript — visible and expandable, but empty because
  its cards *had* been removed. The transcript is now swept by dropping every
  child of the container except the empty state, so no renderer (including ones
  added later) can leak into the next session.
- **Reloading a session no longer kills a running turn silently.** The command
  replaced the pi process outright, throwing away the current turn and whatever
  had not reached the session file yet. It now asks first, aborts the turn
  gracefully and waits briefly for its entries to land before reconnecting — so
  reloading stays usable when pi is wedged (the main reason to reload) without
  ever discarding work by accident. Only the current session is touched.
- **A settings-driven reload no longer kills other sessions mid-turn.** Changing
  `pi.executable` / `pi.arguments` / `agent.permissionMode` reloads every session
  (settings are global) but now ends each running turn gracefully first, and
  tells every panel that the turn ended.
- **Panels sharing one session no longer drift out of sync.** Reconciling the
  busy state after a reconnect only reached the panel that reconnected; every
  panel bound to that runtime is updated now.
- **Reloading a session no longer throws away most of the transcript.** The
  reload path rebuilt the chat from `get_messages`, which returns the *model
  context*: everything before the last compaction was already summarized away,
  no tool call, tool result, diff or thinking block was in it, and only the last
  30 text messages were kept. It now replays pi's own session log
  (`get_entries`) instead, following the current branch through `parentId` so
  abandoned forks stay hidden. Tool cards come back with their output, duration,
  error state, diff and truncation note, thinking blocks come back collapsed,
  user messages keep their attachments, and a compaction checkpoint is shown as
  a foldable marker rather than silently dropping the summarized range. The
  replay is capped at the most recent 4000 items, cut at a turn boundary (a tool
  result never loses its tool call), and anything left out is reported instead
  of vanishing. Older pi builds without `get_entries` fall back to
  `get_messages`, which no longer drops everything but the last 30 messages.
- **A reconnect during a running turn no longer wipes or duplicates the
  transcript.** `_ensureClient` decided whether to clear the webview from the
  runtime's busy flag, which is shared by every panel on the same session — so a
  panel switched to a session another panel was running mid-turn could end up
  cleared with nothing replayed, while a panel reconnecting mid-turn appended a
  second copy of the history. Clearing and replaying now go together, driven by
  whether *that* webview holds the runtime's transcript.

## [0.1.4] - 2026-10-14

### Added

- **Provider management & credential-aware errors.**
  - `Pi: Manage Model Providers` lists every provider found in `auth.json` /
    `models.json` with its live `pi auth check` status (`✓` / `⚠ reason`), and
    lets you **update the key**, **delete** the provider, or re-check it.
  - The first-run checklist has a **Manage providers** link as well.
  - When a turn fails because a provider has no credentials, the error bubble
    now offers **Add API key** and **Sign in with pi** inline, next to the
    existing Retry / Switch model / Show logs.

- **Guided “connect a provider” flow for first-run.** The setup checklist now
  asks whether the current provider actually has credentials (`pi auth check
  --json`) instead of merely “is there a model list”, and its **Connect** button
  walks you through it without leaving VS Code:
  - **Add an API key** for a built-in provider (Anthropic, OpenAI, DeepSeek,
    Gemini, OpenRouter, …) — written to pi's own `auth.json`;
  - **Add a custom OpenAI-compatible endpoint** (third-party gateway,
    self-hosted, Ollama/LM Studio) — written to pi's `models.json`;
  - **Sign in with pi** in a terminal for OAuth providers.

  After saving it restarts the client, re-checks the provider and picks a model
  so you can send your first message immediately (pi still chooses the model
  itself when it already has one). Credential files are backed up (`*.bak`)
  before writing and written `0600`; `PI_CODING_AGENT_DIR` is respected.

### Changed

- **`Queue` / `Steer` while pi is working.** The composer keeps **one** button
  (Send when idle, Stop while a turn runs) plus a Queue/Steer toggle, and Enter
  follows the selected mode (`Ctrl/Cmd+Enter` still force-steers). This replaces
  the temporary “Stop + Send side by side” arrangement.

### Fixed

- **The “Changed files” card is no longer clipped after a turn.** It was only
  scrolled into view when the chat was already near the bottom — but that check
  ran *after* the card was appended, so a multi-file card grew taller than the
  threshold, the check failed, and the view stayed put with only the first row
  visible (you had to scroll again to see the rest). The scroll intent is now
  captured *before* the card is added, and if the card is taller than the
  viewport it aligns to its top so you read from the first file.

## [0.1.3] - 2026-10-13

### Added

- **First-run setup checklist.** When nothing is set up yet, the empty state
  shows a small checklist — workspace trusted, `pi` installed, connected,
  model available — each unfinished item with a one-click action (install `pi`
  in a terminal, sign in by running `pi`, Retry, manage workspace trust, show
  logs). It hides itself once everything is ready.
- **Actionable errors.** A failed turn (or connection) now renders buttons in
  the error bubble — **Retry** (re-sends the last message), **Switch model**,
  and **Show logs** — instead of a dead-end red message.
- **`Queue` / `Steer` buttons while pi is working.** Sending mid-turn no longer
  requires remembering `Ctrl/Cmd+Enter`: the composer shows a Stop button and a
  Queue/Steer toggle, and Enter/click follows the selected mode (`Ctrl/Cmd+Enter`
  still force-steers).
- **The three surfaces are independent by default.** The sidebar, the
  secondary-side-bar view and the editor-tab panel each get their **own pi
  process and session**, so all three run different conversations in parallel
  with no shared busy / context / stream state. The first surface opened
  continues your most recent session; the others start fresh (so two surfaces
  never contend for the same session file). To mirror, switch a surface to a
  session another surface is already on — then they share that runtime (busy,
  composer context, models/stats, streamed output). Closing a surface keeps its
  session alive; idle, unreferenced runtimes are stopped automatically.
- **The active editor is attached to the composer by default** (like Claude
  Code): the current selection — or the whole file when there is no selection —
  shows up as a removable chip. Removing it keeps it removed for that file
  until you switch documents. Turning focus to the chat keeps the attachment.
  Controlled by `pi-agent.context.autoAttachActiveEditor` (default on).
- **Sent user messages show their file attachments**: questions that carried
  file/selection context now render the referenced paths (with line ranges) as
  chips, both live and when the transcript is restored.

### Changed

- **Tool activity is grouped, one line per tool.** Consecutive tool calls in a
  turn collapse into a single expandable group (a lone tool stays unwrapped),
  and every tool card shows just one line — name, summary and status — until
  you click it, so the answer is no longer buried under a wall of output and
  diffs. Groups stay **expanded** by default (click the header to fold one); a
  new thinking block starts a new group, and a group holds at most 5 tools
  before a fresh one begins.
- **Slimmer composer on narrow panels.** Below ~320px the thinking and
  permission controls drop to icon-only, keeping the composer on one row.
- **Searchable session list** (name / preview / id), and it now shows up to 60
  recent sessions instead of 20.
- **Inline diff for changed files.** Each file in the turn-change card has a `±`
  toggle that expands its diff right in the chat.
- **Chat can live in the Secondary Side Bar (right).** A native
  `secondarySidebar` view is contributed, sharing the same pi client and
  session as the primary sidebar. Open it from the command palette
  (**Pi: Open Chat in Secondary Side Bar**), the new view-title button, or the
  button on the editor-tab panel. The editor-tab panel itself cannot be dragged
  there — VS Code only hosts views in the secondary side bar.
- **`/compact` is one click.** Clicking the context-usage ring compacts
  directly instead of inserting `/compact` into the composer and picking it from
  the suggest menu; the modal confirmation is gone too.
- **Thinking indicator polish.** The spinner uses the accent color, the live
  token count shows the exact value (no more `1.5k`), and the elapsed time is
  shown in milliseconds for the first second.

- **Turn-change review & revert** is now per-file and reversible:
  - Each changed file has its own hover **Undo** action, so you can restore a
    single file without reverting the whole turn.
  - No more modal confirmation; the card updates in place, marking each file
    with a check (restored) or a reason on failure.
  - After reverting you can **Undo** the revert (restore the state right after
    the turn), so an accidental revert is never destructive. The undo entry
    stays until the next turn or session.
  - Files that cannot be reverted automatically (overwritten with `write`) are
    marked and explained instead of silently skipped.

### Fixed

- **`write` (whole-file overwrite) now shows a diff and can be reverted.** The
  extension snapshots the file right before the first tool touches it, so a
  `write` gets a real line diff (context lines, `+`/`-`) and a working **Undo** —
  previously it produced no diff and was reported as “cannot be reverted”.
- **Failed tools are no longer counted as turn changes.** An `edit`/`write`
  that errors (e.g. `oldText` not found) used to stay in the Changed-files card
  (with a misleading diff, and a revert that failed with “content changed”).
  The tracking now records each tool call’s delta and rolls it back on error.
- **Diffs are visible again.** Tool cards with a diff auto-expand instead of
  hiding it behind a click, and the `±` toggle on changed files is always shown
  (it was hover-only).

- **Stopping a turn by hand is no longer reported as an error.** pi marks a
  user-stopped turn with `stopReason: "aborted"` but still carries an
  `errorMessage`, so the extension rendered it as a red error bubble offering
  **Retry / Switch model / Show logs**. It now shows a neutral **Stopped**
  line; the actionable error bubble is reserved for real failures.

- **Creating a new session no longer aborts a shared turn.** When the sidebar
  and the secondary-side-bar (or editor tab) were on the *same* session,
  clicking **New Chat** in one surface called `abort` on the shared runtime,
  stopping the other surface's running turn with `Request aborted`. Aborting
  now only happens when the panel is the sole user of that session — a surface
  that is merely sharing it keeps running.

- **Localization caught up.** Dozens of user-facing strings (the setup
  checklist, error actions, **Queue/Steer** mode, session search, inline diff, …)
  were missing from the `zh-cn` bundle and showed up in English under a Chinese
  UI. Every `vscode.l10n.t()` source string now exists in both
  `l10n/bundle.l10n.json` and `l10n/bundle.l10n.zh-cn.json`, and a regression
  test fails if a new string is added without a translation.

- **Compaction no longer trips the SDK's hard-coded 30s RPC timeout.** Long
  sessions routinely take longer than 30 seconds to summarize, which failed
  with `Timeout waiting for response to compact`. `compact` and `bash` now use a
  10-minute timeout (other commands keep the SDK default).

- **Nothing the agent produces is dropped from the transcript any more.** Every
  finished message is reconciled against pi's authoritative content, so content
  that never reached the webview (lost deltas, non-streaming providers) is
  filled in — text, thinking, tool calls and tool results:
  - assistant text is completed from `text_end.content` / `message_end`;
  - thinking is completed from `thinking_end` / `message_end`;
  - tool calls whose execution events were missed are rendered at turn end
    (and never duplicated when the events did arrive);
  - every `toolResult` message is rendered, and tool cards still spinning at
    turn end are closed instead of hanging forever.
- **Failed turns are no longer silent.** pi reports an aborted/errored turn as
  an empty assistant message carrying `errorMessage`; the extension now shows
  that error instead of finishing the turn with no output at all.
- Tool output is no longer truncated a second time by the extension (cap raised
  from 20k to 200k characters). When pi itself truncates, the card says so and
  links to the full output file.
- **Tool call arguments are rendered in full**, not just the one-line summary.
  For `edit` this is where the old/new text lives, so the card now shows the
  exact arguments the agent sent (very long arguments are capped at 20k
  characters with an explicit marker rather than dropped silently).
- A stream that fails mid-message keeps the text already received; the error
  banner no longer discards the open stream buffer.
- Multi-surface rendering: the "assistant stream is open" flag was shared
  between the sidebar and the editor-tab panels, so whichever panel handled an
  event second dropped every text chunk and showed only "Thinking…". Render
  state is now per panel.
- The **Undo** button on the turn-change card was visible before anything had
  been reverted, so clicking it reported “Nothing to restore”. The webview now
  defines a global `.hidden` utility (previously only per-component rules
  existed, which the new button did not have), and a test guards against it.

## [0.1.2] - 2026-10-12

### Added

- **Composer context gauge**: a compact ring next to the composer's `+` button
  shows live context-window usage; hover for a tooltip (used %, window size,
  auto-compact) and click to start the `/compact` flow.
- **Built-in slash commands**: typing `/` now lists the panel's built-ins next
  to pi's own commands — `/model`, `/thinking`, `/permission`, `/sessions`,
  `/compact`, `/clear`, `/new`, `/clone`, `/export`, `/search`, `/help`.
- **Current-question preview**: the session bar's `5/6` counter shows a
  truncated preview of the question you are on, updating as you scroll.

### Changed

- The webview was rewritten as focused TypeScript modules (a shared context plus
  13 feature modules), replacing the single ~1,570-line `main.js`.
- Session bar: the session selector is now a bordered chip with an integrated
  icon and sizes to its content (instead of filling the row); its dropdown opens
  on the left, while the question list opens on the right.
- User questions render as right-aligned chat bubbles with a flat accent tint
  and no border (the redundant “You” label is gone); assistant answers stay
  left-aligned, and the question-navigator flash highlights the bubble.
- Code-block **Apply** / **Copy** actions are localized.
- Thinking output stays collapsed while pi is working; a spinner sits on the
  header next to the token count and elapsed time, and a one-line live preview of
  the reasoning scrolls beneath it. When the turn ends the spinner stops and the
  line can be expanded to read the full reasoning.
- Assistant replies type out smoothly via a time-driven reveal, independent of how
  the model chunks its output (no more whole-response dumps).
- A pulsing indicator at the bottom of the chat keeps the run visibly active
  during the gaps between phases (for example after a shell command finishes and
  before the next step), so a turn no longer looks stalled.
- Shell/bash tool cards start expanded so their output is visible as it runs, and
  the output spans the full card width.

### Fixed

- The per-turn usage notice no longer has an oversized gap above it: a message
  that is immediately followed by a notice drops its full bottom margin.
- Expanded shell/tool cards now keep the chat scrolled to the bottom as their
  output grows, instead of waiting for the next step to jump down.
- `/clear` now clears the conversation and starts a fresh session (the message
  had no handler in the extension host).
- Localized the context-usage tooltip (`Window`, `Click to compact`).

## [0.1.1] - 2026-10-11

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
  (hover for a preview, click to jump), `Alt+↑/↓` to step between questions, and
  `‹ 5/6 ▾ ›` in the session bar. The `5/6` counter is a dropdown that opens the
  jump list (current item highlighted) and tracks scrolling; the arrows step
  through (disabled at the ends). Hidden with fewer than two questions.
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
- **Add context**: the composer's `+` button opens a wide popup menu (like VS
  Code's native chat) with **Files & folders…** (native picker, multi-select),
  then the **files currently open** in VS Code (the active file is listed by
  name, with its selection range when there is one) and then **recently
  attached files**. A **Pi: Attach Files from Workspace** command (command
  palette + editor context menu) opens the picker directly.
- The editor title bar shows a single Pi (`>_`) icon that opens the plugin's
  own chat as an editor tab (content area).
- Marketplace polish: a README cover image, Marketplace install instructions, a
  first-run **walkthrough**, a **PRIVACY.md**, and Japanese / Korean / German /
  French manifest localizations.

### Changed

- Removed unused code: the state store's observer/subscribe machinery and
  unused selectors, plus the unused filesystem and pi-sdk service modules.
- Code blocks: a narrower line-number gutter and icon-only **Apply** /
  **Copy** actions (check / copy glyphs) with tooltips, shown on hover or
  keyboard focus.
- All composer popovers (model, thinking, permissions, add-context) share a
  single width (380px, shrinking to fit narrow sidebars).
- Empty state for new conversations: a Pi logo mark, quick actions, and
  keyboard hints (the tagline and the earlier "Getting started" guide card were
  removed for a simpler first screen).
- UI refresh: a subtle tinted logo badge (light green fill + accent glyph,
  no glow), a vertically centered empty state,
  smaller/muted quick-action pills, a refined user-message bubble, and a
  composer card with a subtle shadow.
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
- Streaming output is re-rendered once per animation frame instead of on every
  chunk, and the chat auto-scrolls only when you are already near the bottom.
- The question rail is rebuilt only when the number of questions changes, with
  cached previews.
- `@earendil-works/pi-coding-agent` moved to `devDependencies`; it is not
  shipped in the VSIX (pi is resolved from your own install).
- Added tests for the previously untested imperative code: `PiClientManager`
  (via an injectable SDK seam), `getSelectionContext`, and the ChatPanel
  webview bridge (message routing, `clear`, disposed-panel guard).

### Fixed

- The pi client drops its event subscription when a start attempt fails, so a
  discarded client no longer lingers on the manager.
- The session-file read cache is pruned to the active session directory, and
  head/tail reads use the actual number of bytes read (no garbage tail on a
  short file).
- **pi discovery**: besides the bundled copy, `pi` is now resolved from `PATH`
  (covering nvm/fnm/asdf/volta/bun/pnpm and custom npm prefixes) and from
  `npm root -g`, with Windows support (`pi.cmd`/`pi.exe`, `%APPDATA%\npm`).
  Global installs no longer require setting `pi-agent.pi.executable`.
- Creating a new chat now waits for an in-flight stream to abort before
  switching sessions, avoiding an intermittent "cannot start a new session
  while streaming" failure.
- The add-context menu's selection entry attaches the exact file and line
  range it was clicked with, instead of the active editor's selection.
- Added the missing `cmd.attachFiles` title to the German, French, Japanese
  and Korean command labels.
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
- Clear the previous turn's change-tracking when creating, switching, cloning,
  or renaming a session, so **Revert** only touches the current session's files.
- One-shot generation (commit message / PR description / session auto-name)
  cancels a pi UI request instead of hanging until it times out.
- Pasted images are capped at 5 MB.
- Manifest attribute values (`title`, `aria-label`, `placeholder`, `data-q`) are
  HTML-escaped.

### Security

- Remote images in model output are no longer loaded automatically. The webview
  CSP drops `https:` from `img-src`, and Markdown images with `http(s)` URLs
  render as click-to-open links (opened in the system browser), preventing
  tracking pixels and IP leaks.
- Links opened from chat are limited to the `http`, `https`, and `mailto`
  schemes; other protocols (`command:`, `vscode:`, …) are ignored.

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

[Unreleased]: https://github.com/iihao/pi-agent-vscode/compare/v0.1.5...HEAD
[0.1.5]: https://github.com/iihao/pi-agent-vscode/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/iihao/pi-agent-vscode/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/iihao/pi-agent-vscode/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/iihao/pi-agent-vscode/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/iihao/pi-agent-vscode/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/iihao/pi-agent-vscode/releases/tag/v0.1.0
