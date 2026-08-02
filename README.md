# Kimi Eyes 👀

> [English](README.en.md) | 中文

让 KimiCode 的**非多模态模型**也能分析图片与截图（借鉴 [opencode-vision](https://github.com/JochenYang/opencode-vision) 的思路，但更薄：无 hook、无消息变换、无状态残留）。

**核心机制**：插件声明一个 MCP stdio 服务器，暴露两个工具——`read_image`（读本地图片）与 `read_clipboard_image`（读剪贴板截图），经 `SYSTEM.md` 引导模型调用；服务器按你配置的协议（OpenAI 兼容 / Anthropic）把图片发给你自己配置的多模态 API，返回文本描述。

```
多模态模型：Alt+V 粘贴即看，插件自动闲置
非多模态模型：@图片路径 / 截图后提问 → 模型调 mcp__kimi-eyes__read_image / read_clipboard_image → 你的 VLM 返回描述
```

## 前置要求

- KimiCode CLI（本插件通过插件机制加载，需支持 `/plugins` 与 MCP）
- Node.js ≥ 18（`node --version` 检查；原生 fetch 需要 18+）
- 一个支持视觉输入的多模态 API（OpenAI 兼容 `chat/completions`，或 Anthropic `messages`），Key 由你自己提供

## 适用范围

**本插件对主模型没有任何限制**——无论你的 KimiCode 当前用哪个模型、来自哪家服务商，只要它不具备原生图片输入能力（`image_in`），本插件就能为它补上视觉：

- **常见非多模态模型**：DeepSeek（deepseek-chat）、Qwen 纯文本版（qwen-plus / qwen-turbo）、Llama 文本系列、以及本地部署的文本模型（Ollama / vLLM 等）
- **任何第三方模型**：通过 KimiCode 配置的任意 OpenAI 兼容或自定义模型，只要它原生不看图，插件就会在消息含图片时引导模型调用视觉工具
- **多模态模型**：自动跳过（Alt+V 粘贴即看，插件闲置）

视觉能力由**你自己配置的 VLM** 提供，与主模型完全解耦：

| 协议 | 常见视觉模型示例 |
| --- | --- |
| OpenAI 兼容 | qwen-vl 系列、GLM-4V、GPT-4o / GPT-5 兼容端点、Gemini 兼容端点等 |
| Anthropic | Claude 3.5 / 3.7 / 4 系列等 |

一句话：**主模型只管理解文字，看图交给外部 VLM**。配置时只需在 setup 向导第一步选择与你视觉 API 服务商匹配的协议，其余全部自动。

## 快速开始

### 1. 安装插件

在 KimiCode 会话里执行（任选一种）：

```
# 方式一：从 GitHub 安装（推荐）
/plugins install https://github.com/billowliu2/kimi-eyes

# 方式二：从本地目录安装
/plugins install D:\AIGC\Plugin\kimi-eyes
```

### 2. 配置视觉 API（一次性）

运行配置向导（任选一种）：

```
# npm 一键运行
npx kimi-eyes setup

# 本地插件目录运行
cd D:\AIGC\Plugin\kimi-eyes
node setup.mjs
```

向导按顺序引导：**选择协议（OpenAI 兼容 / Anthropic）→ 填写 BaseUrl → 填写 API Key（掩码输入）→ 拉取模型列表选择多模态模型 → 1×1 图片视觉验证 → 可选填写当前主模型名（用于触发判断）→ 写入配置**。

- 模型列表自动从 `GET {BaseUrl}/models` 拉取，用内置的 models.dev 数据库**精确标注「✓视觉 / 文本」**，未收录的按关键词标「★疑似」；拉取失败时回退为手动输入
- 视觉验证通过才落盘，防止配到一个不收图片的模型
- 最后一步可填写**当前主模型名**（可选）：插件用 models.dev 判定后，若该模型支持原生识图，工具会直接提示无需调用——即「多模态不触发」的代码级判断（详见[触发](#触发日常全自动)）
- 配置写入 `~/.kimi-code/kimi-eyes/config.json`（类 Unix 系统自动 `chmod 600`）

### 3. 启用

```
/reload
```

MCP 服务器会随会话自动启动。

### 4. 使用

| 场景 | 操作 |
| --- | --- |
| 多模态模型 | 直接 Alt+V 粘贴图片，原生看图，插件不参与 |
| 非多模态 + 有图片路径 | 输入 `@截图.png` 或直接给路径，模型自动调 `read_image` |
| 非多模态 + 刚截图/复制 | 直接提问「分析这张截图」，模型自动调 `read_clipboard_image` 读系统剪贴板 |
| 非多模态 + 想用 Alt+V 粘贴 | 需先在 config.toml 给模型声明 `image_in`（见下），粘贴后直接提问即可——模型看不懂图片内容时会自动调 `read_clipboard_image`（剪贴板仍保留原图） |
| 粘贴被拦截 | 直接告诉模型「我粘贴图片被拦截了」，模型会自动改读剪贴板，无需你保存文件 |

#### 想用 Alt+V 粘贴？（给模型声明 `image_in`）

KimiCode 前端默认会拦截「不支持图片输入」模型的粘贴。在 `~/.kimi-code/config.toml` 给对应模型加上 `image_in` 即可放行：

```toml
[models."opencode-go/deepseek-v4-flash"]
capabilities = [ "thinking", "tool_use", "image_in" ]   # 追加 image_in
```

> 注意：声明 `image_in` 只是让前端放行粘贴。纯文本模型依然**看不懂**图片内容——这正是插件的用武之地：模型收到图片但看不见内容时，会按 SYSTEM.md 规则自动调 `read_clipboard_image` 从剪贴板读图。**全程零命令、零前缀**。

## 激活与触发

### 激活（一次性）

```
/plugins install D:\AIGC\Plugin\kimi-eyes   # 1. 安装
/reload                                     # 2. 启用（或 /new 新开会话）
```

启用后 MCP 服务器随每个会话自动启动，没有单独的「开启功能」步骤。验证方式：

- `/plugins list` → kimi-eyes 状态应为 enabled
- `/mcp` → kimi-eyes 服务器应显示 connected
- `/plugins info kimi-eyes` → 应无诊断错误

### 触发（日常，全自动）

插件是**被动式**的：`SYSTEM.md` 为模型植入规则，模型在合适时机自动调用工具，无需手动操作：

| 信号（消息里的任何一项） | 模型自动行为 |
| --- | --- |
| 图片格式路径或 `@` 引用（`.png/.jpg/.jpeg/.webp/.gif/.bmp`） | **硬触发**：无条件调 `read_image(path)`，与提问语料无关 |
| 消息里有你无法解读的媒体内容（如粘贴的图片） | 忽略该媒体 part，自动调 `read_clipboard_image()` 读剪贴板（粘贴后剪贴板仍保留原图） |
| 提问语义涉及图像内容：图 / 截图 / 照片 / 界面 / 图表 / 验证码 / OCR 等，但无路径 | 自动调 `read_clipboard_image()`，**不会要求你重发** |
| 粘贴被拦截（报 `Current model does not support image input`） | 直接告诉模型，它会改调 `read_clipboard_image`（剪贴板仍保留原图） |
| 模型真正能看懂图片内容（多模态） | 跳过全部规则，原生看图，不调工具 |

**触发不依赖固定语料、不依赖任何命令前缀**——用户不需要说「分析这个图片」，也不需要 `/skill` 之类的指令。图片格式路径是**无条件硬触发**；模型判断「自己看不见图片内容」或「用户想看图但消息里没有」时，会自动调工具而不是瞎猜或让你重发（SYSTEM.md 里的明确规则）。

**关于模型能力判断**：KimiCode 不向插件暴露「当前模型是否多模态」的信号，本插件提供两层判断：

- **代码级（推荐）**：在配置里声明 `mainModel`（setup 向导最后一步，或环境变量 `VISION_MAIN_MODEL`），插件用内置的 models.dev 数据库判断——命中且支持识图 → 工具直接提示「你是多模态模型，直接粘贴看图」；命中且纯文本 → 正常走工具
- **引导级**：未声明 `mainModel` 时，靠 SYSTEM.md 的显式跳过规则（模型自我识别）

两层都是 fail-safe：判断错误最坏只是多一次外部调用（多模态误调）或漏调（文本模型漏调可用路径/语义信号补上）。若想硬性关闭，多模态场景可直接 `/plugins disable kimi-eyes`。

## Claude Code 使用（可选）

kimi-eyes 的 MCP 服务器是标准 MCP，可直接挂载到 Claude Code。**注意：以下命令请在系统终端（PowerShell / Git Bash）执行，不要在 Claude Code 内部的 Bash 工具里执行**（内部环境解析 `--scope` 等参数有差异）。

### 1. 前置要求

- Node.js ≥ 18
- Claude Code CLI（`claude --version`）
- 一个支持视觉的多模态 API（Key 由你自己提供）

### 2. 挂载 MCP 服务器（任选其一）

```bash
# 方式一：全局注册（user scope，所有项目可用）
claude mcp add --scope user kimi-eyes -- node D:\AIGC\Plugin\kimi-eyes\mcp\server.mjs

# 方式二：仅当前项目
claude mcp add kimi-eyes -- node D:\AIGC\Plugin\kimi-eyes\mcp\server.mjs

# 方式三：npx 通用版（不依赖本地路径，任何机器可复制）
claude mcp add --scope user kimi-eyes -- npx --prefer-online -y -p kimi-eyes kimi-eyes-mcp
```

### 3. 配置视觉 API（一次性）

```bash
npx kimi-eyes setup
```

> 复用同一份配置：kimi-eyes 在 KimiCode 和 Claude Code 下共用 `~/.kimi-code/kimi-eyes/config.json`（或环境变量 `VISION_*`）。

### 4. 引导规则（CLAUDE.md）

在项目根目录创建 `CLAUDE.md`（或追加到已有的），内容可参考本仓库根目录的 `CLAUDE.md`。核心规则：

```markdown
# Kimi Eyes — Vision Assist (Claude Code)

Whenever the user's request involves image content and you cannot see it directly:
1. Image path / @ reference → call `mcp__kimi-eyes__read_image` with that path.
2. Just screenshotted/copied, or media you cannot read → call
   `mcp__kimi-eyes__read_clipboard_image` (image is almost always still in the clipboard).
3. Wording implies an image but no path → prefer `read_clipboard_image` over guessing.
If your model is multimodal (Claude 3+), you see images natively — ignore these rules.
```

### 5. 验证

```bash
claude mcp list
# kimi-eyes 应显示 √ Connected
```

### 6. 使用

```
有图片文件 → @C:\path\image.png 这个图里有什么？
刚截图     → 直接说「分析这张截图」（模型调 read_clipboard_image 读剪贴板）
```

### 注意

- Claude 3+ 模型原生多模态，Claude Code 大多场景直接看图；插件主要用于文本模型或统一走某个外部 VLM 的场景
- 卸载：`claude mcp remove kimi-eyes`

**首次调用会弹一次审批**（MCP 工具权限）：选 *Approve for this session* 本会话免问；想永久免审批，在 `~/.kimi-code/config.toml` 添加：

```toml
[[permission.rules]]
decision = "allow"
pattern = "mcp__kimi-eyes__*"
```

触发成功的标志：回答前 TUI 出现工具调用记录，模型随后基于返回的描述作答。若模型未自动调用（例如只贴了路径未提问），可直接命令：「调用 read_image 工具分析 D:\xxx.png」。

## 环境变量（可选，覆盖配置文件）

| 变量 | 说明 | 优先级 |
| --- | --- | --- |
| `VISION_API_PROTOCOL` | `openai` 或 `anthropic`，强制指定协议 | 高于配置文件 |
| `VISION_API_KEY` | API Key | 高于配置文件 |
| `VISION_API_URL` | BaseUrl | 高于配置文件 |
| `VISION_MODEL` | 模型名 | 高于配置文件 |
| `VISION_MAIN_MODEL` | 当前主模型名（可选），用于触发判断 | 高于配置文件 |
| `VISION_MAX_TOKENS` | 视觉 API 返回最大 token 数（默认 1024） | — |
| `VISION_FETCH_TIMEOUT_MS` | 请求超时毫秒（默认 60000） | — |

> 环境变量与 `config.json` 同名配置冲突时，环境变量优先；两者都没配时工具会返回明确错误并提示先运行 `setup.mjs`。
> 环境变量可沿用 opencode-vision 的迁移习惯——变量名完全兼容。

## 协议说明

| | OpenAI 兼容 | Anthropic |
| --- | --- | --- |
| 请求端点 | `{BaseUrl}/chat/completions`（自动补 `/v1`） | `{BaseUrl}/v1/messages` |
| 鉴权 | `Authorization: Bearer <Key>` | `x-api-key: <Key>` + `anthropic-version: 2023-06-01` |
| 图片传法 | `image_url` + base64 data URL | `source: {type:"base64"}` |
| 模型列表 | `GET {BaseUrl}/models` | `GET {BaseUrl}/v1/models`（官方无此端点，失败回退手动输入） |

## 模型能力数据库（models.dev）

插件内置一份从 [models.dev](https://models.dev) 同步的精简能力库 `mcp/models-db.json`（当前收录 279+ 模型，标注每个模型是否支持图片输入，约 19KB），用于两处：

- 向导选择视觉模型时的**精确标注**（✓视觉 / 文本），替代纯关键词猜测
- 声明 `mainModel` 后**判断当前主模型是否多模态**，实现代码级触发开关

**打包时同步**（数据会更新，建议每次发布前运行）：

```
node scripts/sync-models.mjs
```

- 数据源：`https://models.dev/models.json`
- 走代理：设置 `HTTPS_PROXY`，例如 `HTTPS_PROXY=http://127.0.0.1:7897 node scripts/sync-models.mjs`
- 可选参数：`--timeout <秒>`（默认 180）、`--out <路径>`（默认 `mcp/models-db.json`）、`--endpoint <URL>`
- 模型匹配策略：精确 id → `provider/模型名` 后缀 → 大小写不敏感的名称匹配
- **未收录的模型**：查询返回未知——向导回退关键词猜测（★疑似），触发判断回退 SYSTEM.md 引导，不影响使用
- **手动特例**：models.dev 未收录但确认支持识图的模型（如 `k3-256k`、`kimi-for-coding`），在 `scripts/sync-models.mjs` 的 `EXTRA_ENTRIES` 里维护，每次同步自动合入、不会被覆盖

## 工具

| 工具 | 参数 | 说明 |
| --- | --- | --- |
| `read_image` | `path`（必填）、`prompt`（可选） | 校验文件为图片（扩展名 + 魔数）后调 VLM |
| `read_clipboard_image` | `prompt`（可选） | 从系统剪贴板取图存临时文件后调 VLM，用完即删 |

剪贴板取图依赖平台工具：Windows 用 PowerShell（内置）、macOS 需 `pngpaste`（`brew install pngpaste`）、Linux 需 `wl-paste`（Wayland）或 `xclip`（X11）。

## 故障排查

- **Alt+V 粘贴报 `Current model does not support image input`** → KimiCode CLI 的拦截。两种解法：① 在 `config.toml` 给该模型追加 `image_in`（见「想用 Alt+V 粘贴？」）放行粘贴，模型看不懂图片时会自动读剪贴板；② 直接告诉模型「粘贴被拦截」，它会改调 `read_clipboard_image` 从剪贴板取图
- **工具返回「Vision API is not configured」** → 运行 `node setup.mjs`，或设置 `VISION_API_KEY` / `VISION_API_URL` / `VISION_MODEL`
- **模型列表拉取失败**（404/401）→ 向导自动回退手动输入；若服务端不支持 `/models`，直接输入模型名即可
- **视觉验证失败** → 换一个真正支持图片输入的模型（参考服务商文档，如 `qwen-vl-max`、`glm-4v`、`gpt-4o`、`claude-3-5-sonnet` 等）
- **`read_clipboard_image` 报错** → 确认剪贴板里确实有图片（先 Ctrl+C 复制或 Win+Shift+S 截图）；macOS/Linux 检查上述平台工具是否安装
- **安装后工具不生效** → 确认插件已启用（`/plugins list`），并运行过 `/reload` 或新开会话

## 安全说明

- `config.json` 以明文保存你的 API Key（类 Unix 已设 `600` 权限）；请勿将该文件提交到版本库
- `read_clipboard_image` 会读取系统剪贴板内容——剪贴板里可能刚复制过敏感信息。该工具调用会经过审批流，由你决定何时触发
- 本项目不内置任何密钥，视觉请求只发往你配置的 BaseUrl

## 局限

- 不做子代理委托方案：KimiCode 子代理的 `model_preference` 只能选择 primary/secondary，无法像 opencode 那样指定一个具体视觉模型，收益有限
- 不做 `UserPromptSubmit` hook 兜底：当前 `SYSTEM.md` 引导已覆盖常规场景；若你的 TUI 环境下粘贴/引用行为异常，可再评估 hook

## License

MIT
