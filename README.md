# 🪙 stingy

> **"Why burn 50,000 input tokens reading whole files when 400 tokens do trick?"**
>
> **Stingy Mode** plugin, skill, and offline transcript auditor for **Claude Code, Cursor, and Antigravity**. Enforces a per-turn **10-Coin Budget** on file reads and tool calls — cutting **~94.4% of cumulative billed input tokens** (`-98.7%` tool output payload) in our recorded **Live LLM A/B Experiment**, `-81.2%` in our synthetic 3-task trace model, and flagging **`-29.4%` historical avoidable waste** across 25 real local sessions.

<p align="center">
  <img src="./assets/hero-demo.svg" width="880" alt="Stingy CLI Token Autopsy Receipt and Trace-Driven Benchmark Model" />
</p>

<p align="center">
  <a href="#license"><img src="https://img.shields.io/badge/License-MIT-black.svg" alt="License: MIT" /></a>
  <a href="./test/stingy.test.mjs"><img src="https://img.shields.io/badge/tests-26%20passing-brightgreen.svg" alt="Tests: 26 passing" /></a>
  <a href="./benchmarks/measure-live-ab.mjs"><img src="https://img.shields.io/badge/live%20A%2FB--94.4%25%20input%20tokens-22c55e.svg" alt="Live A/B: -94.4% input tokens" /></a>
  <a href="https://kuro0no.github.io/stingy/"><img src="https://img.shields.io/badge/demo-kuro0no.github.io%2Fstingy-orange.svg" alt="Live Demo" /></a>
</p>

---

## ⚡ Quick Start (1 Command, Zero Dependencies)

Install the `/stingy` project skill into `.claude/skills/stingy/SKILL.md` (Claude Code) and `.agents/skills/stingy/SKILL.md` (Antigravity / Cursor) directly from GitHub:

```bash
npx github:Kuro0No/stingy init
```

Then activate in chat with `/stingy scrooge` (or `/stingy strict`).

To audit your local `~/.claude` and `~/.gemini/antigravity` session logs offline:

```bash
npx github:Kuro0No/stingy roast
```

<details>
<summary><b>Other install methods (Claude Code Plugin Marketplace, Skills CLI, Antigravity Plugin)</b></summary>

<br />

**Claude Code Plugin Marketplace (like `caveman`):**
```bash
/plugin marketplace add Kuro0No/stingy
/plugin install stingy@stingy
```
*(Note: When installed via the Claude Code Plugin Marketplace, invoke with the plugin namespace `/stingy:stingy` or `/stingy:stingy-roast`).*

**Universal Skills CLI:**
```bash
npx skills add Kuro0No/stingy
```

**Antigravity Native Plugin Bundle:**
```bash
git clone https://github.com/Kuro0No/stingy.git ~/.gemini/config/plugins/stingy
```

</details>

---

## 🧩 The Missing Piece of the Token-Saving Stack

Tools like **Caveman** shrink output prose and **Ponytail** shrinks output code. **But output tokens are only ~15%–20% of a typical coding session's token volume.**

The remaining **~80% of your context window and 5-hour rate limit** is consumed on the **input & tool-call side** when an agent:
1. Calls `Read` on an entire 1,200-line file without `offset`/`limit` or `StartLine`/`EndLine` just to inspect 15 lines.
2. Re-reads the exact same unedited file multiple times in the same session.
3. Runs blind `edit -> failing test -> edit` retry loops that re-bill accumulated history on every turn.

| Layer | Tool | Target | Share of Session Volume |
| :--- | :--- | :--- | :--- |
| **1. Output Prose** | `caveman` | Conversational filler & verbose explanations | ~10% |
| **2. Output Code** | `ponytail` | Over-engineered boilerplate (YAGNI) | ~10% |
| **3. Input & Tool Calls** | **🪙 `stingy`** | **Unbounded file reads, duplicate re-reads & retry loops** | **~80%** |

---

## 🧪 1. Live LLM A/B Empirical Experiment (`npm run benchmark:live-ab`)

We ran two parallel LLM subagents on the exact same 3-file, 3,100-line codebase ([`benchmarks/setup-live-ab.mjs`](./benchmarks/setup-live-ab.mjs)) tasked with finding and diagnosing 3 specific bugs (`verifyJwtExpiration`, `consumeRateQuota`, and `computeBackoffDelayMs`):

