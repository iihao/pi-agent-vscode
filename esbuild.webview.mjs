/**
 * 构建 webview 资源 -> media/
 *
 * - ESM + 代码分割：主包 media/main.js；重库（mermaid）按需懒加载为 media/chunks/*
 * - katex 样式里的字体复制到 media/assets/*
 * - styles.css 与 katex 的 CSS 合并为 media/main.css
 * - 扩展侧用 webview.asWebviewUri 引用 media/main.js / media/main.css
 */
import esbuild from 'esbuild';
import { rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 裁剪 elkjs（约 1.4MB）。Mermaid 未注册 elk 时会自动回退到 dagre。
 *  如需完整的 ELK 布局，删除下面 alias 即可。 */
const elkStub = fileURLToPath(new URL('./webview/elk-stub.js', import.meta.url));

/**
 * KaTeX 的 CSS 同时引用了 woff2/woff/ttf 三种字体，但现代 VSCode（Chromium 内核）
 * 只需 woff2 即可渲染数学公式。此插件在打包时移除 woff/ttf 的 src 声明，
 * 使 esbuild 不会将这两类字体复制到 media/，减小 VSIX 体积。
 *
 * 匹配格式：,url(<path>.woff)  format("woff")
 *           ,url(<path>.ttf)   format("truetype")
 * 注意：必须保留开头的逗号，避免误删首条 src（首条无前导逗号）。
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
