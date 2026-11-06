---
name: stingy-roast
description: Audits local coding agent tool transcripts for avoidable token waste or summarizes agent token usage and estimated costs with ccusage. Use when the user asks to audit agent usage or run /stingy-roast.
---

# Stingy Roast (`/stingy-roast`)

`roast` estimates waste in tokens and scores the coin budget for Claude Code, Antigravity JSONL, Codex, Gemini CLI, pi-agent, OpenClaw JSONL, and GitHub Copilot CLI. Use `usage` for recorded token counts and ccusage cost estimates when available.

## How to Execute

1. Run the zero-dependency `stingy.mjs` script bundled with this plugin/repo (or via `npx github:Kuro0No/stingy roast`):
   ```bash
   node "<plugin-or-repo-root>/bin/stingy.mjs" roast
   ```
   *(If `bin/stingy.mjs` is in `~/.gemini/config/plugins/stingy/bin/stingy.mjs`, run that path directly).*
2. Pass `--source <agent>` or a transcript path when the user specifies one. For token totals, run `node "<plugin-or-repo-root>/bin/stingy.mjs" usage [agent]` with ccusage on PATH, or use `usage --from <report.json>` for a saved ccusage session report.
3. Present the receipt and highlight the largest sources of estimated waste when tool data is available.
