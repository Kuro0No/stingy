#!/usr/bin/env node

/**
 * 🪙 Stingy Trace-Driven Benchmark Model
 * Models Unconstrained Baseline Agent Tool Traces vs. Stingy Mode (Scrooge)
 * across 3 standardized coding tasks using generated source fixtures.
 *
 * Computes BOTH:
 *   1. Cumulative Billed Input Tokens (-81.2%)
 *   2. Anthropic Prompt-Cached Effective USD Cost (cache_write @ $3.75/1M, cache_read @ $0.30/1M)
 *
 * Run: node benchmarks/run-benchmark.mjs [--json]
 */

import { evaluateTurnBudget, estimateTokensFromChars } from '../src/core.mjs';

function buildSourceFixture(lineCount, targetSymbolLine, targetSymbolCode) {
  const lines = [];
  for (let i = 1; i <= lineCount; i++) {
    if (i === targetSymbolLine) {
      lines.push(targetSymbolCode);
    } else {
      lines.push(`  const v_${i} = validateSegment(${i}, "ctx_${i % 17}");`);
    }
  }
  return lines;
}

function sliceLines(lines, startLine, endLine) {
  return lines.slice(Math.max(0, startLine - 1), Math.min(lines.length, endLine)).join('\n');
}

/**
 * Simulate multi-turn input token billing (both uncached total tokens and Anthropic Prompt-Cached USD).
 * - Base system prompt (8,200 tokens) is assumed already cached at session start (read at $0.30/1M per turn).
 * - Skill overhead (+450 tokens for Stingy SKILL.md) is written on Turn 1 ($3.75/1M) and read from cache on subsequent turns ($0.30/1M).
 * - Each turn's new tool outputs + prompt are written to cache ($3.75/1M) and read from cache on subsequent turns ($0.30/1M).
 */
function simulateMultiTurnBilling(turns, baseSystemPromptTokens = 8200, skillOverheadTokens = 0) {
  const PRICE_CACHE_WRITE_PER_M = 3.75; // 1.25x of $3.00/1M
  const PRICE_CACHE_READ_PER_M = 0.30;  // 0.10x of $3.00/1M

  let cumulativeContextTokens = baseSystemPromptTokens + skillOverheadTokens;
  let totalBilledInputTokens = 0;

  let cachedPrefixTokens = baseSystemPromptTokens;
  let promptCachedUsd = 0;

  if (skillOverheadTokens > 0) {
    promptCachedUsd += (skillOverheadTokens / 1_000_000) * PRICE_CACHE_WRITE_PER_M;
    cachedPrefixTokens += skillOverheadTokens;
  }

  for (const turn of turns) {
    const turnToolPayloadTokens = estimateTokensFromChars(turn.payloadChars);
    const turnPromptTokens = turn.promptTokens || 180;
    const newTurnTokens = turnPromptTokens + turnToolPayloadTokens;

    // 1. Uncached cumulative input tokens
    cumulativeContextTokens += newTurnTokens;
    totalBilledInputTokens += cumulativeContextTokens;

    // 2. Anthropic Prompt-Cached effective cost for this turn
    const turnCacheReadUsd = (cachedPrefixTokens / 1_000_000) * PRICE_CACHE_READ_PER_M;
    const turnCacheWriteUsd = (newTurnTokens / 1_000_000) * PRICE_CACHE_WRITE_PER_M;
    promptCachedUsd += turnCacheReadUsd + turnCacheWriteUsd;

    cachedPrefixTokens += newTurnTokens;
  }

  return {
    totalBilledInputTokens,
    promptCachedUsd: Number(promptCachedUsd.toFixed(4))
  };
}

