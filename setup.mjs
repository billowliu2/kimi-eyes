#!/usr/bin/env node
// kimi-eyes setup wizard — interactive one-time configuration.
// Zero-dependency: raw-mode stdin input + native fetch.
//
// Flow: choose protocol → base URL → API key → pick multimodal model → verify → write config.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { callVLM, modelsEndpoint, ONE_PX_PNG_BASE64, modelCapabilityTag } from './mcp/vision.mjs';

// ---------------------------------------------------------------------------
// Raw-mode line input (supports masked echo)
// ---------------------------------------------------------------------------

let pipeLines = null;
function ensurePipeLines() {
  if (!pipeLines) {
    pipeLines = new Promise((resolve, reject) => {
      let s = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (c) => (s += c));
      process.stdin.on('end', () => resolve(s.split(/\r?\n/)));
      process.stdin.on('error', reject);
      process.stdin.resume();
    });
  }
  return pipeLines;
}

function ask(query, { hidden = false } = {}) {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    // Non-TTY fallback (piped input in tests/CI): plain line read, no masking.
    process.stdout.write(query);
    return ensurePipeLines().then((lines) => lines.shift() ?? '');
  }
  process.stdout.write(query);
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise((resolve) => {
    let val = '';
    let esc = false;
    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.removeListener('data', onData);
      process.stdout.write('\n');
    };
    const onData = (chunk) => {
      for (const ch of chunk.toString('utf8')) {
        if (esc) {
          if ((ch >= 'A' && ch <= 'D') || ch === '~') esc = false;
          continue;
        }
        if (ch === '\u001b') {
          esc = true;
          continue;
        }
        if (ch === '\r' || ch === '\n') {
          cleanup();
          resolve(val);
          return;
        }
        if (ch === '\u0003') process.exit(130);
        if (ch === '\u007f' || ch === '\b') {
          if (val.length > 0) {
            val = val.slice(0, -1);
            process.stdout.write('\b \b');
          }
          continue;
        }
        val += ch;
        process.stdout.write(hidden ? '*' : ch);
      }
    };
    stdin.on('data', onData);
  });
}

