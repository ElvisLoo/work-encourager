#!/usr/bin/env node
/**
 * run-tests.js — 跨平台、跨 Node 版本的测试入口
 *
 * 为什么不用 `node --test test/*.test.js`：
 *   1. glob 由 shell 展开，Windows cmd 与 PowerShell 行为不一致；
 *   2. Node 20 的 `--test` 不接受 glob，会把 "test/*.test.js" 当字面路径
 *      然后报 MODULE_NOT_FOUND（CI 就是栽在这里）。
 * 这里自己列目录、逐个文件传给 node --test，行为完全确定。
 *
 * 用法：npm test
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TEST_DIR = path.join(ROOT, 'test');

if (!fs.existsSync(TEST_DIR)) {
  console.error('[run-tests] 找不到 test 目录：' + TEST_DIR);
  process.exit(1);
}

const files = fs
  .readdirSync(TEST_DIR)
  .filter((f) => f.endsWith('.test.js'))
  .sort()
  .map((f) => path.join(TEST_DIR, f));

if (!files.length) {
  console.error('[run-tests] test 目录里没有 *.test.js');
  process.exit(1);
}

console.log('[run-tests] Node ' + process.version + '，共 ' + files.length + ' 个测试文件');
files.forEach((f) => console.log('  - ' + path.relative(ROOT, f)));
console.log('');

const r = spawnSync(process.execPath, ['--test'].concat(files), {
  cwd: ROOT,
  stdio: 'inherit'
});

process.exit(r.status === null ? 1 : r.status);
