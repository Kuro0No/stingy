import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  COIN_TABLE,
  isForbiddenPath,
  scoreToolAction,
  evaluateTurnBudget,
  analyzeJsonlLines
} from '../src/core.mjs';
import { runBenchmarks } from '../benchmarks/run-benchmark.mjs';
import { inspectTranscriptFile } from '../benchmarks/measure-live-ab.mjs';
import { runPluginComparison } from '../benchmarks/compare-plugins.mjs';

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const CLI_PATH = path.join(REPO_ROOT, 'bin', 'stingy.mjs');

test('Coin Table: grep search costs 0.5 coins', () => {
  const res = scoreToolAction({ type: 'grep', path: 'src/auth.ts' });
  assert.equal(res.coins, 0.5);
  assert.equal(res.category, 'GREP_SEARCH');
  assert.equal(res.bankrupt, false);
});

test('Coin Table: surgical line-range read (<=120 lines) costs 1.0 coin', () => {
  const res = scoreToolAction({
    type: 'read',
    path: 'src/auth.ts',
    startLine: 100,
    endLine: 180,
    totalFileLines: 1200
  });
  assert.equal(res.coins, 1.0);
  assert.equal(res.category, 'SURGICAL_READ');
});

test('Coin Table: Claude Code offset/limit surgical read (<=120 lines) costs 1.0 coin', () => {
  const res = scoreToolAction({
    type: 'read',
    path: 'src/auth.ts',
    offset: 50,
    limit: 80,
    totalFileLines: 1200
  });
  assert.equal(res.coins, 1.0);
  assert.equal(res.category, 'SURGICAL_READ');
});

test('Coin Table: medium line-range read (121..250 lines) costs 2.0 coins', () => {
  const res = scoreToolAction({
    type: 'read',
    path: 'src/auth.ts',
    startLine: 1,
    endLine: 180,
    totalFileLines: 1200
  });
  assert.equal(res.coins, 2.0);
  assert.equal(res.category, 'MEDIUM_READ');
});

test('Coin Table: full-file read without range on >250 line file costs 4.0 coins', () => {
  const res = scoreToolAction({
    type: 'read',
    path: 'src/auth.ts',
    totalFileLines: 950
  });
  assert.equal(res.coins, 4.0);
  assert.equal(res.category, 'FULL_FILE_READ');
});

test('Coin Table: duplicate re-read costs 5.0 coins', () => {
  const res = scoreToolAction({
    type: 'read',
    path: 'src/auth.ts',
    totalFileLines: 950,
    isDuplicateRead: true
  });
  assert.equal(res.coins, 5.0);
  assert.equal(res.category, 'DUPLICATE_REREAD');
});

test('Coin Table: reading lockfiles or node_modules triggers instant 10-coin bankruptcy', () => {
  assert.equal(isForbiddenPath('package-lock.json'), true);
  assert.equal(isForbiddenPath('node_modules/react/index.js'), true);
  assert.equal(isForbiddenPath('dist/bundle.min.js'), true);
  assert.equal(isForbiddenPath('src/index.ts'), false);

  const res = scoreToolAction({
    type: 'read',
    path: 'package-lock.json',
    startLine: 1,
    endLine: 50
  });
  assert.equal(res.coins, COIN_TABLE.FORBIDDEN_PATH_READ);
  assert.equal(res.bankrupt, true);
});

test('Claude Audit Regression #1: Empty HOME directory outputs honest "No local JSONL session transcripts found"', () => {
  const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'stingy-empty-home-'));
  try {
    const stdout = execFileSync(process.execPath, [CLI_PATH, 'roast', '--source', 'claude'], {
      env: { ...process.env, CLAUDE_CONFIG_DIR: emptyHome },
      encoding: 'utf8'
    });
    assert.match(stdout, /No local JSONL session transcripts found/i);
    assert.doesNotMatch(stdout, /WHOLE-FILE GLUTTON/i);
  } finally {
    fs.rmSync(emptyHome, { recursive: true, force: true });
  }
});

