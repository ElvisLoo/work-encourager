#!/usr/bin/env node
/**
 * build-web.js — 生成自包含的网页版 dist/web/index.html
 *
 * 为什么需要这一步：
 *   src/index.html 直接打开时，almanac.js 需要 lunar-javascript。
 *   Electron 渲染进程关了 nodeIntegration，浏览器里也没有 require，
 *   所以要把 lunar.js 内联进来，让它以 UMD 的「挂全局」分支运行。
 *
 * 用法：node scripts/build-web.js
 * 产物：dist/web/index.html（单文件，双击可用）
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const OUT_DIR = path.join(ROOT, 'dist', 'web');

function read(p) {
  return fs.readFileSync(p, 'utf8');
}

// 永远从 src/vendor 读：这是应用与网页版共用的同一份
const VENDOR = path.join(SRC, 'vendor');
const NODE_LUNAR = path.join(ROOT, 'node_modules', 'lunar-javascript');

// 保证 src/vendor 与 node_modules 一致（升级依赖后自动同步）
function syncVendor() {
  fs.mkdirSync(VENDOR, { recursive: true });
  const src = path.join(NODE_LUNAR, 'lunar.js');
  const dst = path.join(VENDOR, 'lunar.js');
  if (fs.existsSync(src)) {
    const a = fs.readFileSync(src);
    const b = fs.existsSync(dst) ? fs.readFileSync(dst) : null;
    if (!b || !a.equals(b)) {
      fs.writeFileSync(dst, a);
      console.log('[build-web] 已同步 src/vendor/lunar.js');
    }
  }
}
syncVendor();
const lunarJs = read(path.join(VENDOR, 'lunar.js'));
let html = read(path.join(SRC, 'index.html'));
const css = read(path.join(SRC, 'styles.css'));
const earnJs = read(path.join(SRC, 'earn.js'));
const almaJs = read(path.join(SRC, 'almanac.js'));
const appJs = read(path.join(SRC, 'app.js'));

// 防止脚本内容里出现 </script> 提前闭合
const safe = (s) => s.replace(/<\/script/gi, '<\\/script');

// 统一换行符，避免 CRLF 导致字符串匹配失败
html = html.replace(/\r\n/g, '\n');

html = html.replace(
  '<link rel="stylesheet" href="styles.css">',
  '<style>\n' + safe(css) + '\n</style>'
);

html = html.replace(
  /<script src="vendor\/lunar\.js"><\/script>\s*<script src="earn\.js"><\/script>\s*<script src="almanac\.js"><\/script>\s*<script src="app\.js"><\/script>/,
  [
    '<!-- lunar-javascript (MIT) 内联，UMD 会挂到全局 -->',
    '<script>' + safe(lunarJs) + '</script>',
    '<script>' + safe(earnJs) + '</script>',
    '<script>' + safe(almaJs) + '</script>',
    '<script>' + safe(appJs) + '</script>'
  ].join('\n')
);

if (html.indexOf('lunar-javascript (MIT)') < 0) {
  console.error('[build-web] 没能在 index.html 里找到脚本占位，请检查模板是否被改动');
  process.exit(1);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const outFile = path.join(OUT_DIR, 'index.html');
fs.writeFileSync(outFile, html, 'utf8');

const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(0);
console.log('[build-web] 已生成 ' + path.relative(ROOT, outFile) + ' (' + kb + ' KB)');
