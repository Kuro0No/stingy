# 🪙 stingy

> **"Why burn 50,000 input tokens reading whole files when 400 tokens do trick?"**
>
> **Stingy Mode** for Claude Code, Cursor, Antigravity, and Windsurf. Enforces a ruthless per-turn **10-Coin Budget** on file reads and tool calls, cuts **75%–85% of input context bloat**, and roasts your local AI token bill.

[![License: MIT](https://img.shields.io/badge/License-MIT-black.svg)](#license)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](#)
[![Works With](https://img.shields.io/badge/works%20with-Claude%20Code%20%7C%20Cursor%20%7C%20Antigravity-orange.svg)](#)

---

## 🧩 The Missing Piece of the Token-Saving Stack

Everyone uses **Caveman** to shrink output prose and **Ponytail** to shrink output code.
**But output tokens are only ~15% of your AI bill.**

The other **85% of your money and 5-hour rate limit** is burned when your agent:
1. Calls `Read` on an entire 1,800-line file just to change 3 lines.
2. Re-reads the exact same file 4 times in one session.
3. Runs blind `edit -> test fail -> edit -> test fail` loops that re-bill your entire conversation history on every turn.

| Layer | Tool | What It Compresses | Share of Your Bill |
| :--- | :--- | :--- | :--- |
| **1. Output Prose** | `caveman` | Polite chatter & filler explanations | ~10% |
| **2. Output Code** | `ponytail` | Over-engineered boilerplate (YAGNI) | ~10% |
| **3. Input & Tool Calls** | **🪙 `stingy`** | **Full-file reads, context re-reads & retry loops** | **~80%** |

**Stingy is designed to run alongside `caveman` and `ponytail` with zero prompt conflicts.**

---

## 🧾 1. Roast Your Local AI Token Bill (`npx stingy-ai roast`)

Curious how much money your AI agent secretly lit on fire this week? Run the **100% offline** transcript autopsy against your local `~/.claude` and `~/.gemini` logs:

```bash
npx stingy-ai roast
```

```text
  =================================================
  |          🪙 STINGY TOKEN AUTOPSY 🪙           |
  |      "Why burn 50k tokens when 400 do?"       |
  |-----------------------------------------------|
  | LOGS SCANNED: 25 local session(s)             |
  |-----------------------------------------------|
  | ITEM                         QTY     EST. USD |
  |-----------------------------------------------|
  | Full-File Reads (No Range)  1360x      $61.20 |
  | Blind Command Retry Loops      2x       $0.13 |
  | Rage Prompts ("fix it/wrong")355x      $17.75 |
  | Uncompacted History Tax    35205t      $65.88 |
  | Surgical Line-Range Reads    368x       $1.47 |
  |-----------------------------------------------|
  | TOTAL TOKENS PROCESSED             62,237,047 |
  | WASTED INPUT TOKENS                30,500,560 |
  |-----------------------------------------------|
  | EST. RAW AGENT BILL:                  $298.74 |
  | WITH STINGY MODE (-64%):              $152.34 |
  | MONEY YOU LIT ON FIRE:                $146.40 |
  |-----------------------------------------------|
  | DIAGNOSIS:                                    |
  | THE WHOLE-FILE GLUTTON (Lv. 88)               |
  |-----------------------------------------------|
  | FIX IT IN 5 SECONDS:                          |
  |   npx stingy-ai init --mode scrooge           |
  |   Pairs with: caveman + ponytail              |
  =================================================
```

---

## ⚡ 2. Install as a Plugin or Skill in 5 Seconds

### Option A: Claude Code Plugin Marketplace (like `caveman`)
```bash
/plugin marketplace add <your-github-username>/stingy
/plugin install stingy@stingy
```

### Option B: Universal Skills CLI (Claude Code, Antigravity, Cursor, Codex, Windsurf)
```bash
npx skills add <your-github-username>/stingy
```

### Option C: Antigravity Plugin Bundle
Copy or clone this repo into `~/.gemini/config/plugins/stingy`:
```bash
git clone https://github.com/<your-github-username>/stingy.git ~/.gemini/config/plugins/stingy
```

### Option D: Zero-Config NPX CLI
```bash
npx stingy-ai init --mode scrooge
```

### Included Skills & Rules in the Plugin Bundle
| Customization | Type | Description |
| :--- | :--- | :--- |
| `/stingy [lite\|strict\|scrooge]` | **Skill** (`skills/stingy/SKILL.md`) | Activates the 10-Coin Turn Budget and surgical line-range read contract. |
| `/stingy-roast` | **Skill** (`skills/stingy-roast/SKILL.md`) | Audits your local session logs and prints the ASCII **Token Autopsy Receipt** right in chat. |
| `rules/AGENTS.md` | **Always-On Rule** | Enforces locate-first `grep` before `read_file` and blocks duplicate full-file reads whenever the plugin is enabled. |

---

## 🪙 How the 10-Coin Budget Contract Works

When `/stingy` is active, the agent is given a hard allowance of **10.0 Coins per turn**:

| Tool Action | Coin Cost | Rule |
| :--- | :--- | :--- |
| `grep` / `ripgrep` with path & line numbers | **0.5 Coins** | **Mandatory first step** before opening unfamiliar files. |
| `read_file` with surgical range (`≤ 120 lines`) | **1.0 Coin** | Standard surgical inspection. |
| `read_file` on a full file (`> 250 lines`) | **4.0 Coins** | **Heavily taxed.** Forbidden unless rewriting >60% of the file. |
| Re-reading a file already in context | **5.0 Coins** | **Forbidden.** Read your own context window. |
| Blind command retry after an error | **4.0 Coins** | **Salary deduction.** Diagnose root cause before retrying. |
| Reading lockfiles, `dist/`, or `node_modules/` | **10.0 Coins** | **Instant Bankruptcy.** |

At the end of every response in `strict` or `scrooge` mode, the agent prints a 1-line receipt:
```text
🪙 [SCROOGE: 1.5/10 Coins | 1 grep + 1 surgical read (65 lines) | Est. saved: ~19,200 tokens ($0.29) 🏆]
```

---

## 🔍 3. Find "Token Black Holes" in Your Repo

Find which files in your project are silently draining your context window every time an agent touches them:

```bash
npx stingy-ai audit .
```

---

## 📄 License

MIT License. Free forever. Stop feeding whole files to the token furnace.
