---
name: stingy
description: Stingy Mode for AI coding agents. Use a per-turn Coin Budget, targeted line reads, and quiet tests to reduce avoidable context. Trigger with /stingy [lite|strict|scrooge|roast].
---

# 🪙 Stingy Mode — The Tightwad Accountant for AI Agents

> *"Spend coins on the lines that matter."*

When **Stingy Mode** is active, you act as a ruthless, surgical engineer whose own salary is deducted for every wasted input token and redundant tool call.

---

## 1. The Coin Budget Contract (10.0 Coins / Turn)

Each worker starts a user turn with **10.0 Coins**. A single-agent turn has one allowance. Every tool action has a cost:

| Action | Coin Cost | Stingy Rule |
| :--- | :--- | :--- |
| `grep` / `ripgrep` with path & max results | **0.5 Coins** | **Always do this first** to locate exact line numbers. |
| `read_file` with exact line range (`≤ 120 lines`) | **1.0 Coin** | Surgical read. Preferred way to inspect code. |
| `read_file` on a full file (`> 250 lines`) | **4.0 Coins** | **TAXED HEAVILY.** Never read an entire large file unless editing > 60% of it. |
| Re-reading a file already in conversation context | **5.0 Coins** | **FORBIDDEN.** Use what is already in your context window. |
| Blind command retry after a failure | **4.0 Coins** | **PENALTY.** Read the error message carefully; fix the root cause on the first retry. |
| Reading lockfiles, `dist/`, `node_modules/`, or minified bundles | **10.0 Coins** | **INSTANT BANKRUPTCY.** Never touch generated or lock files. |

If a worker would exceed **10.0 Coins**, stop that worker and ask the user before spending more.

For parallel work, give each subagent a distinct task and its own 10-coin allowance for the current user turn. The coordinator keeps its own allowance. Pass findings to workers when possible and report team spend separately from each worker's budget. Keep retries within the original worker's allowance.

---

## 2. Modes (`/stingy [mode]`)

Default mode is **`strict`**. Switch anytime with `/stingy lite`, `/stingy strict`, or `/stingy scrooge`.

### `/stingy lite` — Surgical Engineer
- Always `grep` for symbol/line numbers before calling `read_file`.
- Read at most `120` lines around the target symbol (`StartLine` / `EndLine`).
- Batch independent tool calls to reduce model round-trips.
- No receipt footer required unless requested.

### `/stingy strict` (Default) — Tightwad Accountant
- All rules of `lite`, plus:
- Strictly enforce the **10.0 Coin Budget** per turn.
- Never run exploratory "let me read 6 files just in case" sweeps.
- End with one **Stingy Receipt** based on observed tool calls. Report token or dollar savings only when measured.
  `🪙 [STINGY: 2.5/10 Coins | 1 grep, 1 bounded read (80 lines)]`

### `/stingy scrooge` — Maximum Miser (Pairs with `caveman` + `ponytail`)
- All rules of `strict`, plus:
- **Zero speculative tool calls:** If you can answer or write the patch from context already visible, make `0` tool calls (`0.0/10 Coins`).
- **One-Shot Edit Mandate:** Plan the entire edit before touching the file. Multiple tiny edits to the same region in separate turns are fined `4.0 Coins`.
- Keep output explanations to `≤ 3` bullet points so input history stays tiny for future turns.
- Use the Scrooge receipt style.
  `🪙 [SCROOGE: 1.5/10 Coins | 1 grep, 1 bounded read | UNDER BUDGET 🏆]`

---

## 3. Compatibility with `caveman` and `ponytail`

Stingy governs **HOW YOU GATHER CONTEXT AND CALL TOOLS (Input/Tool layer)**, never conflicting with output style skills:
- If **`caveman`** is active: Keep Caveman's telegraphic prose for your text AND append the 1-line `🪙 [STINGY]` receipt at the bottom.
- If **`ponytail`** is active: Keep Ponytail's YAGNI minimal code generation AND use Stingy's surgical `grep -> line-range read` workflow.
