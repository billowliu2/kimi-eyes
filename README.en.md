# Kimi Eyes 👀

> [中文](README.md) | English

Give **non-multimodal models** in Kimi Code the ability to analyze images and
screenshots (inspired by [opencode-vision](https://github.com/JochenYang/opencode-vision),
but thinner: no hooks, no message transforms, no leftover state).

**How it works**: the plugin declares an MCP stdio server exposing two tools —
`read_image` (read a local image) and `read_clipboard_image` (read a clipboard
screenshot) — and a `SYSTEM.md` guide tells the model when to call them. The server
sends the image to your own vision API (OpenAI-compatible or Anthropic protocol) and
returns the text description.

```
Multimodal models: paste with Alt+V, see natively — the plugin stays idle.
Non-multimodal models: @image-path / "analyze this screenshot"
  → model calls mcp__kimi-eyes__read_image / read_clipboard_image
  → your VLM returns a description
```

## Prerequisites

- Kimi Code CLI (with `/plugins` and MCP support)
- Node.js ≥ 18 (`node --version`; native `fetch` requires 18+)
- A multimodal vision API of your own (OpenAI-compatible `chat/completions`, or
  Anthropic `messages`) — you provide the key

## Compatibility

**The plugin puts no restriction on your main model.** No matter which model your
Kimi Code session is running, or which provider it comes from, as long as it lacks
native image input (`image_in`), this plugin adds vision to it:

- **Common non-multimodal models**: DeepSeek (`deepseek-chat`), Qwen text-only
  (`qwen-plus` / `qwen-turbo`), Llama text variants, and locally deployed text
  models (Ollama / vLLM, etc.)
- **Any third-party model**: any OpenAI-compatible or custom model configured in
  Kimi Code — if it cannot see images natively, the plugin guides it to call the
  vision tools whenever an image is involved
- **Multimodal models**: skipped automatically (paste with Alt+V, see natively)

Vision capability is provided by the **VLM you configure**, fully decoupled from
the main model:

| Protocol | Example vision models |
| --- | --- |
| OpenAI-compatible | qwen-vl series, GLM-4V, GPT-4o / GPT-5 compatible endpoints, Gemini-compatible endpoints, etc. |
| Anthropic | Claude 3.5 / 3.7 / 4 series, etc. |

In short: **the main model handles text, the external VLM handles images.** When
configuring, just pick the protocol that matches your vision API provider (step 1
of the setup wizard); everything else is automatic.

## Quick start

### 1. Install the plugin

In a Kimi Code session (any of these):

```
# From GitHub (recommended)
/plugins install https://github.com/billowliu2/kimi-eyes

# From a local directory
/plugins install D:\AIGC\Plugin\kimi-eyes
```

### 2. Configure the vision API (one-time)

Run the setup wizard (any of these):

```
# One-shot via npm
npx kimi-eyes setup

# From the local plugin directory
cd D:\AIGC\Plugin\kimi-eyes
node setup.mjs
```

The wizard walks you through: **choose protocol (OpenAI-compatible / Anthropic) →
enter Base URL → enter API Key (masked input) → fetch model list and pick a
multimodal model → 1×1 image vision check → optionally enter your main model name
(for trigger decisions) → write config**.

- The model list is fetched from `GET {BaseUrl}/models`; entries are tagged
  **"✓vision / text"** using the bundled models.dev database, with a "★guess" fallback
  for models the database does not know; if fetching fails it falls back to manual entry
- The vision check must pass before the config is saved, so you never end up with a
  model that rejects images
- The last step asks for your **main model name** (optional): the plugin looks it up in
  models.dev, and if that model supports native image input the tools refuse with a
  hint — the code-level "multimodal → don't trigger" switch (see
  [Triggering](#triggering-everyday-fully-automatic))
- Config is written to `~/.kimi-code/kimi-eyes/config.json` (`chmod 600` on
  non-Windows systems)

### 3. Enable

```
/reload
```

The MCP server starts automatically with the session.

### 4. Use it

| Scenario | Action |
| --- | --- |
| Multimodal model | Paste with Alt+V directly — native vision, plugin not involved |
| Non-multimodal + image path | Type `@screenshot.png` or paste the path; the model calls `read_image` |
| Non-multimodal + just screenshotted/copied | Do **not** Alt+V paste (the CLI rejects pasting on non-multimodal models with `Current model does not support image input`); just ask "analyze this screenshot" — the model calls `read_clipboard_image` to read the system clipboard |

## Activation and triggering

### Activation (one-time)

```
/plugins install D:\AIGC\Plugin\kimi-eyes   # 1. Install
/reload                                     # 2. Enable (or start a new session with /new)
```

Once enabled, the MCP server starts automatically with every session — there is no
separate "turn on the feature" step. To verify:

- `/plugins list` → kimi-eyes should show as enabled
- `/mcp` → the kimi-eyes server should show as connected
- `/plugins info kimi-eyes` → should show no diagnostics errors

### Triggering (everyday, fully automatic)

The plugin is **passive**: `SYSTEM.md` plants the rules into the model, and the model
calls the tools automatically at the right moment — you do nothing:

| Signal (anything in the message) | Model's automatic behavior |
| --- | --- |
| Image-format path or `@` reference (`.png/.jpg/.jpeg/.webp/.gif/.bmp`) | **Hard trigger**: unconditionally calls `read_image(path)`, regardless of wording |
| Media content you cannot interpret (e.g. a pasted image) | Ignores that media part, calls `read_clipboard_image()` (the pasted image is almost always still in the clipboard) |
| Wording implies image content: image / screenshot / photo / UI / chart / CAPTCHA / OCR, etc., but no path | Calls `read_clipboard_image()` |
| Model natively supports `image_in` (multimodal) | Skips all rules, sees images natively, never calls the tools |

**Triggering does not depend on fixed wording** — the user does not need to say
"analyze the image". Image-format paths are an **unconditional hard trigger**; when
in doubt, the model is instructed to call a tool rather than guess.

**On model-capability detection**: Kimi Code does not expose "is the current model
multimodal?" to plugins, so this plugin provides two layers:

- **Code-level (recommended)**: declare `mainModel` in the config (last wizard step,
  or the `VISION_MAIN_MODEL` environment variable). The plugin looks it up in the
  bundled models.dev database — if it supports image input, the tools refuse with a
  hint ("paste the image directly"); if it is text-only, the tools proceed normally.
- **Prompt-level**: without `mainModel`, the SYSTEM.md explicit skip rule handles it
  (the model recognizes its own capability).

Both layers are fail-safe: a wrong judgment costs at most one wasted external call
(a multimodal model calling a tool) or a missed trigger (a text model — covered by
the path/semantic signals). For a hard switch, simply `/plugins disable kimi-eyes`
when running multimodal models.

**The first tool call prompts one approval** (MCP tool permission): choose *Approve
for this session* to skip prompts for the rest of the session; for permanent
approval, add to `~/.kimi-code/config.toml`:

```toml
[[permission.rules]]
decision = "allow"
pattern = "mcp__kimi-eyes__*"
```

A successful trigger looks like: a tool call appears in the TUI before the answer,
and the model then answers based on the returned description. If the model does not
call the tool on its own (e.g. you pasted a path without asking a question), just
command it: "Call the read_image tool to analyze D:\xxx.png".

## Environment variables (optional; override the config file)

| Variable | Description | Priority |
| --- | --- | --- |
| `VISION_API_PROTOCOL` | `openai` or `anthropic`; force the protocol | Higher than config file |
| `VISION_API_KEY` | API key | Higher than config file |
| `VISION_API_URL` | Base URL | Higher than config file |
| `VISION_MODEL` | Model name | Higher than config file |
| `VISION_MAIN_MODEL` | Your main model name (optional), used for trigger decisions | Higher than config file |
| `VISION_MAX_TOKENS` | Max tokens for the vision response (default 1024) | — |
| `VISION_FETCH_TIMEOUT_MS` | Request timeout in ms (default 60000) | — |

> When an environment variable conflicts with `config.json`, the variable wins. If
> neither is set, the tools return a clear error pointing at `setup.mjs`.
> Variable names are compatible with opencode-vision, so migrating is trivial.

## Protocol details

| | OpenAI-compatible | Anthropic |
| --- | --- | --- |
| Request endpoint | `{BaseUrl}/chat/completions` (`/v1` auto-appended) | `{BaseUrl}/v1/messages` |
| Auth | `Authorization: Bearer <Key>` | `x-api-key: <Key>` + `anthropic-version: 2023-06-01` |
| Image payload | `image_url` + base64 data URL | `source: {type:"base64"}` |
| Model list | `GET {BaseUrl}/models` | `GET {BaseUrl}/v1/models` (not an official Anthropic endpoint; falls back to manual entry) |

## Model capability database (models.dev)

The plugin ships a slim capability cache `mcp/models-db.json` synced from
[models.dev](https://models.dev) (currently 279+ models, tagged with whether each
supports image input, ~19 KB). It powers two things:

- **Exact tagging** in the setup wizard's model picker ("✓vision / text"), replacing
  pure keyword guessing
- The **code-level trigger switch**: once `mainModel` is declared, the plugin checks
  whether your main model is multimodal

**Sync at packaging time** (the data evolves — run before each release):

```
node scripts/sync-models.mjs
```

- Source: `https://models.dev/models.json`
- Behind a proxy: set `HTTPS_PROXY`, e.g. `HTTPS_PROXY=http://127.0.0.1:7897 node scripts/sync-models.mjs`
- Options: `--timeout <seconds>` (default 180), `--out <path>` (default
  `mcp/models-db.json`), `--endpoint <URL>`
- Matching strategy: exact id → `provider/model-name` suffix → case-insensitive name
- **Unknown models**: lookup returns unknown — the wizard falls back to keyword
  guessing ("★guess") and triggering falls back to the SYSTEM.md rules; nothing breaks
- **Manual extras**: models.dev does not list every vision model (e.g. `k3-256k`,
  `kimi-for-coding`). Keep them in `EXTRA_ENTRIES` inside
  `scripts/sync-models.mjs` — every sync merges them in, so re-syncs never drop them

## Tools

| Tool | Arguments | Description |
| --- | --- | --- |
| `read_image` | `path` (required), `prompt` (optional) | Validates the file is an image (extension + magic bytes), then calls the VLM |
| `read_clipboard_image` | `prompt` (optional) | Captures the clipboard image to a temp file, calls the VLM, deletes the temp file |

Clipboard capture depends on the platform: Windows uses PowerShell (built-in),
macOS needs `pngpaste` (`brew install pngpaste`), Linux needs `wl-paste` (Wayland)
or `xclip` (X11).

## Troubleshooting

- **Alt+V paste reports `Current model does not support image input`** → that is the
  Kimi Code CLI rejecting pastes on non-multimodal models. Use `@image-path`
  (`read_image`) instead, or screenshot and ask directly (`read_clipboard_image`
  reads the clipboard)
- **Tool returns "Vision API is not configured"** → run `node setup.mjs`, or set
  `VISION_API_KEY` / `VISION_API_URL` / `VISION_MODEL`
- **Model list fetch fails** (404/401) → the wizard falls back to manual entry; if
  your provider has no `/models` endpoint, just type the model name
- **Vision check fails** → pick a model that really accepts image input (e.g.
  `qwen-vl-max`, `glm-4v`, `gpt-4o`, `claude-3-5-sonnet` — check your provider's docs)
- **`read_clipboard_image` errors** → make sure the clipboard actually holds an image
  (Ctrl+C an image or Win+Shift+S a screenshot first); on macOS/Linux check the
  platform tool above is installed
- **Tools not showing up after install** → verify the plugin is enabled
  (`/plugins list`) and run `/reload` or start a new session

## Security notes

- `config.json` stores your API key in plain text (`600` perms on non-Windows);
  never commit it to a repository
- `read_clipboard_image` reads the system clipboard — it may contain sensitive
  content you just copied. The tool call goes through the approval flow, so you
  decide when it runs
- This project ships no credentials; vision requests go only to the Base URL you
  configured

## Limitations

- No subagent delegation: Kimi Code's `model_preference` only supports
  primary/secondary (it cannot name a specific vision model the way opencode can),
  so the value is limited
- No `UserPromptSubmit` hook fallback: the `SYSTEM.md` guide covers the common
  cases; if paste/reference behavior misbehaves in your TUI, a hook can be
  re-evaluated then

## License

MIT
