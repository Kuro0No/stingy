# 🪙 stingy

> **"Why burn 50,000 input tokens reading whole files when 400 tokens do trick?"**
>
> **Stingy Mode** plugin, skill, and transcript auditor for **Claude Code, Cursor, and Antigravity**. Enforces a per-turn **10-Coin Budget** on file reads and tool calls, cutting **~80% of tool-driven input token bloat** (**81.2%** measured across our reproducible 3-task benchmark suite).

<p align="center">
  <img src="./assets/hero-demo.svg" width="880" alt="Stingy CLI Token Autopsy Receipt and Reproducible Benchmark" />
</p>

<p align="center">
  <a href="#license"><img src="https://img.shields.io/badge/License-MIT-black.svg" alt="License: MIT" /></a>
  <a href="./test/stingy.test.mjs"><img src="https://img.shields.io/badge/tests-11%20passing-brightgreen.svg" alt="Tests: 11 passing" /></a>
  <a href="./benchmarks/run-benchmark.mjs"><img src="https://img.shields.io/badge/benchmark--81.2%25%20input%20tokens-22c55e.svg" alt="Benchmark: -81.2% input tokens" /></a>
  <a href="https://kuro0no.github.io/stingy/"><img src="https://img.shields.io/badge/demo-kuro0no.github.io%2Fstingy-orange.svg" alt="Live Demo" /></a>
</p>

---

## ⚡ Quick Start (1 Command, Zero Dependencies)

Install the `/stingy` skill into your project right from GitHub:

```bash
npx github:Kuro0No/stingy init
```

Or audit your local `~/.claude` and `~/.gemini/antigravity` session logs offline:

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

**Stingy is designed to run alongside `caveman` and `ponytail` with zero prompt conflicts.**

---

## 📊 Reproducible Benchmark (`npm run benchmark`)

Does forcing grep-first surgical reads actually save ~80% of billed input tokens once you account for fixed system prompts and the token cost of `SKILL.md` itself?

Run the deterministic benchmark harness yourself:

```bash
git clone https://github.com/Kuro0No/stingy.git
cd stingy
npm run benchmark
npm test
```

### Methodology ([`benchmarks/run-benchmark.mjs`](./benchmarks/run-benchmark.mjs))
* **Cumulative Multi-Turn Billing:** Every turn re-bills the accumulated conversation context plus a fixed **8,200-token** base system/schema overhead.
* **Honest Skill Overhead:** The Stingy agent is explicitly charged **+450 tokens per turn** for loading `skills/stingy/SKILL.md` itself.
* **BPE Token Estimation:** Measured at 4 characters per token across generated TypeScript service fixtures (`1,240` to `2,860` lines).

| Task | Baseline Input Tokens | Stingy (`scrooge`) Tokens | Saved Tokens | Reduction | Coin Score |
| :--- | ---: | ---: | ---: | ---: | ---: |
| **Task 1:** Fix JWT clock-skew bug (1,240-line service) | 110,085 | 19,655 | 90,430 | **-82.1%** | `2.5 / 10` |
| **Task 2:** Cross-file header refactor (4 files, 2,860 lines) | 183,267 | 34,902 | 148,365 | **-81.0%** | `5.5 / 10` |
| **Task 3:** Diagnose flaky webhook test (1,620 lines + logs) | 111,317 | 21,352 | 89,965 | **-80.8%** | `3.5 / 10` |
| **TOTAL / AGGREGATE** | **404,669** | **75,909** | **328,760** | **-81.2%** | **PASS** |

---

## 🪙 How the 10-Coin Budget Contract Works

Both the prompt skill ([`skills/stingy/SKILL.md`](./skills/stingy/SKILL.md)) and the CLI scoring engine ([`src/core.mjs`](./src/core.mjs)) enforce a **10.0-Coin allowance per turn**:

| Tool Action | Coin Cost | Rule |
| :--- | :--- | :--- |
| `grep` / `ripgrep` with path & line numbers | **0.5 Coins** | **Mandatory first step** before opening unfamiliar files. |
| `read_file` / `Read` with range (`≤ 120 lines`) | **1.0 Coin** | Standard surgical inspection (`StartLine`/`EndLine` or `offset`/`limit`). |
| `read_file` / `Read` with medium range (`121–250 lines`) | **2.0 Coins** | Permitted only for large functions/classes. |
| Unbounded full-file read (`> 250 lines` or no range) | **4.0 Coins** | **Heavily taxed.** Avoid unless rewriting >60% of the file. |
| Duplicate re-read of an unedited file in context | **5.0 Coins** | **Forbidden.** Reference the existing context window. |
| Consecutive failed command retry without prior edit | **4.0 Coins** | Diagnose the root cause before re-running. |
| Reading lockfiles, `dist/`, or `node_modules/` | **10.0 Coins** | **Instant Turn Bankruptcy.** |

---

## 🧾 Offline Transcript Autopsy (`stingy roast`)

`stingy roast` parses real JSONL transcripts from **Claude Code** (`~/.claude/projects/**/*.jsonl`) and **Antigravity** (`~/.gemini/antigravity/brain/**/*.jsonl`) using [`analyzeJsonlLines()`](./src/core.mjs):

* **No fake data:** If no transcripts exist in `HOME` (or the target path), `stingy roast` reports `No local JSONL session transcripts found` and exits cleanly.
* **No artificial floors or clamps:** If your transcripts contain 100% surgical line-range reads (`offset`/`limit` or `StartLine`/`EndLine`), 0 duplicate reads, and 0 retries, `stingy roast` reports **`0` wasted tokens, `$0.00` waste (`-0.0%`), and `CERTIFIED SCROOGE`**.

```bash
# Audit default ~/.claude and ~/.gemini directories:
npx github:Kuro0No/stingy roast

# Or audit a specific JSONL file or directory:
npx github:Kuro0No/stingy roast ./path/to/session.jsonl
```

---

## 📄 License

MIT License. See [LICENSE](./LICENSE).
