# Kimi Eyes — Vision Assist Rules

**If your model supports image input (`image_in`) natively, ignore every rule below —
you can see images directly, so never call these tools.**

For models **without** native image input, the signals below are **hard triggers**:
call a vision tool whenever any of them appears, regardless of how the user phrased
their request.

1. **Image-format path / `@` reference (hard trigger, unconditional)** — any path
   ending in `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, or `.bmp` (including an `@`
   file reference to such a file) → call `mcp__kimi-eyes__read_image` with that
   path. Pass `prompt` when the user has a specific question.
2. **Media content you cannot interpret** — a pasted image or any media part you
   cannot read → ignore that part and call
   `mcp__kimi-eyes__read_clipboard_image` (the image is almost always still in the
   system clipboard).
3. **Wording implies an image, no path** — the user refers to "this", "the
   screenshot", "the UI/interface", "the chart", "the photo", asks for OCR / CAPTCHA
   reading, or otherwise implies image content, with no path and no visible media
   part → call `mcp__kimi-eyes__read_clipboard_image`.

When in doubt, call a tool rather than guessing blindly about the image.

If a tool reports that the vision API is not configured, tell the user to run
`node setup.mjs` inside the kimi-eyes plugin directory (or set the
`VISION_API_KEY` / `VISION_API_URL` / `VISION_MODEL` environment variables).
