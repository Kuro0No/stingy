# Claude Code session usage

An anonymized aggregate from one Claude Code session export. The recorded values below come from its last `cost-state` event. They describe a mixed-model session, with no matched baseline.

| Model in the cost record | Uncached input | Cache read | Cache write | Output | CLI cost estimate |
| :--- | ---: | ---: | ---: | ---: | ---: |
| Claude Sonnet 5.5 | 78 | 5,673,538 | 139,861 | 32,088 | $1.4478338 |
| Claude Opus 5 | 28 | 1,311,282 | 67,982 | 8,693 | $1.552926 |
| Claude Haiku 5.5 | 28,885 | 12,577 | 50,663 | 9,727 | $0.034210645 |
| **Total** | **28,991** | **6,997,397** | **258,506** | **50,508** | **$3.034970445** |

The Haiku estimate includes two web search requests. Sonnet and Opus used 1-hour cache writes. Haiku used 5-minute writes. The Opus requests with recorded usage identify `claude-opus-5` in the API request, the response, and the original local transcript. `claude-opus-5-5` appears in advisor configuration with no separate usage in this cost snapshot.

## Reprice the same Sonnet requests

The 39 Sonnet 5.5 responses before the cost snapshot match its token buckets after deduplication by response ID. All 39 exceeded 100,000 input tokens when uncached input, cache reads, and cache writes were added.

| Applied API rates | Modeled token cost | Relative to Sonnet 5.5 |
| :--- | ---: | ---: |
| Sonnet 5.5 | $1.447834 | 1× |
| Opus 5.5 | $2.895668 | 2× |
| Haiku 5.5, over 100k input per request | $0.361958 | 0.25× |

This projection reuses the Sonnet token counts and cache durations. Haiku's up-to-100k tier would be 0.05× Sonnet for the same token buckets. The observed Haiku row above uses its own token counts and fees. [Anthropic API pricing](https://platform.claude.com/docs/en/about-claude/pricing)
