# Contributing

Thanks for your interest in Pi Assistant! This is a VS Code extension that puts
the local [pi](https://github.com/earendil-works/pi) coding agent into the
editor sidebar.

## Prerequisites

- Node.js 18+ (see `.nvmrc`)
- VS Code 1.80+
- The `pi` CLI installed and configured (`npm i -g @earendil-works/pi-coding-agent`,
  then run `pi` once to log in / pick a model)

## Development

```bash
npm ci
npm run compile      # tsc (extension host) + esbuild (webview) -> out/ + media/
```

Run the extension: open this folder in VS Code and press **F5**.

Watch mode (two terminals):

```bash
npm run watch          # tsc --watch (extension host)
npm run watch:webview  # esbuild --watch (webview)
```

## Checks

```bash
npm run lint
npm test               # unit tests (vitest)
npm run compile        # must pass before a PR
```

## Project layout

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

## Guidelines

- Keep the extension host and webview responsibilities separate; the webview
  talks to the host only via `postMessage`.
- Do not hardcode user-facing strings: extension host uses `vscode.l10n.t(...)`,
  the webview receives localized strings from the host (`src/views/strings.ts`),
  and the manifest uses `%key%` + `package.nls*.json`.
- Never swallow errors silently — log with `logError` from `src/utils/logger.ts`.
- Prefer type/`code` checks over message-string matching.
- Run `npm run lint` and `npm run compile` before opening a PR.

## Commit messages

Conventional Commits are appreciated (`feat:`, `fix:`, `docs:`, `chore:` ...).

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](./LICENSE).
