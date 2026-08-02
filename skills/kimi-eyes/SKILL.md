---
name: kimi-eyes
description: 纯文本主模型的看图入口。通过 /skill kimi-eyes 触发，把粘贴的图片交给 kimi-eyes 配置的外部 VLM 分析，返回文字描述。
type: prompt
whenToUse: 当用户用 /skill kimi-eyes 发送图片、且当前主模型不具备原生看图能力时
---

# Kimi Eyes — 纯文本主模型看图

## 为什么需要这个 skill

`/skill` 通道下，用户粘贴的图片以 `Attached image file: <缓存路径>` 的**纯文本**形式
进入对话，不会作为 `image_url` content part 发给主模型。因此**纯文本主模型也不会触发
`400 unknown variant image_url` 错误**。本 skill 利用这条文本通道，把图片交给 kimi-eyes
已配置的外部 VLM，拿回文字描述后作答。

## 触发条件

- **仅当**用户当前消息以 `/skill kimi-eyes` 开头，并附带图片
- 用户直接 Alt-V 粘贴图片（没有 `/skill` 前缀）时**不要**走本 skill，按 kimi-eyes 常规机制处理（@图片路径 或 截图后直接提问）
- 多模态主模型（已声明 image_in 且 provider 真支持图片）原生看图即可，不需要本 skill

## 执行步骤

1. 在用户消息里定位 `Attached image file: <路径>` 文本，提取其中的图片**绝对路径**（缓存目录下的文件）
2. 调用 kimi-eyes 的 `read_image` 工具：
   - `path` = 第 1 步提取到的图片路径
   - `prompt` = 用户的问题；若用户没给具体问题，使用「详细描述这张图片的内容」
3. **不要**使用 `ReadMediaFile`（它对纯文本模型无意义，且会把图片作为 part 回灌，可能再次触发 400）
4. `read_image` 返回的是外部 VLM 的**文字描述**，基于这段描述回答用户的问题

## 失败兜底

- 消息里没有 `Attached image file:` 路径 → 提示用户：「请输入 `/skill kimi-eyes` 后再粘贴图片」
- `read_image` 报「Vision API is not configured」→ 提示用户运行 `npx kimi-eyes setup` 配置视觉 API
- `read_image` 报文件不存在 → 提示用户重新粘贴图片（缓存文件可能已失效）