* **Control Arm ([`benchmarks/fixtures/live-ab-baseline.jsonl`](./benchmarks/fixtures/live-ab-baseline.jsonl)):** Standard agent reading files without `StartLine`/`EndLine` bounds.
* **Treatment Arm ([`benchmarks/fixtures/live-ab-stingy.jsonl`](./benchmarks/fixtures/live-ab-stingy.jsonl)):** Agent running with `/stingy scrooge` (10-Coin Turn Budget).

Both raw recorded JSONL session transcripts are checked into [`benchmarks/fixtures/`](./benchmarks/fixtures/). Verify them directly:

```bash
npm run benchmark:live-ab
node ./bin/stingy.mjs roast ./benchmarks/fixtures/live-ab-baseline.jsonl
node ./bin/stingy.mjs roast ./benchmarks/fixtures/live-ab-stingy.jsonl
```

| Metric | Baseline Agent (No Stingy) | Stingy Agent (`/stingy scrooge`) | Measured Delta |
| :--- | ---: | ---: | ---: |
| **Bugs Correctly Found & Line #** | **3 / 3 (100%)** (Lines 741, 617, 882) | **3 / 3 (100%)** (Lines 741, 617, 882) | **Identical Accuracy** |
| **LLM Planner Turns** | `4 turns` (`15 steps`) | `2 turns` (`7 steps`) | **-2 turns** |
| **Unbounded Full-File Reads** | `9x` | `0x` | **-100%** |
| **Surgical Line-Range Reads** | `0x` | `3x` (+ 1 grep) | **100% Bounded** |
| **Tool Output Payload** | `376,606 chars` (`94,152 tok`) | `4,901 chars` (`1,226 tok`) | **-98.7%** |
| **Cumulative Billed Input Tokens** | `257,297 tok` | `14,352 tok` | **-94.4%** |
| **10-Coin Turn Budget Score** | `36.0 / 10.0 Coins` (**BANKRUPT**) | `3.5 / 10.0 Coins` (**PASS**) | **Within Budget** |

---

## 📊 2. Synthetic Trace & Prompt-Cache Model (`npm run benchmark`)

How much does replacing unbounded full-file reads with `grep` + surgical line-range reads save once you account for fixed system prompts, the token cost of `SKILL.md` itself, and **Anthropic Prompt Caching**?

Run the deterministic trace model yourself:

```bash
git clone https://github.com/Kuro0No/stingy.git
cd stingy
npm run benchmark
npm test
```

### Methodology & Scope ([`benchmarks/run-benchmark.mjs`](./benchmarks/run-benchmark.mjs))
* **What this models:** A deterministic, trace-driven comparison of **Unconstrained Baseline Tool Traces** (reading full files without range bounds, duplicate re-reads, un-piped test logs) vs. **Stingy Mode (`scrooge`) Tool Traces** (`grep` + 60–70 line surgical reads + `--silent` test runs) on identical generated TypeScript fixtures (`1,240` to `2,860` lines).
* **Fixed System Overhead Included:** Every turn includes an uncompressible **8,200-token** base system/schema prefix.
* **Honest Skill Overhead:** The Stingy trace is explicitly charged **+450 tokens** for loading `skills/stingy/SKILL.md`.
* **Anthropic Prompt Caching Modeled:** Under [Anthropic Prompt Caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching), the shared system prefix is read from cache at **`0.10x` (`$0.30/1M`)**, whereas dumping a new 1,200-line file into context incurs a **`1.25x` Cache Write fee (`$3.75/1M` — 12.5× more expensive per token than a cached read)**, yielding **`-90.7%` modeled cache cost** in the synthetic trace comparison.
* **Scope & Limitations:** `benchmarks/run-benchmark.mjs` is a **synthetic trace model** (it does not invoke live LLM APIs or claim live A/B task-quality equivalence). To measure real historical waste on your own machine without assumptions, run `npx github:Kuro0No/stingy roast` (on our 25 real local sessions totaling 18,519 steps, `roast` measured **`-29.4%` avoidable tool-token waste**: `97` unbounded full-file reads and `56` duplicate re-reads vs `859` surgical/small reads).

