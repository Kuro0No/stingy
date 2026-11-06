import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  analyzeJsonlLines,
  evaluateTurnBudget,
  getReadLineSpan,
  isForbiddenPath,
  scoreToolAction
} from '../src/core.mjs';

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const CLI_PATH = path.join(REPO_ROOT, 'bin', 'stingy.mjs');

// ============================================================================
// 1. SYSTEM & SMOKE TESTING (End-to-End CLI: help, audit, init, roast, usage)
// ============================================================================
test('ISTQB System / Smoke Test: CLI --help and audit execute cleanly with exit code 0', () => {
  const helpOut = execFileSync(process.execPath, [CLI_PATH, '--help'], { encoding: 'utf8' });
  assert.match(helpOut, /stingy/i);
  assert.match(helpOut, /roast/i);
  assert.match(helpOut, /init/i);

  const tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'stingy-audit-sys-'));
  try {
    // Create a >12KB file so `stingy audit` flags it as a token black hole
    fs.writeFileSync(path.join(tempRepo, 'giant-bundle.js'), 'const x = 1;\n'.repeat(1500), 'utf8');
    const auditOut = execFileSync(process.execPath, [CLI_PATH, 'audit', tempRepo], {
      encoding: 'utf8'
    });
    assert.match(auditOut, /giant-bundle\.js/);
  } finally {
    fs.rmSync(tempRepo, { recursive: true, force: true });
  }
});

// ============================================================================
// 2. PERFORMANCE / LOAD / STRESS TESTING (10,000-step session under 500ms)
// ============================================================================
test('ISTQB Performance & Stress Test: 10,000 JSONL steps (5,000 tool calls + 5,000 results) complete in < 500ms', () => {
  const lines = [];
  for (let i = 0; i < 5000; i++) {
    const id = `tu_${i}`;
    lines.push(
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id,
              name: 'Read',
              input: { file_path: `src/mod_${i % 200}.ts`, offset: 1, limit: 60 }
            }
          ]
        }
      })
    );
    lines.push(
      JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: id, content: 'const a = 1;\n'.repeat(40) }]
        }
      })
    );
  }

  const startMs = performance.now();
  const stats = analyzeJsonlLines(lines);
  const elapsedMs = performance.now() - startMs;

  assert.equal(stats.totalSteps, 10000);
  assert.equal(stats.surgicalReads, 5000);
  assert.ok(
    elapsedMs < 500,
    `Expected 10,000-step stress test to finish in <500ms, took ${elapsedMs.toFixed(1)}ms`
  );
});

// ============================================================================
// 3. SECURITY TESTING (Prototype Pollution, ReDoS, XSS-safe DOM, Malformed Input)
// ============================================================================
test('ISTQB Security Test #1: Prototype pollution payloads in JSONL do not pollute Object.prototype', () => {
  const maliciousLines = [
    '{"__proto__":{"pollutedProp":"hacked"},"type":"assistant","tool_calls":[{"name":"read_file","args":{"__proto__":{"pollutedArg":"hacked"},"Path":"src/a.ts","StartLine":1,"EndLine":20}}]}',
    '{"constructor":{"prototype":{"pollutedCtor":"hacked"}},"type":"user","content":"normal prompt"}'
  ];

  analyzeJsonlLines(maliciousLines);
  assert.equal(({}).pollutedProp, undefined, 'Object.prototype must not be polluted');
  assert.equal(({}).pollutedArg, undefined, 'Object.prototype must not be polluted via args');
  assert.equal(({}).pollutedCtor, undefined, 'Object.prototype must not be polluted via constructor');
});

test('ISTQB Security Test #2: ReDoS immunity on 100,000-char pathological command & path strings', () => {
  const hugePath = 'a/'.repeat(25000) + 'package-lock.json';
  const hugeCmd = 'npm test ' + '"   '.repeat(20000) + '"';

  const t0 = performance.now();
  assert.equal(isForbiddenPath(hugePath), true);
  const stats = analyzeJsonlLines([
    JSON.stringify({
      status: 'ERROR',
      tool_calls: [{ name: 'run_command', args: { CommandLine: hugeCmd } }]
    }),
    JSON.stringify({
      status: 'ERROR',
      tool_calls: [{ name: 'run_command', args: { CommandLine: hugeCmd } }]
    })
  ]);
  const elapsed = performance.now() - t0;

  assert.equal(stats.commandRetries, 1);
  assert.ok(elapsed < 250, `ReDoS check took too long: ${elapsed.toFixed(1)}ms`);
});

