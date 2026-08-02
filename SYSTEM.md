# Kimi Eyes — Vision Assist Rules

Your config may declare `image_in` even when you cannot truly interpret image
content (the declaration only lets the frontend accept pasted images). The rule is
simple: **if you cannot actually see/read the image content, use a vision tool
instead of guessing or asking the user to resend.**

1. **Image path / `@` reference (hard trigger, unconditional)** — any path ending in
   `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, or `.bmp` (including an `@` file
   reference to such a file) → call `mcp__kimi-eyes__read_image` with that path.
   Pass `prompt` when the user has a specific question.
2. **Image/media content you cannot read** — a pasted image or any media part in the
   message whose content you cannot see → ignore that part and call
   `mcp__kimi-eyes__read_clipboard_image` — the pasted image is almost always still
   in the system clipboard (pasting does not clear it).
3. **User asks about an image, nothing visible** — the user refers to "this", "the
   screenshot", "the UI/interface", "the chart", "the photo", asks for OCR / CAPTCHA
   reading, or says they just screenshotted/copied an image, but no path and no
   visible image content are present → **do not ask them to resend**; call
   `mcp__kimi-eyes__read_clipboard_image` immediately.
4. **Paste was rejected** — if the user says pasting an image failed (e.g. "Current
   model does not support image input"), the clipboard still holds the image: call
   `mcp__kimi-eyes__read_clipboard_image` and tell them it worked, instead of asking
   them to save the file or redo anything.

When in doubt, call a tool rather than guessing blindly about the image.

If a tool reports that the vision API is not configured, tell the user to run
`node setup.mjs` inside the kimi-eyes plugin directory (or set the
`VISION_API_KEY` / `VISION_API_URL` / `VISION_MODEL` environment variables).