test('Claude Audit Regression #2: Perfect user log (60 surgical reads with offset/limit, 0 full reads) yields 0% waste and $0.00 wasted', () => {
  const lines = [];
  for (let i = 1; i <= 60; i++) {
    lines.push(
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          usage: { input_tokens: 1200, output_tokens: 150 },
          content: [
            {
              type: 'tool_use',
              name: 'Read',
              input: { file_path: `src/module_${i}.ts`, offset: 10, limit: 80 }
            }
          ]
        }
      })
    );
  }

  const stats = analyzeJsonlLines(lines);
  assert.equal(stats.surgicalReads, 60);
  assert.equal(stats.fullFileReads, 0);
  assert.equal(stats.duplicateReads, 0);
  assert.equal(stats.wastedTokens, 0);
  assert.equal(stats.wastedUsd, 0);
  assert.equal(stats.savingsPct, 0);
});

test('ChatGPT Audit Regression #1: Cross-session isolation prevents false duplicate reads across separate session files', () => {
  const sessionA = [
    JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'src/shared.ts' } }]
      }
    })
  ];
  const sessionB = [
    JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'src/shared.ts' } }]
      }
    })
  ];

  const stats = analyzeJsonlLines([sessionA, sessionB]);
  assert.equal(stats.fullFileReads, 2);
  assert.equal(stats.duplicateReads, 0, 'Reading the same file once in two separate sessions is NOT a duplicate read');
});

test('ChatGPT Audit Regression #2: Three 4-coin reads across sequential assistant records under ONE human prompt sum to 12.0 coins and flag 1 bankrupt turn', () => {
  const singleTurnMultiStepSession = [
    JSON.stringify({
      type: 'user',
      message: { role: 'user', content: 'Please check the three service files' }
    }),
    JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tu_1', name: 'Read', input: { file_path: 'src/a.ts' } }]
      }
    }),
    // Automated tool_result record (role: 'user' in Anthropic schema, but NOT a new human prompt!)
    JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'line\n'.repeat(400) }]
      }
    }),
    JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tu_2', name: 'Read', input: { file_path: 'src/b.ts' } }]
      }
    }),
    JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tu_3', name: 'Read', input: { file_path: 'src/c.ts' } }]
      }
    })
  ];

  const stats = analyzeJsonlLines(singleTurnMultiStepSession);
  assert.equal(stats.totalTurnsScored, 1);
  assert.equal(stats.avgTurnCoins, 12.0);
  assert.equal(stats.bankruptTurns, 1);
});

test('ChatGPT Audit Regression #3: Dynamic tool_result sizing treats 1-line Read as 0 waste and 2,000-line Read proportionally', () => {
  const oneLineSession = [
    JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'r1', name: 'Read', input: { file_path: 'src/tiny.ts' } }]
      }
    }),
    JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'r1', content: 'export const VERSION = "1.0.0";' }]
      }
    })
  ];

  const huge2000LineSession = [
    JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'r2', name: 'Read', input: { file_path: 'src/giant.ts' } }]
      }
    }),
    JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'r2',
            content: Array.from({ length: 2000 }, (_, i) => `const line_${i} = ${i}; // padding text`).join('\n')
          }
        ]
      }
    })
  ];

  const tinyStats = analyzeJsonlLines(oneLineSession);
  assert.equal(tinyStats.surgicalReads, 1, '1-line file read should be classified as small/surgical');
  assert.equal(tinyStats.fullFileReads, 0);
  assert.equal(tinyStats.wastedTokens, 0, '1-line file read wastes 0 tokens');

  const hugeStats = analyzeJsonlLines(huge2000LineSession);
  assert.equal(hugeStats.fullFileReads, 1);
  assert.ok(hugeStats.wastedTokens > 10000, `2,000-line read should waste >10,000 tokens (got ${hugeStats.wastedTokens})`);
});

