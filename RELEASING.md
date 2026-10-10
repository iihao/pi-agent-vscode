# Releasing

This project follows [Semantic Versioning](https://semver.org/). Releases are
built from source by CI — **never commit a `.vsix`**.

## Versioning

- `MAJOR` — breaking changes to commands / settings / extension id
- `MINOR` — new features
- `PATCH` — bug fixes

## Pre-release checklist

1. `npm ci`
2. `npm run lint`
3. `npm test`
4. `npm run compile`
5. `npx --yes @vscode/vsce package` (smoke check — verify `assets/icon.png`,
   `l10n/*` and `media/*` are included and `src/`/`webview/` are not)

## Cutting a release

1. **Bump the version** in `package.json` (`"version": "X.Y.Z"`).
2. **Update `CHANGELOG.md`**: move items from `[Unreleased]` into a new
   `## [X.Y.Z] - YYYY-MM-DD` section.
3. **Commit**:
   ```bash
   git add -A
   git commit -m "chore(release): vX.Y.Z"
   ```
4. **Tag and push**:
   ```bash
   git tag vX.Y.Z
   git push origin main --tags
   ```
5. **CI takes over**: `.github/workflows/release.yml` triggers on `v*` tags,
   builds the extension, packages `pi-assistant-vX.Y.Z.vsix`, and attaches it to
   the GitHub Release with auto-generated notes.

## Publishing to the VS Code Marketplace

First time only:

```bash
npx @vscode/vsce create-publisher iihao   # or: vsce login iihao
```

Then either run it manually:

```bash
npx @vscode/vsce publish
```

…or enable the commented-out **Publish to Marketplace** step in
`.github/workflows/release.yml` and set a `VSCE_PAT` repository secret
(a Marketplace Personal Access Token).

## First release (v0.1.0)

The initial release is the current state of `main`. To cut it:

```bash
git tag v0.1.0
git push origin main --tags
```

Before tagging, make sure:

- `package.json` `publisher` matches your Marketplace publisher id (`iihao`);
- the GitHub repository `iihao/pi-assistant` exists and `main` is pushed;
- `package.json` `repository` / `homepage` / `bugs` point at it.

## Manual fallback

If CI is unavailable:

```bash
npm ci && npm run compile
npx --yes @vscode/vsce package
# then attach the produced .vsix to a GitHub Release manually
```