test('ISTQB Security & Usability Test #3: Web UI pages use safe textContent (no unsafe innerHTML sinks) and accessible labels', () => {
  const indexHtml = fs.readFileSync(path.join(REPO_ROOT, 'docs', 'index.html'), 'utf8');
  const whiteboardHtml = fs.readFileSync(
    path.join(REPO_ROOT, 'docs', 'whiteboard-demo.html'),
    'utf8'
  );

  // Security: neither page should use innerHTML or eval() in its scripts
  assert.equal(/\.innerHTML\s*=/.test(indexHtml), false, 'docs/index.html must not use innerHTML=');
  assert.equal(
    /\.innerHTML\s*=/.test(whiteboardHtml),
    false,
    'docs/whiteboard-demo.html must not use innerHTML='
  );

  // Usability / Accessibility: all interactive form inputs in index.html have matching <label for="...">
  for (const id of ['cost-runs', 'cost-workload', 'cost-model', 'rate-input', 'rate-cached', 'rate-output']) {
    assert.match(indexHtml, new RegExp(`label\\s+for="${id}"`));
    assert.match(indexHtml, new RegExp(`id="${id}"`));
  }
});

// ============================================================================
// 4. UI / ACCEPTANCE (UAT) FUNCTIONAL TEST OF WHITEBOARD CRDT & DIRTY AABB
// ============================================================================
test('ISTQB UAT & Functional Test: Whiteboard CRDT engine in docs/whiteboard-demo.html executes multi-peer Undo/Redo + Conflict Guard + Dirty AABB', () => {
  const html = fs.readFileSync(path.join(REPO_ROOT, 'docs', 'whiteboard-demo.html'), 'utf8');
  const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(scriptMatch, 'whiteboard-demo.html must contain inline script');

  // Extract CanvasStateManager and computeDirtyBounds from the actual HTML script
  const codeSlice = scriptMatch[1].split('// Interactive Canvas Controller')[0];
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(
    `${codeSlice}\n;globalThis.CanvasStateManager = CanvasStateManager; globalThis.computeDirtyBounds = computeDirtyBounds;`,
    sandbox
  );

  const sm = new sandbox.CanvasStateManager();
  const elA = { id: 'el-1', type: 'rect', x: 10, y: 20, width: 100, height: 50, stroke: '#0ff', version: 1, authorId: 'peer-alice' };
  const elB = { id: 'el-2', type: 'circle', x: 200, y: 300, width: 80, height: 80, stroke: '#f0f', version: 1, authorId: 'peer-bob' };

  sm.recordMutation('peer-alice', null, elA);
  sm.recordMutation('peer-bob', null, elB);
  assert.equal(sm.getAllElements().length, 2);

  // 1. Alice undoes her creation -> Bob's element remains untouched
  const beforeUndo = sm.getAllElements();
  const undoRes = sm.undo('peer-alice');
  assert.equal(undoRes.changed, true);
  assert.equal(undoRes.elements.length, 1);
  assert.equal(undoRes.elements[0].id, 'el-2');

  // 2. Dirty AABB covers exactly el-1's region [10, 20, 110, 70]
  const dirty = sandbox.computeDirtyBounds(beforeUndo, undoRes.elements);
  assert.deepEqual({ ...dirty }, { minX: 10, minY: 20, maxX: 110, maxY: 70 });

  // 3. Alice redoes her creation -> version bumped to 2
  const redoRes = sm.redo('peer-alice');
  assert.equal(redoRes.changed, true);
  assert.equal(redoRes.elements.length, 2);

  // 4. Bob concurrently edits el-1 to version 3 -> Alice's undo is blocked by CRDT conflict guard
  const aliceCurrent = sm.elements.get('el-1');
  sm.recordMutation('peer-bob', aliceCurrent, { ...aliceCurrent, x: 50, version: 3, authorId: 'peer-bob' });
  const conflictUndo = sm.undo('peer-alice');
  assert.equal(conflictUndo.conflictSkipped, true);
  assert.equal(sm.elements.get('el-1').x, 50);
});