test('ChatGPT Audit Regression #4: stingy init creates both .claude/skills/stingy/SKILL.md and .agents/skills/stingy/SKILL.md', () => {
  const tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'stingy-init-test-'));
  try {
    execFileSync(process.execPath, [CLI_PATH, 'init', '--mode', 'scrooge'], {
      cwd: tempWorkspace,
      encoding: 'utf8'
    });
    assert.equal(
      fs.existsSync(path.join(tempWorkspace, '.claude', 'skills', 'stingy', 'SKILL.md')),
      true,
      'Must create Claude Code project skill at .claude/skills/stingy/SKILL.md'
    );
    assert.equal(
      fs.existsSync(path.join(tempWorkspace, '.agents', 'skills', 'stingy', 'SKILL.md')),
      true,
      'Must create universal agent skill at .agents/skills/stingy/SKILL.md'
    );
  } finally {
    fs.rmSync(tempWorkspace, { recursive: true, force: true });
  }
});

test('Claude Round-3 Regression #1: tool_result with array of [{type:"text", text:"..."}] preserves real newlines and flags 500-line read', () => {
  const blockArraySession = [
    JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tu_arr', name: 'Read', input: { file_path: 'src/block-array.ts' } }]
      }
    }),
    JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu_arr',
            content: [
              {
                type: 'text',
                text: Array.from({ length: 500 }, (_, i) => `export const item_${i} = ${i};`).join('\n')
              }
            ]
          }
        ]
      }
    })
  ];

  const stats = analyzeJsonlLines(blockArraySession);
  assert.equal(stats.fullFileReads, 1, '500-line array-block tool_result must be classified as fullFileRead');
  assert.equal(stats.surgicalReads, 0);
  assert.ok(stats.wastedTokens > 2000, `Expected >2000 wasted tokens, got ${stats.wastedTokens}`);
});

test('Claude & Codex Round-3 Regression #2: offset without limit on a 3,000-line file is NOT treated as a 100-line surgical read', () => {
  const offsetOnlySession = [
    JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'tu_off', name: 'Read', input: { file_path: 'src/huge.ts', offset: 5 } }
        ]
      }
    }),
    JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu_off',
            content: Array.from({ length: 3000 }, (_, i) => `const row_${i} = "payload_${i}";`).join('\n')
          }
        ]
      }
    })
  ];

  const stats = analyzeJsonlLines(offsetOnlySession);
  assert.equal(stats.fullFileReads, 1);
  assert.equal(stats.surgicalReads, 0);
  assert.ok(stats.wastedTokens > 15000);
});

test('Codex Round-3 Regression #3: Receipt line-item USD (fullReadUsd) matches total wastedUsd on dynamic 2,000-line read', () => {
  const singleHugeReadSession = [
    JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'r_usd', name: 'Read', input: { file_path: 'src/giant.ts' } }]
      }
    }),
    JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'r_usd',
            content: Array.from({ length: 2000 }, (_, i) => `const line_${i} = ${i}; // padding text`).join('\n')
          }
        ]
      }
    })
  ];

  const stats = analyzeJsonlLines(singleHugeReadSession);
  assert.equal(stats.fullReadUsd, stats.wastedUsd, 'Line-item fullReadUsd must equal total wastedUsd');
  assert.ok(stats.fullReadUsd > 0.03, `Expected >$0.03 for 2,000-line read, got $${stats.fullReadUsd}`);
});

