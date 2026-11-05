# 🪙 stingy

> **"Why burn 50,000 input tokens reading whole files when 400 tokens do trick?"**
>
> **Stingy Mode** gives coding agents a **10-Coin Budget** for file reads and tool calls. **Stingy Roast** audits the receipts from their local transcripts. See the [live token comparison](#-live-codex-comparison) for measured usage.

<p align="center">
  <img src="./assets/hero-demo.svg" width="880" alt="Stingy CLI Token Autopsy Receipt and Trace-Driven Benchmark Model" />
</p>

<p align="center">
  <a href="#license"><img src="https://img.shields.io/badge/License-MIT-black.svg" alt="License: MIT" /></a>
  <a href="./test/"><img src="https://img.shields.io/badge/tests-35%20passing-brightgreen.svg" alt="Tests: 35 passing" /></a>
  <a href="https://kuro0no.github.io/stingy/"><img src="https://img.shields.io/badge/demo-kuro0no.github.io%2Fstingy-orange.svg" alt="Live Demo" /></a>
</p>

---

## ⚡ Quick Start (1 Command, Zero Dependencies)

Install the `/stingy` project skill into `.claude/skills/stingy/SKILL.md` (Claude Code) and `.agents/skills/stingy/SKILL.md` (Antigravity / Cursor) directly from GitHub:

```bash
npx github:Kuro0No/stingy init
```

Then activate in chat with `/stingy scrooge` (or `/stingy strict`).

Audit local session logs offline with `roast`. Add `--source codex` to focus on one agent.

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

## 🧩 Multi-Plugin Live Telemetry Comparison (`npm run benchmark:plugins`)

**Caveman** targets verbose prose. **Ponytail** targets overbuilt code. **Stingy** budgets how agents gather context and use tools (`grep` before `read`, `StartLine`/`EndLine` ≤ 120 lines, zero duplicate reads).

We ran real LLM subagents across **7 configurations** on the exact same 3-file, 3,100-line production bug-hunt task (`auth-service.ts`, `rate-limiter.ts`, `webhook-worker.ts`). All 6 live subagent JSONL transcripts — including hardware token telemetry (`input_tokens`, `cache_read_tokens`, `output_tokens`) — are checked into [`benchmarks/fixtures/`](./benchmarks/fixtures/).

```bash
npm run benchmark:plugins
```

| Configuration | Uncached In Tok | Cached In Tok | Output Tok (Report Chars) | Real API Cost (`$`) | Cost Delta | Output Correctness (Bugs + 8/8 Unit Assertions) |
| :--- | ---: | ---: | ---: | ---: | ---: | :--- |
| **1. None (Default Baseline)** | `142,542` | `200,806` | `2,186` (`1,416c`) | `$0.5207` | **0%** | ✅ `3/3 (100%)` + `8/8 Pass` |
| **2. Static `.claudeignore` / `tokendiet`** | `142,542` | `200,806` | `2,186` (`1,416c`) | `$0.5207` | **0%** | ✅ `3/3 (100%)` + `8/8 Pass` |
| **3. `caveman` only (Output Prose)** | `143,267` | `311,150` | `2,450` (`1,874c`) | `$0.5599` | +7.5% | ✅ `3/3 (100%)` + `8/8 Pass` |
| **4. `ponytail` only (Output Code YAGNI)** | `141,516` | `203,222` | `3,167` (`2,010c`) | `$0.5330` | +2.4% | ✅ `3/3 (100%)` + `8/8 Pass` |
| **5. `caveman + ponytail` (Output Stack)** | `124,392` | `291,817` | `1,732` (`656c`) | `$0.4867` | **-6.5%** | ✅ `3/3 (100%)` + `8/8 Pass` |
| **6. `stingy` only (`/stingy scrooge`)** | **`19,449`** | **`35,159`** | `1,063` (`947c`) | **`$0.0848`** | **-83.7%** | ✅ `3/3 (100%)` + `8/8 Pass` |
| **7. `stingy + caveman + ponytail` (Trinity)** | **`19,279`** | **`35,060`** | **`781` (`531c`)** | **`$0.0801`** | **-84.6%** | ✅ `3/3 (100%)` + `8/8 Pass` |

* **Why Output-only skills (`caveman + ponytail`) saved only `6.5%` of total cost here:** Even though `caveman + ponytail` cut output tokens by **`-20.8%`** (`2,186 → 1,732`) and compressed the final report by **`-53.7%`** (`1,416 → 656` chars), output tokens represent only `~6%` of the bill when an agent reads 3,100 lines of source code into its input context (`$0.4607` in input vs `$0.0260` in output).
* **Why `stingy` + `caveman` + `ponytail` is the optimal stack:** `stingy` slashes uncached input tokens by **`-86.5%`** (`142,542 → 19,279`), while `caveman + ponytail` cuts the remaining output tokens by an extra **`-26.5%`** (`1,063 → 781` output tokens; `947 → 531` report chars), delivering **`-84.6%` total API cost reduction** with **100% output accuracy**.

---

## 🧪 Recorded Tool Trace Replay (`npm run benchmark:live-ab`)

You can also inspect the raw tool-call payload and 10-Coin Turn Budget score between the Control Arm ([`benchmarks/fixtures/live-ab-baseline.jsonl`](./benchmarks/fixtures/live-ab-baseline.jsonl)) and the Stingy Arm ([`benchmarks/fixtures/live-ab-stingy.jsonl`](./benchmarks/fixtures/live-ab-stingy.jsonl)):

```bash
npm run benchmark:live-ab
node ./bin/stingy.mjs roast ./benchmarks/fixtures/live-ab-baseline.jsonl
node ./bin/stingy.mjs roast ./benchmarks/fixtures/live-ab-stingy.jsonl
```

| Metric | Baseline Agent (No Stingy) | Stingy Agent (`/stingy scrooge`) | Change in Replay |
| :--- | ---: | ---: | ---: |
| **Bugs Correctly Found & Line #** | **3 / 3 (100%)** (Lines 741, 617, 882) | **3 / 3 (100%)** (Lines 741, 617, 882) | **Identical Accuracy** |
| **LLM Planner Turns** | `4 turns` (`15 steps`) | `4 turns` (`10 steps`) | **-5 steps** |
| **Unbounded Full-File Reads** | `9x` | `0x` | **-100%** |
| **Surgical Line-Range Reads** | `0x` | `3x` (+ 1 grep) | **100% Bounded** |
| **Uncached Hardware Input Tokens** | `142,542 tok` | `19,449 tok` | **-86.4%** |
| **Tool Output Payload** | `376,606 chars` (≈ `94,152 tok`) | `36,281 chars` (≈ `9,071 tok`) | **-90.4%** |
| **10-Coin Turn Budget Score** | `36.0 / 10.0 Coins` (**BANKRUPT**) | `3.5 / 10.0 Coins` (**PASS**) | **Within Budget** |

---

## 📊 Synthetic Trace & Prompt-Cache Model (`npm run benchmark`)

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
* **Scope** `benchmarks/run-benchmark.mjs` replays synthetic tool traces. `roast` estimates avoidable waste from historical sessions using tool-output size and fallback heuristics. On our 25 local sessions totaling 18,519 steps, it estimated **29.4% avoidable tool-token waste** and flagged 97 full-file reads and 56 duplicate reads alongside 859 surgical or small reads.

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

`stingy roast` uses local tool calls and results to estimate avoidable waste and score the 10-coin budget. The default scan takes the 25 most recent matching files across these sources.

| Agent | `--source` | Default transcript location |
| :--- | :--- | :--- |
| Claude Code | `claude` | `~/.claude/projects` and `~/.config/claude/projects` |
| Antigravity | `antigravity` | Legacy JSONL in `~/.gemini/antigravity/brain` |
| OpenAI Codex | `codex` | JSONL in `~/.codex/sessions` and `~/.codex/archived_sessions` |
| Gemini CLI | `gemini` | JSON and JSONL sessions under `~/.gemini/tmp` |
| pi-agent | `pi` | JSONL in `~/.pi/agent/sessions` |
| OpenClaw | `openclaw` | JSONL under `~/.openclaw/agents` |
| GitHub Copilot CLI | `copilot` | `~/.copilot/session-state/*/events.jsonl` |

Discovery respects `CLAUDE_CONFIG_DIR`, `ANTIGRAVITY_DATA_DIR`, `CODEX_HOME`, `GEMINI_DATA_DIR`, `PI_AGENT_DIR`, `OPENCLAW_DIR`, and `COPILOT_HOME`. Pass a file to inspect a saved transcript, including a `codex exec --json` export. Stingy uses Codex command metadata to identify reads and searches where available. It scores other shell calls as commands.

* **Per-Session Isolation:** Duplicate file re-read tracking (`uneditedReadPaths`) is strictly scoped per session file — reading `config.ts` once in two separate sessions is never flagged as a duplicate read.
* **User-Turn Grouping vs. Avoidable Waste:** All assistant tool calls between one human prompt and the next are accumulated into a single User Turn (ignoring automated `tool_result` wrapper events). Note that **Turn Budget (`>10.0 Coins`)** and **Avoidable Token Waste** measure two orthogonal dimensions: executing 15 surgical reads in a single turn costs `15.0 Coins` (1 Bankrupt Turn due to turn breadth) even though its **Avoidable Token Waste** is `0` tokens (`$0.00`) because every individual read was properly bounded.
* **Dynamic `tool_result` Sizing:** When `tool_result` payloads are present in the transcript, `stingy roast` measures their actual line count and character length (a 1-line file read without `offset`/`limit` is recognized as a small file with `0` waste; a 2,000-line read scales waste proportionally to its actual size, falling back to heuristics only when payloads are omitted).
* **Empty Logs:** An empty scan exits cleanly. A log containing only surgical reads reports **0 estimated wasted tokens**.

```bash
# Audit all detected transcripts or focus on Codex
node ./bin/stingy.mjs roast
node ./bin/stingy.mjs roast --source codex

# Reproduce with the bundled sample session fixture in this repo:
node ./bin/stingy.mjs roast ./benchmarks/fixtures/sample-session.jsonl
```

## Agent Usage and Estimated Cost (`stingy usage`)

`usage` prints a Stingy receipt for logged input, output, cache tokens, and model-based USD estimates. It covers Claude Code, Codex, OpenCode, Amp, Droid, Codebuff, Hermes, pi-agent, Goose, OpenClaw, Kilo, Kimi, Qwen, Copilot CLI, Gemini CLI, Antigravity, Grok Build CLI, and ZCode. [ccusage data sources](https://ccusage.com/guide/#data-sources)

With a recent `ccusage` on your PATH, Stingy runs its offline JSON session report. You can also read a saved report or pipe one in. This works for usage stored in databases, compressed logs, or telemetry exports supported by ccusage. The standalone `roast` command scores tool calls against the 10-coin budget and estimates avoidable waste from transcripts.

```bash
node ./bin/stingy.mjs usage
node ./bin/stingy.mjs usage opencode
node ./bin/stingy.mjs usage --from sessions.json --json
npx ccusage@latest session --json --offline | node ./bin/stingy.mjs usage --from -
```

---

## 📄 License

MIT License. See [LICENSE](./LICENSE).
