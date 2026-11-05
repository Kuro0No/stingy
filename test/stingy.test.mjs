import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  COIN_TABLE,
  isForbiddenPath,
  scoreToolAction,
  evaluateTurnBudget,
  analyzeJsonlLines
} from '../src/core.mjs';
import { runBenchmarks } from '../benchmarks/run-benchmark.mjs';

const CLI_PATH = path.resolve(import.meta.dirname, '..', 'bin', 'stingy.mjs');

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

test('Coin Table: full-file read without range on >120 line file costs 4.0 coins', () => {
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

test('Claude Audit Regression #1: Empty HOME directory outputs honest "No local JSONL session transcripts found" (zero fake fallback numbers)', () => {
  const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'stingy-empty-home-'));
  try {
    const stdout = execFileSync(process.execPath, [CLI_PATH, 'roast'], {
      env: { ...process.env, HOME: emptyHome, USERPROFILE: emptyHome },
      encoding: 'utf8'
    });
    assert.match(stdout, /No local JSONL session transcripts found/i);
    assert.doesNotMatch(stdout, /WHOLE-FILE GLUTTON/i);
    assert.doesNotMatch(stdout, /\$2\.32/);
  } finally {
    fs.rmSync(emptyHome, { recursive: true, force: true });
  }
});

test('Claude Audit Regression #2: Perfect user log (60 surgical reads with offset/limit, 0 full reads, 0 retries, 0 rage) yields 0% waste and $0.00 wasted', () => {
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
  assert.equal(stats.commandRetries, 0);
  assert.equal(stats.rageMessages, 0);
  assert.equal(stats.wastedTokens, 0);
  assert.equal(stats.wastedUsd, 0);
  assert.equal(stats.savingsPct, 0);
  assert.equal(stats.bankruptTurns, 0);
  assert.equal(stats.avgTurnCoins, 1.0);
});

test('Transcript Autopsy Parser: accurately flags full-file reads, duplicate unedited re-reads, and resets after edit', () => {
  const sampleLines = [
    JSON.stringify({
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      tool_calls: [
        { name: 'grep_search', arguments: { Query: 'validateToken', Path: 'src' } },
        { name: 'read_file', arguments: { Path: 'src/auth.ts', StartLine: 50, EndLine: 110 } },
        { name: 'read_file', arguments: { Path: 'src/legacy.ts' } },
        { name: 'read_file', arguments: { Path: 'src/legacy.ts' } }, // duplicate unedited read!
        { name: 'edit_file', arguments: { Path: 'src/legacy.ts' } },
        { name: 'read_file', arguments: { Path: 'src/legacy.ts', StartLine: 1, EndLine: 60 } } // surgical read after edit
      ]
    }),
    JSON.stringify({
      type: 'USER_INPUT',
      content: 'That is still broken, fix it please'
    })
  ];

  const stats = analyzeJsonlLines(sampleLines);
  assert.equal(stats.grepCalls, 1);
  assert.equal(stats.surgicalReads, 2);
  assert.equal(stats.fullFileReads, 1);
  assert.equal(stats.duplicateReads, 1);
  assert.equal(stats.editCalls, 1);
  assert.equal(stats.rageMessages, 1);
  assert.ok(stats.wastedTokens > 0);
  assert.ok(stats.savingsPct > 0 && stats.savingsPct < 100);
});

test('Benchmark Suite: deterministic 3-task suite achieves >= 80% input token reduction', () => {
  const report = runBenchmarks();
  assert.equal(report.tasks.length, 3);
  for (const task of report.tasks) {
    assert.equal(task.stingyWithinBudget, true, `${task.id} should stay within 10-coin budget`);
    assert.ok(task.reductionPct >= 80.0, `${task.id} reduction (${task.reductionPct}%) should be >= 80%`);
  }
  assert.ok(
    report.summary.aggregateReductionPct >= 80.0,
    `Aggregate reduction (${report.summary.aggregateReductionPct}%) should be >= 80%`
  );
});