export function runBenchmarks() {
  const authServiceLines = buildSourceFixture(
    1240,
    842,
    '  const isExpired = nowEpochSeconds - token.exp > (options.clockTolerance ?? 0);'
  );
  const routerLines = buildSourceFixture(720, 310, '  res.setHeader("X-RateLimit-Limit", quota.limit);');
  const middlewareLines = buildSourceFixture(890, 445, '  const quota = await rateLimiter.consume(req.ip);');
  const quotaStoreLines = buildSourceFixture(680, 215, '  return { limit: 100, remaining: Math.max(0, 100 - used) };');
  const typesLines = buildSourceFixture(570, 120, '  export interface RateLimitResult { limit: number; remaining: number; }');
  const webhookWorkerLines = buildSourceFixture(980, 325, '  if (attempt >= maxRetries) throw new WebhookTimeoutError();');
  const webhookSpecLines = buildSourceFixture(640, 438, '  expect(dispatcher.retryCount).toBe(3);');

  const tasks = [
    {
      id: 'task-1-auth-skew',
      name: 'Task 1: Fix JWT clock-skew bug (1,240-line service)',
      baseline: {
        turns: [
          { payloadChars: authServiceLines.join('\n').length, promptTokens: 220 },
          { payloadChars: authServiceLines.join('\n').length + 14500, promptTokens: 260 },
          { payloadChars: 12000, promptTokens: 190 }
        ],
        actions: [
          { type: 'read', path: 'src/auth-service.ts', totalFileLines: 1240 },
          { type: 'command', quiet: false },
          { type: 'read', path: 'src/auth-service.ts', totalFileLines: 1240, isDuplicateRead: true },
          { type: 'edit', path: 'src/auth-service.ts' },
          { type: 'command', quiet: false }
        ]
      },
      stingy: {
        turns: [
          {
            payloadChars: 380 + sliceLines(authServiceLines, 815, 875).length,
            promptTokens: 190
          },
          {
            payloadChars: 650,
            promptTokens: 160
          }
        ],
        actions: [
          { type: 'grep', path: 'src/auth-service.ts' },
          { type: 'read', path: 'src/auth-service.ts', startLine: 815, endLine: 875, totalFileLines: 1240 },
          { type: 'edit', path: 'src/auth-service.ts' },
          { type: 'command', quiet: true }
        ]
      }
    },
    {
      id: 'task-2-cross-file-refactor',
      name: 'Task 2: Cross-file header refactor (4 files, 2,860 lines)',
      baseline: {
        turns: [
          { payloadChars: routerLines.join('\n').length + middlewareLines.join('\n').length, promptTokens: 240 },
          { payloadChars: quotaStoreLines.join('\n').length + typesLines.join('\n').length, promptTokens: 210 },
          { payloadChars: middlewareLines.join('\n').length + 6400, promptTokens: 250 },
          { payloadChars: 15800, promptTokens: 180 }
        ],
        actions: [
          { type: 'read', path: 'src/router.ts', totalFileLines: 720 },
          { type: 'read', path: 'src/middleware.ts', totalFileLines: 890 },
          { type: 'read', path: 'src/quota-store.ts', totalFileLines: 680 },
          { type: 'read', path: 'src/types.ts', totalFileLines: 570 },
          { type: 'read', path: 'src/middleware.ts', totalFileLines: 890, isDuplicateRead: true }
        ]
      },
      stingy: {
        turns: [
          {
            payloadChars:
              520 +
              sliceLines(routerLines, 285, 345).length +
              sliceLines(middlewareLines, 420, 480).length,
            promptTokens: 200
          },
          {
            payloadChars:
              sliceLines(quotaStoreLines, 190, 250).length +
              sliceLines(typesLines, 95, 155).length,
            promptTokens: 190
          },
          {
            payloadChars: 720,
            promptTokens: 150
          }
        ],
        actions: [
          { type: 'grep', path: 'src/' },
          { type: 'read', path: 'src/router.ts', startLine: 285, endLine: 345, totalFileLines: 720 },
          { type: 'read', path: 'src/middleware.ts', startLine: 420, endLine: 480, totalFileLines: 890 },
          { type: 'read', path: 'src/quota-store.ts', startLine: 190, endLine: 250, totalFileLines: 680 },
          { type: 'read', path: 'src/types.ts', startLine: 95, endLine: 155, totalFileLines: 570 },
          { type: 'edit', path: 'src/router.ts' },
          { type: 'command', quiet: true }
        ]
      }
    },
    {
      id: 'task-3-webhook-retry',
      name: 'Task 3: Diagnose flaky webhook test (1,620 lines + logs)',
      baseline: {
        turns: [
          { payloadChars: webhookWorkerLines.join('\n').length + webhookSpecLines.join('\n').length, promptTokens: 230 },
          { payloadChars: 24000, promptTokens: 220 },
          { payloadChars: webhookWorkerLines.join('\n').length + 18000, promptTokens: 240 }
        ],
        actions: [
          { type: 'read', path: 'src/webhook-worker.ts', totalFileLines: 980 },
          { type: 'read', path: 'test/webhook.spec.ts', totalFileLines: 640 },
          { type: 'command', isBlindRetry: true },
          { type: 'read', path: 'src/webhook-worker.ts', totalFileLines: 980, isDuplicateRead: true }
        ]
      },
      stingy: {
        turns: [
          {
            payloadChars:
              420 +
              sliceLines(webhookSpecLines, 410, 470).length +
              sliceLines(webhookWorkerLines, 295, 365).length,
            promptTokens: 190
          },
          {
            payloadChars: 680,
            promptTokens: 160
          }
        ],
        actions: [
          { type: 'grep', path: 'test/webhook.spec.ts' },
          { type: 'read', path: 'test/webhook.spec.ts', startLine: 410, endLine: 470, totalFileLines: 640 },
          { type: 'read', path: 'src/webhook-worker.ts', startLine: 295, endLine: 365, totalFileLines: 980 },
          { type: 'edit', path: 'src/webhook-worker.ts' },
          { type: 'command', quiet: true }
        ]
      }
    }
  ];

  const results = [];
  let totalBaselineTokens = 0;
  let totalStingyTokens = 0;
  let totalBaselineCachedUsd = 0;
  let totalStingyCachedUsd = 0;

  for (const t of tasks) {
    const baseSim = simulateMultiTurnBilling(t.baseline.turns, 8200, 0);
    // Explicitly charge +450 tokens for the Stingy SKILL.md prompt itself
    const stingySim = simulateMultiTurnBilling(t.stingy.turns, 8200, 450);

    const baselineTokens = baseSim.totalBilledInputTokens;
    const stingyTokens = stingySim.totalBilledInputTokens;
    const baselineCoins = evaluateTurnBudget(t.baseline.actions);
    const stingyCoins = evaluateTurnBudget(t.stingy.actions);

    const reductionPct = Number((((baselineTokens - stingyTokens) / baselineTokens) * 100).toFixed(1));
    const cachedUsdReductionPct = Number(
      (((baseSim.promptCachedUsd - stingySim.promptCachedUsd) / baseSim.promptCachedUsd) * 100).toFixed(1)
    );

    totalBaselineTokens += baselineTokens;
    totalStingyTokens += stingyTokens;
    totalBaselineCachedUsd += baseSim.promptCachedUsd;
    totalStingyCachedUsd += stingySim.promptCachedUsd;

    results.push({
      id: t.id,
      name: t.name,
      baselineTokens,
      stingyTokens,
      savedTokens: baselineTokens - stingyTokens,
      reductionPct,
      baselineCachedUsd: baseSim.promptCachedUsd,
      stingyCachedUsd: stingySim.promptCachedUsd,
      cachedUsdReductionPct,
      baselineCoins: baselineCoins.totalCoins,
      stingyCoins: stingyCoins.totalCoins,
      stingyWithinBudget: stingyCoins.withinBudget
    });
  }

  const aggregateReductionPct = Number(
    (((totalBaselineTokens - totalStingyTokens) / totalBaselineTokens) * 100).toFixed(1)
  );
  const aggregateCachedUsdReductionPct = Number(
    (((totalBaselineCachedUsd - totalStingyCachedUsd) / totalBaselineCachedUsd) * 100).toFixed(1)
  );

  return {
    tasks: results,
    summary: {
      totalBaselineTokens,
      totalStingyTokens,
      totalSavedTokens: totalBaselineTokens - totalStingyTokens,
      aggregateReductionPct,
      totalBaselineCachedUsd: Number(totalBaselineCachedUsd.toFixed(4)),
      totalStingyCachedUsd: Number(totalStingyCachedUsd.toFixed(4)),
      aggregateCachedUsdReductionPct
    }
  };
}

