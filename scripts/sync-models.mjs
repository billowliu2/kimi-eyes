#!/usr/bin/env node
// kimi-eyes — sync the models.dev capability database into a slim local cache.
// Run this when packaging/releasing the plugin:
//
//   node scripts/sync-models.mjs
//
// Options:
//   --timeout <seconds>   curl timeout (default 180)
//   --out <path>          output file (default ./mcp/models-db.json)
//   --endpoint <url>      override the source URL (default https://models.dev/models.json)
//
// Proxy: the script uses the HTTPS_PROXY / https_proxy environment variable if set
// (for users behind Clash/V2Ray etc.), falling back to a direct connection.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const DEFAULT_ENDPOINT = 'https://models.dev/models.json';
const DEFAULT_OUT = path.join('mcp', 'models-db.json');

// Models known to support image input but missing from models.dev.
// Maintained manually — merged into the db on every sync so re-syncs never drop them.
const EXTRA_ENTRIES = {
  'k3-256k': { name: 'K3-256k', image: true },
  'kimi-k3-256k': { name: 'K3-256k', image: true },
  'moonshot/k3-256k': { name: 'K3-256k', image: true },
  'kimi-for-coding': { name: 'Kimi For Coding', image: true },
  'moonshotai/kimi-for-coding': { name: 'Kimi For Coding', image: true },
  'kimi-for-coding-highspeed': { name: 'Kimi For Coding Highspeed', image: true },
  'moonshotai/kimi-for-coding-highspeed': { name: 'Kimi For Coding Highspeed', image: true },
};

function parseArgs(argv) {
  const args = { timeout: 180, out: DEFAULT_OUT, endpoint: DEFAULT_ENDPOINT, allowFail: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--timeout') args.timeout = Number(argv[++i]) || 180;
    else if (argv[i] === '--out') args.out = argv[++i];
    else if (argv[i] === '--endpoint') args.endpoint = argv[++i];
    else if (argv[i] === '--allow-fail') args.allowFail = true;
  }
  return args;
}

function download(endpoint, outFile, timeout) {
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  const curl = ['-sSL', '--max-time', String(timeout), '-o', outFile, endpoint];
  const args = proxy ? ['-x', proxy, ...curl] : curl;
  try {
    execFileSync('curl', args, { stdio: 'inherit', timeout: (timeout + 30) * 1000 });
  } catch (err) {
    throw new Error(
      `Failed to download ${endpoint}${proxy ? ` via proxy ${proxy}` : ''}. ` +
        `If you are behind a proxy, set HTTPS_PROXY (e.g. HTTPS_PROXY=http://127.0.0.1:7897). ` +
        `(${err.message.split('\n')[0]})`
    );
  }
}

const args = parseArgs(process.argv.slice(2));
const tmpFile = path.join(os.tmpdir(), `models-dev-${Date.now()}.json`);

console.log(`[sync-models] downloading ${args.endpoint} ...`);
try {
  download(args.endpoint, tmpFile, args.timeout);
} catch (err) {
  if (args.allowFail) {
    console.error(`[sync-models] WARN: sync failed, keeping existing db: ${err.message.split('\n')[0]}`);
    process.exit(0);
  }
  throw err;
}

const raw = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
  fs.rmSync(tmpFile, { force: true });
  throw new Error(`Unexpected response shape from ${args.endpoint} (expected a flat model map).`);
}

// Slim down: keep only what the plugin needs.
const slim = {};
let imageCount = 0;
for (const [id, m] of Object.entries(raw)) {
  if (!m || typeof m !== 'object') continue;
  const input = Array.isArray(m.modalities?.input) ? m.modalities.input : [];
  const image = input.includes('image');
  if (image) imageCount++;
  slim[id] = { name: typeof m.name === 'string' ? m.name : id, image };
}
// Merge manual extras (they override the downloaded data on id collisions).
for (const [id, m] of Object.entries(EXTRA_ENTRIES)) {
  slim[id] = m;
  if (m.image) imageCount++;
}

fs.rmSync(tmpFile, { force: true });
fs.mkdirSync(path.dirname(args.out), { recursive: true });
fs.writeFileSync(args.out, `${JSON.stringify(slim)}\n`, 'utf8');

const kb = (fs.statSync(args.out).size / 1024).toFixed(0);
console.log(
  `[sync-models] wrote ${Object.keys(slim).length} models (${imageCount} support image input) to ${args.out} (${kb} KB)`
);
