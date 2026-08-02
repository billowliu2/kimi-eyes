#!/usr/bin/env node
// kimi-eyes — 版本同步脚本。package.json 是唯一版本来源。
//
// 用法：
//   node scripts/bump-version.mjs            从 package.json 同步 kimi.plugin.json
//   node scripts/bump-version.mjs 1.0.6      更新 package.json 并同步 kimi.plugin.json
//
// 作为 npm "version" 钩子运行时（npm version xxx 改完包版本后自动触发），
// 无需参数，自动把新版本同步到 kimi.plugin.json。
// mcp/vision.mjs 的 VERSION 在运行时直接读取 package.json，无需同步。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const pkgPath = path.join(root, 'package.json');
const pluginPath = path.join(root, 'kimi.plugin.json');

const SEMVER = /^\d+\.\d+\.\d+$/;

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
function writeJson(p, obj) {
  fs.writeFileSync(p, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
}

const arg = process.argv[2];
const pkg = readJson(pkgPath);

if (arg) {
  if (!SEMVER.test(arg)) {
    console.error(`[bump-version] 非法版本号: ${arg}（需要 semver 格式，如 1.0.6）`);
    process.exit(1);
  }
  pkg.version = arg;
  writeJson(pkgPath, pkg);
  console.log(`[bump-version] package.json -> ${arg}`);
} else {
  console.log(`[bump-version] package.json 当前版本: ${pkg.version}`);
}

// 同步到 kimi.plugin.json
const plugin = readJson(pluginPath);
if (plugin.version === pkg.version) {
  console.log(`[bump-version] kimi.plugin.json 已一致 (${pkg.version})`);
} else {
  plugin.version = pkg.version;
  writeJson(pluginPath, plugin);
  console.log(`[bump-version] kimi.plugin.json -> ${pkg.version}`);
}