| Task | Baseline Tokens | Stingy Tokens | Token Reduction | Prompt-Cached USD (Base → Stingy) | Coin Score |
| :--- | ---: | ---: | ---: | ---: | ---: |
| **Task 1:** Fix JWT clock-skew bug (1,240-line service) | 110,085 | 19,655 | **-82.1%** | \$0.160 → \$0.012 (**-92.4%**) | `2.5 / 10` |
| **Task 2:** Cross-file header refactor (4 files, 2,860 lines) | 183,267 | 34,902 | **-81.0%** | \$0.230 → \$0.025 (**-89.1%**) | `5.5 / 10` |
| **Task 3:** Diagnose flaky webhook test (1,620 lines + logs) | 111,317 | 21,352 | **-80.8%** | \$0.178 → \$0.016 (**-91.2%**) | `3.5 / 10` |
| **AGGREGATE** | **404,669** | **75,909** | **-81.2%** | **\$0.568 → \$0.053 (-90.7%)** | **PASS** |

---

## 🪙 How the 10-Coin Budget Contract Works

The prompt skill ([`skills/stingy/SKILL.md`](./skills/stingy/SKILL.md)) instructs the model to budget **10.0 Coins per user turn**, and the CLI ([`src/core.mjs`](./src/core.mjs)) audits your post-hoc session transcripts against the exact same table:

| Tool Action | Coin Cost | Rule |
| :--- | :--- | :--- |
| `grep` / `ripgrep` with path & line numbers | **0.5 Coins** | **Mandatory first step** before opening unfamiliar files. |
| `read_file` / `Read` with range (`≤ 120 lines`) or small file | **1.0 Coin** | Standard surgical inspection (`StartLine`/`EndLine` or `offset`/`limit`). |
| `read_file` / `Read` with medium range (`121–250 lines`) | **2.0 Coins** | Permitted only for large functions/classes. |
| Unbounded full-file read (`> 250 lines` without range) | **4.0 Coins** | **Heavily taxed.** Avoid unless rewriting >60% of the file. |
| Duplicate re-read of an unedited file in the same session | **5.0 Coins** | **Forbidden.** Reference the existing context window. |
| Consecutive failed command retry without prior edit | **4.0 Coins** | Diagnose the root cause before re-running. |
| Reading lockfiles, `dist/`, or `node_modules/` | **10.0 Coins** | **Instant Turn Bankruptcy.** |

---

## 🧾 Offline Transcript Autopsy (`stingy roast`)

`stingy roast` parses real JSONL transcripts from **Claude Code** (`~/.claude/projects/**/*.jsonl`) and **Antigravity** (`~/.gemini/antigravity/brain/**/*.jsonl`) using [`analyzeJsonlLines()`](./src/core.mjs):

* **Per-Session Isolation:** Duplicate file re-read tracking (`uneditedReadPaths`) is strictly scoped per session file — reading `config.ts` once in two separate sessions is never flagged as a duplicate read.
* **User-Turn Grouping vs. Avoidable Waste:** All assistant tool calls between one human prompt and the next are accumulated into a single User Turn (ignoring automated `tool_result` wrapper events). Note that **Turn Budget (`>10.0 Coins`)** and **Avoidable Token Waste** measure two orthogonal dimensions: executing 15 surgical reads in a single turn costs `15.0 Coins` (1 Bankrupt Turn due to turn breadth) even though its **Avoidable Token Waste** is `0` tokens (`$0.00`) because every individual read was properly bounded.
* **Dynamic `tool_result` Sizing:** When `tool_result` payloads are present in the transcript, `stingy roast` measures their actual line count and character length (a 1-line file read without `offset`/`limit` is recognized as a small file with `0` waste; a 2,000-line read scales waste proportionally to its actual size, falling back to heuristics only when payloads are omitted).
* **Zero Fake Data or Clamps:** Empty `HOME` directories exit cleanly (`No local JSONL session transcripts found`), and a disciplined log with 100% surgical reads reports **`0` wasted tokens (`-0.0%`) and `CERTIFIED SCROOGE`**.

```bash
# Audit default ~/.claude and ~/.gemini directories:
npx github:Kuro0No/stingy roast

# Reproduce with the bundled sample session fixture in this repo:
node ./bin/stingy.mjs roast ./benchmarks/fixtures/sample-session.jsonl
```

---

## 📄 License

MIT License. See [LICENSE](./LICENSE).