test('Codex Round-3 Regression #4: Two distinct failed commands (npm vs git) are not counted as a blind retry, whereas same command is', () => {
  const distinctCmds = [
    JSON.stringify({
      type: 'PLANNER_RESPONSE',
      status: 'ERROR',
      tool_calls: [{ name: 'run_command', arguments: { CommandLine: 'npm test' } }]
    }),
    JSON.stringify({
      type: 'PLANNER_RESPONSE',
      status: 'ERROR',
      tool_calls: [{ name: 'run_command', arguments: { CommandLine: 'git status' } }]
    })
  ];

  const sameCmds = [
    JSON.stringify({
      type: 'PLANNER_RESPONSE',
      status: 'ERROR',
      tool_calls: [{ name: 'run_command', arguments: { CommandLine: 'npm test' } }]
    }),
    JSON.stringify({
      type: 'PLANNER_RESPONSE',
      status: 'ERROR',
      tool_calls: [{ name: 'run_command', arguments: { CommandLine: 'npm test' } }]
    })
  ];

  assert.equal(analyzeJsonlLines(distinctCmds).commandRetries, 0);
  assert.equal(analyzeJsonlLines(sameCmds).commandRetries, 1);
});

test('Codex Round-3 Regression #5: stingy init from a directory path containing spaces copies full SKILL.md (not fallback)', () => {
  const spaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stingy space path '));
  try {
    const binDir = path.join(spaceRoot, 'bin');
    const srcDir = path.join(spaceRoot, 'src');
    const skillDir = path.join(spaceRoot, 'skills', 'stingy');
    const workDir = path.join(spaceRoot, 'work project');
    fs.mkdirSync(binDir, { recursive: true });
    fs.mkdirSync(srcDir, { recursive: true });
    fs.mkdirSync(skillDir, { recursive: true });
    fs.mkdirSync(workDir, { recursive: true });

    fs.copyFileSync(path.join(REPO_ROOT, 'bin', 'stingy.mjs'), path.join(binDir, 'stingy.mjs'));
    for (const module of ['core.mjs', 'transcripts.mjs', 'usage.mjs']) {
      fs.copyFileSync(path.join(REPO_ROOT, 'src', module), path.join(srcDir, module));
    }
    fs.copyFileSync(path.join(REPO_ROOT, 'skills', 'stingy', 'SKILL.md'), path.join(skillDir, 'SKILL.md'));

    execFileSync(process.execPath, [path.join(binDir, 'stingy.mjs'), 'init'], {
      cwd: workDir,
      encoding: 'utf8'
    });

    const installedContent = fs.readFileSync(
      path.join(workDir, '.claude', 'skills', 'stingy', 'SKILL.md'),
      'utf8'
    );
    assert.ok(
      installedContent.length > 1500,
      `Expected full SKILL.md (>1500 chars) when path has spaces, got ${installedContent.length} chars`
    );
  } finally {
    fs.rmSync(spaceRoot, { recursive: true, force: true });
  }
});

test('Codex Round-4 Regression #1: npm test followed by npm run typecheck is NOT counted as a retry (full command normalized)', () => {
  const diffSubcommands = [
    JSON.stringify({
      type: 'PLANNER_RESPONSE',
      status: 'ERROR',
      tool_calls: [{ name: 'run_command', arguments: { CommandLine: 'npm test' } }]
    }),
    JSON.stringify({
      type: 'PLANNER_RESPONSE',
      status: 'ERROR',
      tool_calls: [{ name: 'run_command', arguments: { CommandLine: 'npm run typecheck' } }]
    })
  ];
  assert.equal(analyzeJsonlLines(diffSubcommands).commandRetries, 0);
});

test('Codex Round-4 Regression #2: Failed command retry without tool_result keeps retryUsd === wastedUsd ($0.0072)', () => {
  const twoFailedRetriesNoResult = [
    JSON.stringify({
      type: 'PLANNER_RESPONSE',
      status: 'ERROR',
      tool_calls: [{ name: 'run_command', arguments: { CommandLine: 'npm test' } }]
    }),
    JSON.stringify({
      type: 'PLANNER_RESPONSE',
      status: 'ERROR',
      tool_calls: [{ name: 'run_command', arguments: { CommandLine: 'npm test' } }]
    })
  ];
  const stats = analyzeJsonlLines(twoFailedRetriesNoResult);
  assert.equal(stats.commandRetries, 1);
  assert.equal(stats.retryUsd, stats.wastedUsd, `Expected retryUsd (${stats.retryUsd}) === wastedUsd (${stats.wastedUsd})`);
});

