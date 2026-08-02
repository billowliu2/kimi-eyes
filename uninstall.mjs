#!/usr/bin/env node
// kimi-eyes uninstall — 撤销 setup.mjs + `/plugins install` 的所有落盘痕迹。
// Zero-dependency: 仅内置模块；交互确认 TTY 用 readline，非 TTY 走默认值。
//
// 清理范围（KIMI_CODE_HOME 或 ~/.kimi-code）：
//   [1] plugins/installed.json 中的 kimi-eyes 条目（改前备份）
//   [2] plugins/managed/kimi-eyes/ 安装副本
//   [3] kimi-eyes/config.json 配置目录（含 VLM API Key，需二次确认）
//
// 用法：
//   node uninstall.mjs          交互确认
//   node uninstall.mjs --yes    跳过全部确认（脚本化）
//   node uninstall.mjs --dry-run 只预览将要执行的操作

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import process from 'node:process';

const args = process.argv.slice(2);
const YES = args.includes('--yes');
const DRY_RUN = args.includes('--dry-run');

const PLUGIN_ID = 'kimi-eyes';
const home = process.env.KIMI_CODE_HOME || path.join(os.homedir(), '.kimi-code');
const installedJsonPath = path.join(home, 'plugins', 'installed.json');
const managedDir = path.join(home, 'plugins', 'managed', PLUGIN_ID);
const configDir = path.join(home, PLUGIN_ID);

// ---------------------------------------------------------------------------
// 交互确认（TTY 用 readline；非 TTY / --yes 返回默认值）
// ---------------------------------------------------------------------------

async function confirm(query, def = false) {
  if (YES) return true;
  if (!process.stdin.isTTY) return def;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const ans = (await rl.question(query)).trim().toLowerCase();
    if (ans === 'y' || ans === 'yes') return true;
    if (ans === 'n' || ans === 'no') return false;
    return def;
  } finally {
    rl.close();
  }
}

// ---------------------------------------------------------------------------
// 检查残留
// ---------------------------------------------------------------------------

function installedEntry() {
  if (!fs.existsSync(installedJsonPath)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(installedJsonPath, 'utf8'));
    const list = Array.isArray(data?.plugins) ? data.plugins : [];
    return list.find((p) => p?.id === PLUGIN_ID) ?? null;
  } catch {
    return null; // JSON 无效时按无条目处理，但保留文件不动
  }
}

const hasInstalledEntry = () => installedEntry() !== null;
const hasManagedDir = () => fs.existsSync(managedDir);
const hasConfigDir = () => fs.existsSync(configDir);

// ---------------------------------------------------------------------------
// 执行清理
// ---------------------------------------------------------------------------

function removeInstalledEntry() {
  if (!hasInstalledEntry()) return { status: 'skip', detail: 'installed.json 无 kimi-eyes 条目' };
  try {
    const data = JSON.parse(fs.readFileSync(installedJsonPath, 'utf8'));
    if (!Array.isArray(data?.plugins)) throw new Error('plugins 字段缺失或非数组');
    const before = data.plugins.length;
    data.plugins = data.plugins.filter((p) => p?.id !== PLUGIN_ID);
    if (data.plugins.length === before) return { status: 'skip', detail: 'installed.json 无 kimi-eyes 条目' };
    if (DRY_RUN) return { status: 'would-remove', detail: `移除 ${before} → ${data.plugins.length} 个插件条目` };
    const backup = `${installedJsonPath}.bak.uninstall-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    fs.copyFileSync(installedJsonPath, backup);
    fs.writeFileSync(installedJsonPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    return { status: 'done', detail: `已移除条目，备份: ${path.basename(backup)}` };
  } catch (err) {
    return { status: 'error', detail: `installed.json 处理失败，未改动: ${err.message}` };
  }
}

function removeManagedDir() {
  if (!hasManagedDir()) return { status: 'skip', detail: 'managed 安装副本不存在' };
  if (DRY_RUN) return { status: 'would-remove', detail: `删除目录 ${managedDir}` };
  try {
    fs.rmSync(managedDir, { recursive: true, force: true });
    if (fs.existsSync(managedDir)) {
      // 目录壳被占用（如插件正被会话加载），内容通常已清空
      return { status: 'warn', detail: `目录被占用未完全删除，重启 kimi-code 会话后执行: rmdir "${managedDir}"` };
    }
    return { status: 'done', detail: '已删除安装副本' };
  } catch (err) {
    return { status: 'warn', detail: `删除失败（可能被会话占用），重启后手动删除: ${err.message}` };
  }
}

function removeConfigDir() {
  if (!hasConfigDir()) return { status: 'skip', detail: '配置目录不存在' };
  if (DRY_RUN) return { status: 'would-remove', detail: `删除配置目录 ${configDir}（含 VLM API Key）` };
  try {
    fs.rmSync(configDir, { recursive: true, force: true });
    return { status: 'done', detail: '已删除配置目录（含 VLM API Key）' };
  } catch (err) {
    return { status: 'warn', detail: `删除失败: ${err.message}` };
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('=== Kimi Eyes 卸载 ===');
  console.log(`操作目录: ${home}\n`);

  if (DRY_RUN) console.log('(--dry-run 模式：仅预览，不执行任何修改)\n');

  const pending = [];
  if (hasInstalledEntry()) pending.push('  [1] plugins/installed.json 中的 kimi-eyes 条目（改前备份）');
  if (hasManagedDir()) pending.push(`  [2] 安装副本 ${managedDir}`);
  if (hasConfigDir()) pending.push(`  [3] 配置目录 ${configDir}（含 VLM API Key）`);

  if (pending.length === 0) {
    console.log('已卸载或无需清理（installed.json / managed 副本 / 配置目录均无残留）。');
    console.log('如在 Claude Code 中挂载过，请手动执行: claude mcp remove kimi-eyes');
    return;
  }

  console.log('将清理：');
  console.log(pending.join('\n'));

  if (DRY_RUN) {
    console.log('\n(--dry-run 结束，未做任何修改)');
    return;
  }

  if (!(await confirm('\n确认卸载？[y/N] ', false))) {
    console.log('已取消，未做任何修改。');
    return;
  }

  const results = [];
  results.push(removeInstalledEntry());
  results.push(removeManagedDir());

  if (hasConfigDir()) {
    if (await confirm('  配置目录含你的 VLM API Key，确认一并删除？[y/N] ', false)) {
      results.push(removeConfigDir());
    } else {
      results.push({ status: 'skip', detail: '用户选择保留配置目录（请自行处理其中密钥）' });
    }
  } else {
    results.push({ status: 'skip', detail: '配置目录不存在' });
  }

  console.log('\n执行结果：');
  for (const r of results) {
    const icon = r.status === 'done' ? '✓' : r.status === 'warn' ? '⚠' : r.status === 'error' ? '✗' : '·';
    console.log(`  ${icon} ${r.detail}`);
  }

  console.log('\n完成。请重启 kimi-code 会话（或 /reload）使卸载完全生效。');
  console.log('如在 Claude Code 中挂载过，请手动执行: claude mcp remove kimi-eyes');

  if (results.some((r) => r.status === 'error')) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`\n[uninstall] 出错: ${err.message}`);
  process.exit(1);
});
