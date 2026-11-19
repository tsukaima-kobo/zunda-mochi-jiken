// 上映画面。ブラウザの中で台本ボットの試合を回して上映する。
// npm run build で、どこにでも置ける静的なファイル（dist/）を作る（GitHub Pages など）。

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const here = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: here,
  // GitHub Pages のように、サイトの途中のフォルダ（/<リポジトリ名>/）に置いても動くよう、相対の道で読む
  base: './',
  build: { outDir: fileURLToPath(new URL('../../dist', import.meta.url)), emptyOutDir: true },
  server: { host: '127.0.0.1', port: 5173 },
});