async function askRequired(query, { hidden = false, validate = null } = {}) {
  for (;;) {
    const v = (await ask(query, { hidden })).trim();
    if (!v) {
      console.log('  输入不能为空，请重试。');
      continue;
    }
    if (validate) {
      const err = validate(v);
      if (err) {
        console.log(`  ${err}`);
        continue;
      }
    }
    return v;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VISION_HINTS =
  /(vision|visual|vlm|multimodal|4o|omni|glm-4v|qwen-vl|qwen2.*?vl|internvl|minicpm|gpt-4v|gpt-5|claude-3|claude-sonnet|claude-opus|gemini)/i;

async function fetchModels(protocol, baseUrl, apiKey) {
  const url = modelsEndpoint(baseUrl, protocol);
  const headers =
    protocol === 'anthropic'
      ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
      : { Authorization: `Bearer ${apiKey}` };
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const list = Array.isArray(data?.data)
    ? data.data.map((m) => m.id || m.name).filter((x) => typeof x === 'string' && x)
    : [];
  if (list.length === 0) throw new Error('接口未返回任何模型');
  return [...new Set(list)];
}

async function chooseProtocol() {
  console.log('  选择视觉 API 协议：');
  console.log('    [1] OpenAI 兼容 (Chat Completions)');
  console.log('    [2] Anthropic (Messages API)');
  for (;;) {
    const v = (await ask('  输入序号 [1/2]: ')).trim();
    if (v === '1') return 'openai';
    if (v === '2') return 'anthropic';
    console.log('  无效输入，请输入 1 或 2。');
  }
}

async function chooseModel(protocol, baseUrl, apiKey) {
  console.log('  拉取模型列表 ...');
  let models = null;
  try {
    models = await fetchModels(protocol, baseUrl, apiKey);
  } catch (err) {
    console.log(`  拉取模型列表失败 (${err.message})，将改为手动输入模型名。`);
  }
  if (models) {
    const shown = models.slice(0, 50);
    console.log(
      `  可用模型 (✓视觉=支持识图 / 文本=纯文本 / ★疑似=未收录按关键词猜测): ` +
        `${models.length > 50 ? `显示前 50 / 共 ${models.length}` : ''}`
    );
    shown.forEach((m, i) => {
      const tag = modelCapabilityTag(m, VISION_HINTS);
      console.log(`    [${String(i + 1).padStart(3)}] ${m}${tag ? ` ${tag}` : ''}`);
    });
    console.log('  输入序号选择模型，或直接输入自定义模型名。');
    for (;;) {
      const v = (await ask('  模型: ')).trim();
      if (v === '') {
        console.log('  输入不能为空。');
        continue;
      }
      const idx = Number.parseInt(v, 10);
      if (!Number.isNaN(idx) && idx >= 1 && idx <= shown.length) return shown[idx - 1];
      return v; // treat as custom model name
    }
  }
  return askRequired('  模型名: ');
}

async function verifyModel(cfg) {
  console.log('  视觉验证：发送 1×1 测试图到模型 ...');
  try {
    const text = await callVLM(
      { imageBase64: ONE_PX_PNG_BASE64, mediaType: 'image/png', prompt: 'Reply with the single word OK.' },
      cfg
    );
    console.log(`  ✓ 通过，模型可接收图片 (返回: ${text.slice(0, 60)})`);
    return true;
  } catch (err) {
    console.log(`  ✗ 失败: ${err.message.slice(0, 200)}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const home = process.env.KIMI_CODE_HOME || path.join(os.homedir(), '.kimi-code');
  const configPath = path.join(home, 'kimi-eyes', 'config.json');

  console.log('=== Kimi Eyes 配置向导 ===');
  console.log(`配置将写入: ${configPath}\n`);

  const protocol = await chooseProtocol();
  const baseUrl = await askRequired('  视觉 API BaseUrl (如 https://api.openai.com/v1): ', {
    validate: (v) => (/^https?:\/\//i.test(v) ? null : 'BaseUrl 必须以 http:// 或 https:// 开头。'),
  });
  const apiKey = await askRequired('  API Key: ', { hidden: true });
  const model = await chooseModel(protocol, baseUrl, apiKey);

  const cfg = { protocol, baseUrl, apiKey, model };

  console.log('');
  for (let attempt = 0; attempt < 3; attempt++) {
    if (await verifyModel(cfg)) break;
    if (attempt === 2) {
      console.log('  连续验证失败，跳过验证（配置仍将写入）。');
      break;
    }
    const act = (await ask('  [r] 重试  [c] 换模型  [s] 跳过验证: ')).trim().toLowerCase();
    if (act === 'c') {
      cfg.model = await chooseModel(protocol, baseUrl, apiKey);
      continue;
    }
    if (act === 's') break;
    // 'r' or anything else → retry the loop
  }

  const mainModel = (await ask('  当前主模型名（可选，用于触发判断；留空跳过）: ')).trim();
  if (mainModel) cfg.mainModel = mainModel;

  const dir = path.dirname(configPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(cfg, null, 2)}\n`, 'utf8');
  if (process.platform !== 'win32') fs.chmodSync(configPath, 0o600);

  console.log('');
  console.log(`✓ 配置已写入: ${configPath}`);
  console.log(`  protocol: ${cfg.protocol}`);
  console.log(`  baseUrl : ${cfg.baseUrl}`);
  console.log(`  model   : ${cfg.model}`);
  if (cfg.mainModel) console.log(`  mainModel: ${cfg.mainModel} (触发判断用)`);
  console.log('');
  console.log('下一步：');
  console.log(`  1. 安装插件: /plugins install ${process.cwd()}`);
  console.log('  2. 启用插件: /reload');
  console.log('  3. 开始使用: 非多模态模型下 @图片路径 或 截图后提问');
}

main().catch((err) => {
  console.error(`\n[setup] 出错: ${err.message}`);
  process.exit(1);
});
