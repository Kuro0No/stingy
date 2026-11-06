---
name: stingy-lite
description: Compatibility alias for the 12-coin Stingy Build skill. Use when explicitly invoked as /stingy-lite.
---

# 🪙 `/stingy-lite` — Feature-Building Mode (12-Coin Turn Budget)

When **`/stingy-lite`** is active, build or refactor features under a **12.0-Coin per-turn tool budget**. This gives you room to edit across files while keeping reads targeted and verification bounded.

## Core Rules

1. **Locate in One Shot (`0.5 Coins`):** Combine symbol lookups across files into a single `grep` / `ripgrep` / `Select-String` call with line numbers (`-n`) before reading existing files >150 lines.
2. **Surgical Reads Only (`1.0 Coin`):** Always pass `StartLine` and `EndLine` (`offset`/`limit`, max 120 lines) to `read_file`. Never read whole files >250 lines (`4.0 Coins`).
3. **No Shell Read Bypass (`4.0 Coins Penalty`):** Never use `cat`, `Get-Content`, `head`, or `tail` in shell commands to read source files instead of bounded `read_file`.
4. **One Quiet Verification Check (`1.0 Coin`):** After editing or creating files, run at most **1** quiet verification command (`--silent` or piped to `tail -n 30`). Do not enter multi-turn trial-and-error shell loops.
5. **Concise Output:** Keep prose explanations focused on architecture decisions and changed symbols; avoid repeating unchanged boilerplate.
6. **Coin Receipt:** End your response with a 1-line receipt:
   `🪙 [STINGY-LITE: X.X / 12.0 Coins | <summary of searches, reads, edits>]`
