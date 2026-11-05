import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { analyzeJsonlLines } from '../src/core.mjs';
import { readTranscript } from '../src/transcripts.mjs';
import { USAGE_SOURCES } from '../src/usage.mjs';

const cli = fileURLToPath(new URL('../bin/stingy.mjs', import.meta.url));

function withFixture(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stingy-agents-'));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function writeJsonl(file, records) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, records.map((record) => JSON.stringify(record)).join('\n'));
}

test('Roast discovers Codex sessions and matches tool failures by call ID', () => withFixture((dir) => {
  const tool = (id) => ({
    type: 'response_item',
    payload: {
      type: 'function_call',
      name: 'exec_command',
      call_id: id,
      arguments: JSON.stringify({ cmd: 'npm test' })
    }
  });
  const result = (id) => ({
    type: 'response_item',
    payload: { type: 'function_call_output', call_id: id, output: 'Process exited with code 1\nOutput:\nfailed' }
  });
  writeJsonl(path.join(dir, 'sessions', '2026', '11', '05', 'rollout-test.jsonl'), [
    { type: 'session_meta', payload: { id: 'demo' } },
    { type: 'event_msg', payload: { type: 'user_message', message: 'Run tests' } },
    tool('a'), result('a'), tool('b'), result('b')
  ]);
  const stdout = execFileSync(process.execPath, [cli, 'roast', '--source', 'codex'], {
    env: { ...process.env, CODEX_HOME: dir },
    encoding: 'utf8'
  });
  assert.match(stdout, /LOGS SCANNED: 1 files/);
  assert.match(stdout, /Consecutive Cmd Retries\s+1x/);
  assert.match(stdout, /4\.5 \/ 10\.0 Coins/);
}));

test('Codex command metadata scores reads and searches without counting duplicate events', () => withFixture((dir) => {
  const file = path.join(dir, 'rollout-new.jsonl');
  const completed = (item) => ({ type: 'event_msg', payload: { type: 'item_completed', item } });
  writeJsonl(file, [
    completed({ type: 'UserMessage', id: 'u', content: [{ type: 'text', text: 'Inspect the repo' }] }),
    {
      type: 'response_item',
      payload: { type: 'function_call', call_id: 'r', name: 'exec_command', arguments: '{"cmd":"cat a.ts"}' }
    },
    completed({
      type: 'CommandExecution', id: 'r', exit_code: 0, command: ['cat', 'a.ts'],
      parsed_cmd: [{ type: 'read', cmd: 'cat a.ts', path: 'a.ts' }]
    }),
    {
      type: 'response_item',
      payload: { type: 'function_call_output', call_id: 'r', output: ('line of source text\n').repeat(400) }
    },
    completed({
      type: 'CommandExecution', id: 'g', exit_code: 0, command: ['rg', 'target'],
      parsed_cmd: [{ type: 'search', cmd: 'rg target' }], aggregated_output: 'a.ts:1:target'
    })
  ]);
  const stats = analyzeJsonlLines(readTranscript({ path: file }));
  assert.equal(stats.fullFileReads, 1);
  assert.equal(stats.grepCalls, 1);
  assert.equal(stats.commandCalls, 0);
  assert.equal(stats.avgTurnCoins, 4.5);
}));

test('Roast audits Codex exec JSON exports and skips certification when it sees no tool calls', () => withFixture((dir) => {
  const file = path.join(dir, 'exec.jsonl');
  const start = { type: 'thread.started', thread_id: 'fixture' };
  const failed = (id) => ({
    type: 'item.completed',
    item: { id, type: 'command_execution', command: 'node --test', exit_code: 1, aggregated_output: 'test failed' }
  });
  writeJsonl(file, [start, { type: 'turn.started' }, failed('a'), failed('b'), { type: 'turn.completed' }]);
  const roast = () => execFileSync(process.execPath, [cli, 'roast', file], { encoding: 'utf8' });
  assert.match(roast(), /Consecutive Cmd Retries\s+1x/);
  writeJsonl(file, [{ type: 'some-unrecognized-log', content: 'not an auditable event' }]);
  const unsupported = roast();
  assert.match(unsupported, /No auditable transcript records found/);
  assert.doesNotMatch(unsupported, /CERTIFIED SCROOGE/);
}));

