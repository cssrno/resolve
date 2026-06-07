import { cpSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const src = resolve(root, 'node_modules/monaco-editor/min/vs');
const dst = resolve(root, 'out/webview/monaco/vs');
const onigSrc = resolve(root, 'node_modules/vscode-oniguruma/release/onig.wasm');
const onigDst = resolve(root, 'out/webview/monaco/onig.wasm');

if (!existsSync(src)) {
  console.error(`Monaco source missing: ${src}`);
  console.error(`Run "npm install" first.`);
  process.exit(1);
}

mkdirSync(dirname(dst), { recursive: true });
cpSync(src, dst, { recursive: true });
console.log(`copied ${src} -> ${dst}`);

if (existsSync(onigSrc)) {
  copyFileSync(onigSrc, onigDst);
  console.log(`copied ${onigSrc} -> ${onigDst}`);
}