test('Codex Round-4 Regression #3: Literal JSON null or primitive lines in JSONL do not throw TypeError', () => {
  const linesWithNulls = [
    'null',
    '123',
    '"string_line"',
    '[]',
    JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'src/ok.ts', offset: 1, limit: 50 } }]
      }
    })
  ];
  const stats = analyzeJsonlLines(linesWithNulls);
  assert.equal(stats.surgicalReads, 1);
});

test('Claude Round-4 Regression #4: stingy roast on non-existent path reports "Path not found"', () => {
  const stdout = execFileSync(process.execPath, [CLI_PATH, 'roast', './definitely-missing-file-999.jsonl'], {
    encoding: 'utf8'
  });
  assert.match(stdout, /Path not found/i);
});

test('Codex Round-5 Regression #1: Command argument case sensitivity is preserved (grep Foo vs grep foo is NOT a retry)', () => {
  const caseDiffArgs = [
    JSON.stringify({
      type: 'PLANNER_RESPONSE',
      status: 'ERROR',
      tool_calls: [{ name: 'run_command', arguments: { CommandLine: 'grep Foo src/auth.ts' } }]
    }),
    JSON.stringify({
      type: 'PLANNER_RESPONSE',
      status: 'ERROR',
      tool_calls: [{ name: 'run_command', arguments: { CommandLine: 'grep foo src/auth.ts' } }]
    })
  ];
  assert.equal(analyzeJsonlLines(caseDiffArgs).commandRetries, 0);
});

test('Codex Round-5 Regression #2: Sub-cent receipt line items switch to 4 decimals so two $0.00 items never sum to $0.01', () => {
  const fixturePath = path.join(REPO_ROOT, 'benchmarks', 'fixtures', 'sample-session.jsonl');
  const stdout = execFileSync(process.execPath, [CLI_PATH, 'roast', fixturePath], {
    encoding: 'utf8'
  });
  // Verify every dollar figure on the sample fixture receipt uses consistent 4-decimal precision
  assert.match(stdout, /\$0\.0084/);
  assert.match(stdout, /\$0\.0108/);
  assert.match(stdout, /\$0\.0072/);
  assert.match(stdout, /\$0\.0276/);
});

test('Retry matching preserves whitespace in quoted shell arguments', () => {
  const first = 'grep "two  spaces" src/auth.ts';
  const second = 'grep "two spaces" src/auth.ts';
  const failed = (command) =>
    JSON.stringify({
      status: 'ERROR',
      tool_calls: [{ name: 'run_command', arguments: { CommandLine: command } }]
    });
  assert.equal(analyzeJsonlLines([failed(first), failed(second)]).commandRetries, 0);
  assert.equal(analyzeJsonlLines([failed(first), failed(first)]).commandRetries, 1);
  assert.equal(analyzeJsonlLines([failed(first), failed('')]).commandRetries, 0);
});