test('Roast reads Gemini JSON sessions and merges result patches in JSONL', () => withFixture((dir) => {
  const user = { type: 'user', id: 'u', content: [{ text: 'Read the file' }] };
  const call = { id: 'call', name: 'read_file', args: { file_path: 'a.ts' }, status: 'success' };
  const result = [{ functionResponse: { response: { output: 'export const x = 1;' } } }];
  const json = path.join(dir, 'session-old.json');
  const jsonl = path.join(dir, 'session-new.jsonl');
  fs.writeFileSync(json, JSON.stringify({
    messages: [user, { type: 'gemini', id: 'g', toolCalls: [{ ...call, result }] }]
  }, null, 2));
  writeJsonl(jsonl, [
    { sessionId: 'demo', projectHash: 'fixture' },
    user,
    { type: 'gemini', id: 'g', toolCalls: [call] },
    { $patch: { updates: [{ id: 'g', toolCalls: [{ id: call.id, result }] }] } }
  ]);
  for (const file of [json, jsonl]) {
    const stats = analyzeJsonlLines(readTranscript({ path: file }));
    assert.equal(stats.surgicalReads, 1);
    assert.equal(stats.fullFileReads, 0);
    assert.equal(stats.wastedTokens, 0);
  }
}));

test('Roast reads Copilot tool events with view ranges and failures without output', () => withFixture((dir) => {
  const file = path.join(dir, 'session-state', 'test-session', 'events.jsonl');
  const start = (id, toolName, args) => ({
    type: 'tool.execution_start', data: { toolCallId: id, toolName, arguments: args }
  });
  const complete = (id, success, result) => ({
    type: 'tool.execution_complete', data: { toolCallId: id, success, result }
  });
  writeJsonl(file, [
    { type: 'user.message', data: { content: 'Inspect and test' } },
    start('r', 'view', { path: 'index.ts', view_range: [10, 80] }),
    complete('r', true, { content: 'const x = 1;' }),
    start('a', 'powershell', { command: 'npm test' }),
    complete('a', false),
    start('b', 'powershell', { command: 'npm test' }),
    complete('b', false)
  ]);
  const stdout = execFileSync(process.execPath, [cli, 'roast', '--source', 'copilot'], {
    env: { ...process.env, COPILOT_HOME: dir },
    encoding: 'utf8'
  });
  assert.match(stdout, /Surgical Line-Range Reads\s+1x/);
  assert.match(stdout, /Consecutive Cmd Retries\s+1x\s+\$0\.0072/);
}));

test('Pi and OpenClaw file transcripts match toolCall and toolResult entries', () => withFixture((dir) => {
  const file = path.join(dir, 'agents', 'main', 'sessions', 'test.jsonl');
  writeJsonl(file, [
    { type: 'session', version: 3 },
    { type: 'message', message: { role: 'user', content: 'Read a file' } },
    {
      type: 'message',
      message: { role: 'assistant', content: [{ type: 'toolCall', id: 'r', name: 'read', arguments: { path: 'a.ts' } }] }
    },
    {
      type: 'message',
      message: { role: 'toolResult', toolCallId: 'r', content: [{ type: 'text', text: 'const x = 1;' }] }
    }
  ]);
  const openclaw = execFileSync(process.execPath, [cli, 'roast', '--source', 'openclaw'], {
    env: { ...process.env, OPENCLAW_DIR: dir },
    encoding: 'utf8'
  });
  const pi = execFileSync(process.execPath, [cli, 'roast', file, '--source', 'pi'], { encoding: 'utf8' });
  for (const stdout of [openclaw, pi]) assert.match(stdout, /Surgical Line-Range Reads\s+1x/);
}));

test('Usage accepts a ccusage session report on stdin and can filter all 18 sources', () => {
  const input = JSON.stringify({
    session: USAGE_SOURCES.map((agent) => ({
      agent, inputTokens: 11, outputTokens: 5, cacheCreationTokens: 2, cacheReadTokens: 3,
      totalTokens: 25, ...(agent === 'opencode' ? {} : { totalCost: 0.01 })
    }))
  });
  const run = (...args) => JSON.parse(execFileSync(process.execPath, [cli, 'usage', '--from', '-', '--json', ...args], {
    input, encoding: 'utf8'
  }));
  const all = run();
  assert.equal(all.agents.length, 18);
  assert.equal(all.totals.totalTokens, 450);
  assert.equal(all.totals.unpricedSessions, 1);
  const focused = run('opencode');
  assert.equal(focused.agents[0].agent, 'opencode');
  assert.equal(focused.totals.cacheReadTokens, 3);
  const receipt = execFileSync(process.execPath, [cli, 'usage', 'opencode', '--from', '-'], {
    input, encoding: 'utf8'
  });
  assert.match(receipt, /STINGY USAGE RECEIPT/);
  assert.match(receipt, /opencode[^\n]*unpriced/);
});
