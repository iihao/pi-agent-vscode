/**
 * Build webview assets -> media/
 *
 * - ESM + code splitting: the main bundle is media/main.js; heavy libraries
 *   (mermaid) are lazily loaded as media/chunks/*
 * - Fonts referenced by the KaTeX CSS are copied to media/assets/*
 * - styles.css and the KaTeX CSS are merged into media/main.css
 * - The extension references media/main.js / media/main.css via webview.asWebviewUri
 */
import esbuild from 'esbuild';
import { rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Trim elkjs (~1.4MB). Mermaid falls back to dagre when elk is not registered.
 *  Delete the alias below if you need the full ELK layout. */
const elkStub = fileURLToPath(new URL('./webview/elk-stub.js', import.meta.url));

/**
 * The KaTeX CSS references woff2/woff/ttf fonts, but modern VS Code (Chromium)
 * only needs woff2 to render math. This plugin removes the woff/ttf src
 * declarations while bundling so esbuild never copies them into media/,
 * keeping the VSIX smaller.
 *
 * Matches: ,url(<path>.woff)  format("woff")
 *          ,url(<path>.ttf)   format("truetype")
 * Note: the leading comma must be kept so the first src (which has no leading
 * comma) is not removed by mistake.
 */
const KATEX_FONT_REMOVAL = /,url\([^)]*?\.(?:woff|ttf)\)\s*format\("(?:woff|truetype)"\)/g;
const KATEX_CSS_FILTER = /katex[\\/].*\.css$/;

const katexWoff2Only = {
    name: 'katex-woff2-only',
    setup(build) {
        build.onLoad({ filter: KATEX_CSS_FILTER }, async (args) => {
            const css = (await readFile(args.path, 'utf8')).replace(KATEX_FONT_REMOVAL, '');
            return { contents: css, loader: 'css', resolveDir: dirname(args.path) };
        });
    },
};

const watch = process.argv.includes('--watch');

rmSync('media', { recursive: true, force: true });

const options = {
    entryPoints: ['webview/main.ts'],
    bundle: true,
    outdir: 'media',
    entryNames: 'main',
    chunkNames: 'chunks/[name]-[hash]',
    assetNames: 'assets/[name]-[hash]',
    format: 'esm',
    splitting: true,
    platform: 'browser',
    target: ['es2020'],
    minify: !watch,
    sourcemap: watch ? 'inline' : false,
    loader: { '.woff': 'file', '.woff2': 'file', '.ttf': 'file' },
    alias: { 'elkjs/lib/elk.bundled.js': elkStub },
    plugins: [katexWoff2Only],
    logLevel: 'info',
};

if (watch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
    console.log('esbuild: watching webview -> media/');
} else {
    await esbuild.build(options);
    console.log('esbuild: webview built -> media/');
}
