// kimi-eyes MCP stdio server — zero-dependency.
// Speaks JSON-RPC 2.0 over LSP-style framing (Content-Length headers) on stdio.

import fs from 'node:fs';
import path from 'node:path';
import {
  VERSION,
  getConfig,
  requireConfigured,
  callVLM,
  sniffImage,
  clipboardImageToTemp,
  lookupModelCapability,
} from './vision.mjs';

const TOOLS = [
  {
    name: 'read_image',
    description:
      'Analyze a local image file using the configured vision API and return a text description. ' +
      'Use when the user provides an image path or an @ file reference and your model cannot see images directly.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Absolute path to a local image file (png, jpg, jpeg, webp, gif, bmp).',
        },
        prompt: {
          type: 'string',
          description: 'Optional instruction describing what to analyze (default: describe the image).',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'read_clipboard_image',
    description:
      'Capture the image currently in the system clipboard (e.g. a screenshot) and analyze it with the ' +
      'configured vision API. Use when the user says they just took a screenshot or copied an image and no file path is given.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Optional instruction describing what to analyze (default: describe the image).',
        },
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

/**
 * When the user declares their main model (config.mainModel) and the models.dev
 * database says it supports image input, the tools are unnecessary — the model can
 * see images natively. Refuse with a hint instead of wasting a VLM call.
 */
function assertNeedsExternalVision(cfg) {
  if (!cfg.mainModel) return;
  const cap = lookupModelCapability(cfg.mainModel);
  if (cap.known && cap.image) {
    throw new Error(
      `Model "${cfg.mainModel}" supports native image input (per the models.dev database), ` +
        `so the kimi-eyes tools are not needed. Paste the image directly and the model will see it. ` +
        `If you still want kimi-eyes active, remove "mainModel" from the kimi-eyes config.`
    );
  }
}

async function readImageTool(args) {
  const p = args?.path;
  if (typeof p !== 'string' || !p.trim()) {
    throw new Error('Missing required parameter: path');
  }
  const cfg = getConfig();
  assertNeedsExternalVision(cfg);
  const abs = path.resolve(p.trim());
  let stat;
  try {
    stat = fs.statSync(abs);
  } catch {
    throw new Error(`File not found: ${abs}`);
  }
  if (!stat.isFile()) throw new Error(`Not a file: ${abs}`);
  const img = sniffImage(abs);
  if (!img) {
    throw new Error(
      `Unsupported or invalid image file: ${abs} (supported: png, jpg, jpeg, webp, gif, bmp)`
    );
  }
  requireConfigured(cfg);
  return callVLM({ ...img, prompt: args?.prompt }, cfg);
}

async function readClipboardImageTool(args) {
  const cfg = getConfig();
  assertNeedsExternalVision(cfg);
  requireConfigured(cfg);
  let tmp = null;
  try {
    tmp = clipboardImageToTemp();
    const img = sniffImage(tmp);
    if (!img) throw new Error('Clipboard does not contain a valid image.');
    return callVLM({ ...img, prompt: args?.prompt }, cfg);
  } finally {
    if (tmp) {
      try {
        fs.unlinkSync(tmp);
      } catch {
        // best-effort cleanup
      }
    }
  }
}

async function callTool(name, args) {
  if (name === 'read_image') return readImageTool(args);
  if (name === 'read_clipboard_image') return readClipboardImageTool(args);
  throw new Error(`Unknown tool: ${name}`);
}

// ---------------------------------------------------------------------------
// JSON-RPC over stdio (MCP framing)
// ---------------------------------------------------------------------------

function send(obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
}

function sendError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

async function handleRequest(msg) {
  const { id, method, params } = msg;
  try {
    switch (method) {
      case 'initialize':
        send({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: params?.protocolVersion || '2025-06-18',
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: 'kimi-eyes', version: VERSION },
          },
        });
        return;
      case 'ping':
        send({ jsonrpc: '2.0', id, result: {} });
        return;
      case 'tools/list':
        send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
        return;
      case 'tools/call': {
        const name = params?.name;
        const args = params?.arguments || {};
        try {
          const text = await callTool(name, args);
          send({
            jsonrpc: '2.0',
            id,
            result: { content: [{ type: 'text', text }] },
          });
        } catch (err) {
          send({
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: err.message || String(err) }],
              isError: true,
            },
          });
        }
        return;
      }
      default:
        sendError(id, -32601, `Method not found: ${method}`);
    }
  } catch (err) {
    sendError(id, -32603, err.message || String(err));
  }
}

function handleMessage(msg) {
  if (!msg || typeof msg !== 'object' || typeof msg.method !== 'string') return;
  const isRequest = msg.id !== undefined && msg.id !== null;
  if (isRequest) {
    handleRequest(msg).catch((err) => sendError(msg.id, -32603, err.message || String(err)));
  }
  // Notifications (e.g. notifications/initialized) are intentionally ignored.
}

// --- framing parser ---------------------------------------------------------

let buf = Buffer.alloc(0);

function tryParseFrame() {
  const headerEnd = buf.indexOf('\r\n\r\n');
  if (headerEnd === -1) return null;
  const header = buf.subarray(0, headerEnd).toString('ascii');
  const m = /Content-Length:\s*(\d+)/i.exec(header);
  if (!m) return null;
  const len = Number(m[1]);
  const bodyStart = headerEnd + 4;
  if (buf.length < bodyStart + len) return null;
  const body = buf.subarray(bodyStart, bodyStart + len).toString('utf8');
  buf = buf.subarray(bodyStart + len);
  return body;
}

function pump() {
  for (;;) {
    const body = tryParseFrame();
    if (body === null) break;
    let msg;
    try {
      msg = JSON.parse(body);
    } catch (err) {
      console.error(`[kimi-eyes] invalid JSON frame: ${err.message}`);
      continue;
    }
    handleMessage(msg);
  }
}

process.stdin.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  pump();
});

process.stdin.on('end', () => process.exit(0));

console.error(`[kimi-eyes] MCP server started (v${VERSION}, node ${process.version})`);
