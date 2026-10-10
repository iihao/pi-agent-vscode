# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1] - 2026-10-10

### Changed

- Richer empty state for new conversations: a proper Pi logo mark, a
  "Getting started" guide (ask a task / add context / control permissions),
  and a short tagline instead of the bare `›_` placeholder.
- Renamed the Marketplace extension to `pi-agent-assistant`
  (`pi-agent-vscode` was already taken; extension id is now
  `iihao.pi-agent-assistant`).

### Fixed

- Dropped dev/CI files (`.github/`, `.nvmrc`, `.editorconfig`, `RELEASING.md`,
  `.DS_Store`) from the packaged VSIX.

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
