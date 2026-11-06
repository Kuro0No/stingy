# Live Codex comparison

November 5–6, 2026. Codex CLI `0.166.0-alpha.6`, `gpt-6.1-sol` with low reasoning, Node.js 24.18.0 on Windows. Each configuration got one fresh session per task. Reported input and output are from `turn.completed.usage`. Cached input is a subset of input. Total is input plus output.

| Configuration | Input | Of which cached | Output | Total | Total vs. control | Tasks passed |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| Control | 189,747 | 144,128 | 1,481 | 191,228 | 0.00% | 2/2 |
| Caveman | 198,544 | 168,448 | 1,350 | 199,894 | +4.53% | 2/2 |
| Ponytail full | 217,009 | 164,608 | 1,523 | 218,532 | +14.28% | 2/2 |
| Caveman + Ponytail | 265,876 | 200,448 | 1,710 | 267,586 | +39.93% | 2/2 |
| Stingy scrooge | 182,380 | 137,728 | 1,536 | 183,916 | -3.82% | 2/2 |
| RTK 1.1.0 | 189,353 | 160,512 | 1,609 | 190,962 | -0.14% | 2/2 |
| Context Mode 2.1.1 (headers only) | 68,262 | 62,720 | 620 | 68,882 | -32.35% | 1/2 |

Context Mode's comparison uses the headers control of 101,827 total tokens. Its retry task did not complete because the account hit its usage limit. A later attempt stopped during setup because the Windows sandbox could not launch. The table excludes incomplete telemetry.

## Tasks and checks

- **retry** fixed false positives in the retry analyzer at `f5d235c12d323136004c982072619c8ea036c1eb`. Verification reran the 23 existing tests and separately checked argument case, significant whitespace within quotes, and an identical failed retry.
- **headers** fixed request ID propagation in a generated 1,260-line fixture. Four tests cover case-insensitive lookup, the first usable trimmed string, and a single fallback in both the proxy and audit paths.
- Each run started from an identical failing checkout for its task. The prompt asked for a source-only patch, `node --test`, and a final answer covering the cause, change, and test result. Each completed patch passed an independent test run with the original tests. A manual review checked each final answer against the patch and its test output.

## Configuration

- The control had no added skill or tool. Caveman and Ponytail used the pinned skill text, including both in the combined arm. Stingy used its bundled `skills/stingy/SKILL.md` in scrooge mode. [Caveman source](https://github.com/JuliusBrussee/caveman/tree/2e068f735253cce28256744804785f01887d9646) · [Ponytail source](https://github.com/DietrichGebert/ponytail/tree/96608e078b2d5ea607c5c3b8b5a54d1c1fba6846)
- RTK used the OSS binary directly for supported commands and tests. Context Mode exposed only `ctx_search` over a local `src` index built before the model run. The preliminary RTK wrapper run and the denied in-session index attempt are excluded. [RTK release](https://github.com/rtk-ai/rtk/releases/tag/v1.1.0) · [Context Mode source](https://github.com/mksglu/context-mode/tree/v2.1.1)

## Per-task telemetry

| Task | Configuration | Input | Of which cached | Output | Shell bytes | MCP bytes | Final words | Quality |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: | :--- |
| retry | Control | 88,573 | 69,888 | 828 | 14,801 | 0 | 70 | Pass |
| retry | Caveman | 97,376 | 83,200 | 721 | 14,318 | 0 | 51 | Pass |
| retry | Ponytail full | 111,370 | 81,408 | 846 | 10,920 | 0 | 73 | Pass |
| retry | Caveman + Ponytail | 122,825 | 101,888 | 976 | 16,156 | 0 | 57 | Pass |
| retry | Stingy scrooge | 92,644 | 58,880 | 753 | 7,068 | 0 | 67 | Pass |
| retry | RTK 1.1.0 | 89,885 | 77,056 | 914 | 12,032 | 0 | 77 | Pass |
| retry | Context Mode 2.1.1 | — | — | — | — | — | — | Incomplete |
| headers | Control | 101,174 | 74,240 | 653 | 46,330 | 0 | 88 | Pass |
| headers | Caveman | 101,168 | 85,248 | 629 | 44,717 | 0 | 63 | Pass |
| headers | Ponytail full | 105,639 | 83,200 | 677 | 47,378 | 0 | 89 | Pass |
| headers | Caveman + Ponytail | 143,051 | 98,560 | 734 | 77,239 | 0 | 76 | Pass |
| headers | Stingy scrooge | 89,736 | 78,848 | 783 | 5,942 | 0 | 97 | Pass |
| headers | RTK 1.1.0 | 99,468 | 83,456 | 695 | 43,046 | 0 | 85 | Pass |
| headers | Context Mode 2.1.1 | 68,262 | 62,720 | 620 | 1,393 | 2,395 | 80 | Pass |

Shell and MCP bytes count result text in the CLI events. Final words count whitespace-delimited text, including the Stingy receipt. Model output tokens also cover generated tool calls and any reasoning tokens reported by the model. This sample measures token usage and test outcomes. Subscription quotas and billing rates are separate.