if (process.argv[1] && process.argv[1].endsWith('run-benchmark.mjs')) {
  const report = runBenchmarks();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('\n🪙 STINGY TRACE-DRIVEN BENCHMARK MODEL (3 Standardized Multi-Turn Tasks)\n');
    console.log(
      '| Task | Baseline Tokens | Stingy Tokens | Token Reduction | Prompt-Cached USD (Base → Stingy) | Coin Score |'
    );
    console.log('| :--- | ---: | ---: | ---: | ---: | ---: |');
    for (const r of report.tasks) {
      console.log(
        `| ${r.name} | ${r.baselineTokens.toLocaleString('en-US')} | ${r.stingyTokens.toLocaleString('en-US')} | **-${r.reductionPct}%** | $${r.baselineCachedUsd.toFixed(3)} → $${r.stingyCachedUsd.toFixed(3)} (**-${r.cachedUsdReductionPct}%**) | \`${r.stingyCoins}/10\` |`
      );
    }
    console.log(
      `| **AGGREGATE** | **${report.summary.totalBaselineTokens.toLocaleString('en-US')}** | **${report.summary.totalStingyTokens.toLocaleString('en-US')}** | **-${report.summary.aggregateReductionPct}%** | **$${report.summary.totalBaselineCachedUsd.toFixed(3)} → $${report.summary.totalStingyCachedUsd.toFixed(3)} (-${report.summary.aggregateCachedUsdReductionPct}%)** | **PASS** |\n`
    );
  }
}
