---
name: stingy-roast
description: Audits local AI agent session transcripts (.claude, .gemini/antigravity, .cursor) to calculate input token waste, redundant full-file reads, and prints a viral ASCII Supermarket Receipt. Trigger when the user asks to roast their token usage, audit token waste, or run /stingy-roast.
---

# Stingy Roast (`/stingy-roast`)

Scans local AI coding sessions and prints a **Token Autopsy Supermarket Receipt** showing exactly how many input tokens and dollars were wasted by sloppy tool calls (full-file reads, duplicate re-reads, and un-truncated command outputs).

## How to Execute

1. Run the zero-dependency `stingy.mjs` script bundled with this plugin/repo (or via `npx github:Kuro0No/stingy roast`):
   ```bash
   node "<plugin-or-repo-root>/bin/stingy.mjs" roast
   ```
   *(If `bin/stingy.mjs` is in `~/.gemini/config/plugins/stingy/bin/stingy.mjs`, run that path directly).*
2. Display the full ASCII **STINGY TOKEN AUTOPSY** receipt inside a code block so the alignment stays intact.
3. Highlight the top 2–3 token offenses found (e.g., full-file reads without line bounds, duplicate file re-reads, un-piped terminal logs) and suggest enabling `/stingy strict` or `/stingy scrooge` to eliminate them.
