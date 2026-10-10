## Summary

<!-- What does this PR change and why? -->

## Checklist

- [ ] `npm run lint` passes
- [ ] `npm test` passes
- [ ] `npm run compile` passes
- [ ] No hardcoded user-facing strings (host uses `vscode.l10n.t`, webview uses injected strings, manifest uses `%key%` + `package.nls*.json`)
- [ ] No silently swallowed errors (use `logError`)
- [ ] CHANGELOG updated (for user-visible changes)

## Related issues

<!-- e.g. Closes #123 -->
