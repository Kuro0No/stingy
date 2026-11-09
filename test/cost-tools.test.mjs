import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { lastContextTokens } from '../src/hygiene.mjs';

const CLI = fileURLToPath(new URL('../bin/stingy.mjs', import.meta.url));
const made = [];
const tmp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stingy-cost-'));
  made.push(dir);
  return dir;
};
test.after(() => made.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
const run = (args, opts = {}) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', ...opts });

test('quiet keeps failures, the summary and the exit code', () => {
  const failing =
    "console.log('ok 0 - init fails cleanly on bad JSON'); for (let i = 1; i < 300; i++) console.log('ok ' + i + ' - passes'); console.log('not ok 301 - adds tax'); console.log('  expected: 44.99'); console.log('# fail 1'); process.exit(1)";
  const res = run(['quiet', '--', process.execPath, '-e', failing]);
  assert.equal(res.status, 1);
  assert.ok(res.stdout.trim().split('\n').length < 20, res.stdout);
  assert.match(res.stdout, /not ok 301 - adds tax/);
  assert.match(res.stdout, /expected: 44\.99/);
  assert.doesNotMatch(res.stdout, /fails cleanly/, 'a passing test named "fails" is not a failure');

  const passing = run(['quiet', '--', process.execPath, '-e', "for (let i = 0; i < 300; i++) console.log('ok ' + i)"]);
  assert.equal(passing.status, 0);
  assert.ok(passing.stdout.trim().split('\n').length <= 9, passing.stdout);
});

test('hygiene warns once per 100k step above the limit, and stays quiet below it', () => {
  const transcript = path.join(tmp(), 'session.jsonl');
  const call = (n, extra = {}) =>
    JSON.stringify({ type: 'assistant', ...extra, message: { usage: { input_tokens: 10, cache_read_input_tokens: n } } });
  const hygiene = () => run(['hygiene'], { input: JSON.stringify({ transcript_path: transcript }) }).stdout;

  // A subagent call (isSidechain) has its own context and is skipped.
  fs.writeFileSync(transcript, [call(5000), call(200000), call(900000, { isSidechain: true })].join('\n'));
  assert.equal(lastContextTokens(fs.readFileSync(transcript, 'utf8')), 200010);
  assert.match(JSON.parse(hygiene()).systemMessage, /about 200k tokens/);
  assert.equal(hygiene(), '', 'one warning per step');
  fs.appendFileSync(transcript, `\n${call(260000)}`);
  assert.match(hygiene(), /about 260k tokens/);
  fs.writeFileSync(transcript, call(20000));
  assert.equal(hygiene(), '');
});

test('init --hygiene --mcp keeps existing config, installs a working hook, refuses invalid JSON', () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, '.claude'));
  fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify({ permissions: { deny: ['Read(./.env)'] } }));
  fs.writeFileSync(path.join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { other: { command: 'x' } } }));
  const res = run(['init', '--hygiene', '--mcp'], { cwd: dir });
  assert.equal(res.status, 0, res.stderr);

  const settings = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8'));
  assert.deepEqual(settings.permissions, { deny: ['Read(./.env)'] });
  assert.match(settings.hooks.UserPromptSubmit[0].hooks[0].command, /stingy-hygiene\.mjs/);
  const mcp = JSON.parse(fs.readFileSync(path.join(dir, '.mcp.json'), 'utf8'));
  assert.ok(mcp.mcpServers.other && mcp.mcpServers.stingy);

  const transcript = path.join(dir, 't.jsonl');
  fs.writeFileSync(transcript, JSON.stringify({ message: { usage: { input_tokens: 0, cache_read_input_tokens: 400000 } } }));
  const hook = spawnSync(process.execPath, [path.join(dir, '.claude', 'hooks', 'stingy-hygiene.mjs')], {
    input: JSON.stringify({ transcript_path: transcript }),
    encoding: 'utf8'
  });
  assert.match(hook.stdout, /systemMessage/);

  const bad = tmp();
  fs.writeFileSync(path.join(bad, '.mcp.json'), '{ "mcpServers": {}, }');
  assert.equal(run(['init', '--mcp'], { cwd: bad }).status, 1);
  assert.equal(fs.readFileSync(path.join(bad, '.mcp.json'), 'utf8'), '{ "mcpServers": {}, }');
});

test('mcp server answers initialize, tools/list, find with context, outline, and guards paths', async () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(
    path.join(dir, 'src', 'billing.js'),
    ['// billing', 'export function invoiceTotal(o) {', '  return rateFor(o.region);', '}', '', 'function rateFor(region) {', "  return region === 'US' ? 0 : 0.2;", '}'].join('\n')
  );
  const child = spawn(process.execPath, [CLI, 'mcp'], { cwd: dir });
  const responses = new Map();
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    for (let i; (i = buffer.indexOf('\n')) >= 0; ) {
      const msg = JSON.parse(buffer.slice(0, i));
      buffer = buffer.slice(i + 1);
      responses.set(msg.id, msg);
    }
  });
  const send = (msg) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');
  send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
  send({ method: 'notifications/initialized' });
  send({ id: 2, method: 'tools/list', params: {} });
  send({ id: 3, method: 'tools/call', params: { name: 'find', arguments: { pattern: 'function rateFor', context: 1 } } });
  send({ id: 4, method: 'tools/call', params: { name: 'outline', arguments: { path: 'src/billing.js' } } });
  send({ id: 5, method: 'tools/call', params: { name: 'find', arguments: { pattern: 'x', path: '../' } } });
  child.stdin.end();
  await new Promise((resolve) => child.on('close', resolve));

  assert.equal(responses.get(1).result.serverInfo.name, 'stingy');
  assert.deepEqual(responses.get(2).result.tools.map((t) => t.name), ['find', 'outline']);
  const found = responses.get(3).result.content[0].text;
  assert.match(found, /src[\\/]billing\.js:5-7/);
  assert.match(found, /6\tfunction rateFor/);
  assert.match(responses.get(4).result.content[0].text, /2\texport function invoiceTotal[\s\S]*6\tfunction rateFor/);
  assert.equal(responses.get(5).result.isError, true);
});
