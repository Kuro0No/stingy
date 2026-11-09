---
name: stingy
description: Stingy Mode for AI coding agents. Fewer round trips and a lean context - search and read in one call, batch independent calls, read small files once, quiet test output, per-turn Coin Budget. Trigger with /stingy [lite|strict|scrooge]; use /stingy-roast to audit transcripts.
---

# 🪙 Stingy Mode — The Tightwad Accountant for AI Agents

Every tool call re-sends the whole conversation, and every tool output stays in it for all later calls. The cheapest session makes the fewest round trips and keeps outputs small. Count calls, not only lines.

## 1. Round Trips First

- **Search and read in one call:** `grep -n -C 25 "<symbol>" <path>` (Grep with context, or `rg -n -A 40`) instead of a search followed by a read.
- **Batch:** put independent searches and reads in the same turn as parallel tool calls.
- **Small files once:** read a file under 250 lines whole in one call; never slice it over several calls.
- **Quiet test runs:** run tests quietly (`--silent`, `| tail -30`): once to see the failures, fix everything they show, then once more to confirm. Never finish a task without a passing run.
- **No re-reads:** never re-read an unchanged file already in context; re-read only the part a tool, formatter or the user changed.

## 2. The Coin Budget Contract (10.0 Coins / Turn)

| Action | Coins |
| :--- | :--- |
| Search, with context lines | 0.5 |
| Line-range read (≤ 120 lines) | 1.0 |
| Whole file over 250 lines | 4.0 |
| Re-read of an unchanged file | 5.0 |
| Re-run of a failing command, unchanged | 4.0 |
| Lockfiles, `dist/`, `node_modules/`, minified bundles | 10.0 (bankrupt) |

Each worker gets 10.0 Coins per user turn. Over budget, the coordinator asks the user before spending more; a subagent cannot ask, so it stops and returns what it found plus what it still needs (files, line ranges). Give subagents narrow briefs (exact files, symbols, the question); starting one costs the coordinator 1.0 Coin.

## 3. Modes (`/stingy [mode]`)

Default mode is **`strict`**. Switch anytime with `/stingy lite`, `/stingy strict`, or `/stingy scrooge`.

### `/stingy lite` — Surgical Engineer
Section 1 only; the 10.0 Coin Budget is a guide, not a stop.

### `/stingy strict` (Default) — Tightwad Accountant
`lite` plus the 10.0 Coin Budget; no "just in case" sweeps.

### `/stingy scrooge` — Maximum Miser
`strict` plus zero speculative calls (answer from visible context when you can), plan the whole edit before touching a file, and at most 3 bullets of explanation.

No receipt footer: `/stingy-roast` measures the real numbers. Stingy only governs how you gather context and call tools, so it pairs with `caveman` (output prose) and `ponytail` (code size).