test('The receipt adds precision when cent rounding would inflate the baseline', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'stingy-receipt-'));
  try {
    const file = path.join(temp, 'session.jsonl');
    const records = [
      { type: 'user', content: 'fix it ' + 'x'.repeat(8493) },
      {
        tool_calls: [
          { id: 'read-1', name: 'Read', arguments: { file_path: 'src/large.ts' } }
        ]
      },
      { tool_use_id: 'read-1', content: ('x'.repeat(121) + '\n').repeat(300) }
    ];
    fs.writeFileSync(file, records.map((record) => JSON.stringify(record)).join('\n'));
    const stdout = execFileSync(process.execPath, [CLI_PATH, 'roast', file], { encoding: 'utf8' });
    assert.match(stdout, /Full-File Reads[^\n]*\$0\.0255/);
    assert.match(stdout, /Frustration[^\n]*\$0\.0255/);
    assert.match(stdout, /BASELINE COST[^\n]*\$0\.0530/);
    assert.match(stdout, /WITH STINGY MODE[^\n]*\$0\.0020/);
    assert.match(stdout, /AVOIDABLE TOKEN WASTE:[^\n]*\$0\.0510/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('Live A/B Empirical Transcripts: recorded Stingy run reduces tool payload tokens by >85% and cumulative billed tokens by >80% vs Baseline', () => {
  const basePath = path.join(REPO_ROOT, 'benchmarks', 'fixtures', 'live-ab-baseline.jsonl');
  const stingyPath = path.join(REPO_ROOT, 'benchmarks', 'fixtures', 'live-ab-stingy.jsonl');

  const b = inspectTranscriptFile(basePath);
  const s = inspectTranscriptFile(stingyPath);

  assert.ok(b.toolPayloadTokens > 80000);
  assert.ok(s.toolPayloadTokens < 10000);
  assert.equal(b.bankruptTurns, 1);
  assert.equal(s.bankruptTurns, 0);

  const cumulativeReductionPct = ((b.cumulativeBilledTokens - s.cumulativeBilledTokens) / b.cumulativeBilledTokens) * 100;
  assert.ok(cumulativeReductionPct >= 80.0, `Expected >=80% live A/B reduction, got ${cumulativeReductionPct.toFixed(1)}%`);
});

test('Benchmark Model: 3-task trace model achieves >=80% uncached token reduction and >=75% prompt-cached USD reduction', () => {
  const report = runBenchmarks();
  assert.equal(report.tasks.length, 3);
  assert.ok(report.summary.aggregateReductionPct >= 80.0);
  assert.ok(report.summary.aggregateCachedUsdReductionPct >= 75.0);
});

test('Multi-Plugin Live Telemetry Comparison: all 7 arms achieve 100% (3/3) bug accuracy + 8/8 executable assertions while Stingy & Trinity cut cost by >83%', () => {
  const { arms, execCheck } = runPluginComparison();
  assert.equal(arms.length, 7);
  assert.equal(execCheck.passed, true);
  assert.equal(execCheck.assertionsChecked, 8);

  for (const arm of arms) {
    assert.equal(arm.bugsFoundCount, 3, `Expected 3/3 bugs found for ${arm.name}`);
    assert.equal(arm.accuracyPct, 100, `Expected 100% accuracy for ${arm.name}`);
  }

  const byId = Object.fromEntries(arms.map((a) => [a.id, a]));

  // Output-only stack (caveman + ponytail) cuts output tokens & report length vs baseline,
  // but leaves input token consumption high (>100k uncached input tokens)
  assert.ok(byId['caveman-ponytail'].outputTokens < byId['none'].outputTokens);
  assert.ok(byId['caveman-ponytail'].responseChars < byId['none'].responseChars);
  assert.ok(byId['caveman-ponytail'].uncachedInputTokens > 100000);

  // Stingy-only cuts uncached input tokens by >85% and total API cost by >83%
  assert.ok(byId['stingy-only'].uncachedInputDeltaPct <= -85.0);
  assert.ok(byId['stingy-only'].usdDeltaPct <= -83.0);
  assert.equal(byId['stingy-only'].bankruptTurns, 0);

  // Full Trinity stack (stingy + caveman + ponytail) achieves lowest input tokens, lowest output tokens, and lowest total cost
  assert.ok(byId['trinity-stack'].uncachedInputDeltaPct <= -85.0);
  assert.ok(byId['trinity-stack'].usdDeltaPct <= -84.0);
  assert.ok(byId['trinity-stack'].outputTokens < byId['stingy-only'].outputTokens);
  assert.ok(byId['trinity-stack'].responseChars < byId['stingy-only'].responseChars);
  assert.equal(byId['trinity-stack'].bankruptTurns, 0);
});
