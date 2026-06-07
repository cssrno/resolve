import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const src = resolve(root, 'src/webview/index.html');
const dst = resolve(root, 'out/webview/index.html');

if (!existsSync(dirname(dst))) mkdirSync(dirname(dst), { recursive: true });
copyFileSync(src, dst);
console.log(`copied ${src} -> ${dst}`);
