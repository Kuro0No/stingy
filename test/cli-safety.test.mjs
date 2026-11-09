import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readLinesSync } from '../src/transcripts.mjs';
import { renderReceiptPng } from '../src/export-image.mjs';

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const CLI = path.join(REPO_ROOT, 'bin', 'stingy.mjs');
const made = [];
const tmp = (name) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `stingy-${name}-`));
  made.push(dir);
  return dir;
};
test.after(() => made.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
const run = (args, opts = {}) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', ...opts });
function bigFile(dir, lines = 400) {
  const file = path.join(dir, 'big-service.ts');
  fs.writeFileSync(file, 'export const line = 1;\n'.repeat(lines));
  return file;
}

test('stingy hook prints nothing for allowed calls, so permission prompts still apply', () => {
  const dir = tmp('hook');
  const file = bigFile(dir);
  const allowed = run(['hook'], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'rm -rf ./build' }, cwd: dir }) });
  assert.equal(allowed.status, 0);
  assert.equal(allowed.stdout, '', 'no "allow" decision: it would auto-approve the command');

  const blocked = run(['hook'], { input: JSON.stringify({ tool_name: 'Read', tool_input: { file_path: file }, cwd: dir }) });
  assert.equal(JSON.parse(blocked.stdout).hookSpecificOutput.permissionDecision, 'deny');
});

test('init --hook fails and leaves an unparsable settings.json untouched', () => {
  const dir = tmp('init-bad');
  const settings = path.join(dir, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(settings), { recursive: true });
  const original = '{\n  "permissions": { "deny": ["Read(./.env)"] },\n}\n'; // trailing comma
  fs.writeFileSync(settings, original);

  const res = run(['init', '--hook'], { cwd: dir });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /Cannot parse/);
  assert.equal(fs.readFileSync(settings, 'utf8'), original);
  assert.equal(fs.existsSync(path.join(dir, '.claude', 'hooks', 'stingy-pre-tool.mjs')), false);
});

test('init --hook keeps existing settings and installs a hook that also blocks shell dumps', () => {
  const dir = tmp('init-ok');
  const settingsPath = path.join(dir, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify({ permissions: { deny: ['Read(./.env)'] }, env: { FOO: '1' } }));
  assert.equal(run(['init', '--hook'], { cwd: dir }).status, 0);

  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  assert.deepEqual(settings.permissions, { deny: ['Read(./.env)'] });
  assert.deepEqual(settings.env, { FOO: '1' });
  assert.equal(
    settings.hooks.PreToolUse[0].hooks[0].command,
    'node "$CLAUDE_PROJECT_DIR/.claude/hooks/stingy-pre-tool.mjs"'
  );

  const hook = path.join(dir, '.claude', 'hooks', 'stingy-pre-tool.mjs');
  const file = bigFile(dir);
  const callHook = (event) =>
    execFileSync(process.execPath, [hook], { cwd: dir, input: JSON.stringify({ ...event, cwd: dir }), encoding: 'utf8' });
  assert.match(callHook({ tool_name: 'Bash', tool_input: { command: `cat "${file}"` } }), /"permissionDecision":"deny"/);
  assert.equal(callHook({ tool_name: 'Bash', tool_input: { command: `cat "${file}" | head -n 20` } }), '');
  assert.equal(callHook({ tool_name: 'Bash', tool_input: { command: 'rm -rf ./build' } }), '');
});

test('init writes the chosen mode into the installed skill and rejects unknown modes', () => {
  const dir = tmp('init-mode');
  assert.equal(run(['init', '--mode', 'lite'], { cwd: dir }).status, 0);
  const skill = fs.readFileSync(path.join(dir, '.claude', 'skills', 'stingy', 'SKILL.md'), 'utf8');
  assert.match(skill, /Default mode is \*\*`lite`\*\*/);
  assert.equal(run(['init', '--mode', 'bogus'], { cwd: dir }).status, 1);
});

test('audit fails on a missing directory, skips binary files and finds deep text files', () => {
  assert.equal(run(['audit', path.join(tmp('audit'), 'nope')]).status, 1);

  const dir = tmp('audit');
  const deep = path.join(dir, 'a', 'b', 'c', 'd', 'e', 'f', 'g');
  fs.mkdirSync(deep, { recursive: true });
  fs.writeFileSync(path.join(deep, 'deep.ts'), 'x'.repeat(40000));
  const png = Buffer.alloc(60000, 1);
  png[10] = 0;
  fs.writeFileSync(path.join(dir, 'logo.png'), png);

  const res = run(['audit', dir]);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /deep\.ts/);
  assert.doesNotMatch(res.stdout, /logo\.png/);
});

test('audit respects .gitignore inside a git repo', (t) => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
  } catch {
    t.skip('git not installed');
    return;
  }
  const dir = tmp('audit-git');
  execFileSync('git', ['init', '-q'], { cwd: dir });
  fs.writeFileSync(path.join(dir, '.gitignore'), 'ignored.txt\n');
  fs.writeFileSync(path.join(dir, 'ignored.txt'), 'x'.repeat(40000));
  fs.writeFileSync(path.join(dir, 'kept.txt'), 'x'.repeat(40000));

  const res = run(['audit', dir]);
  assert.match(res.stdout, /kept\.txt/);
  assert.doesNotMatch(res.stdout, /ignored\.txt/);
});

test('CLI: --version, unknown command exit code, no colors when piped, aligned receipt', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  assert.equal(run(['--version']).stdout.trim(), pkg.version);
  const bad = run(['bogus']);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /Unknown command: bogus/);
  assert.doesNotMatch(run(['help']).stdout, /\x1b\[/);

  const receipt = run(['roast', path.join(REPO_ROOT, 'benchmarks', 'fixtures', 'sample-session.jsonl')]).stdout;
  const width = (line) => [...line].reduce((n, ch) => n + (ch.codePointAt(0) > 0xffff ? 2 : 1), 0);
  const rows = receipt.split('\n').filter((line) => /^ {2}[|=]/.test(line));
  assert.ok(rows.length > 10);
  assert.deepEqual([...new Set(rows.map(width))], [51], 'every receipt row is 51 columns wide');
});

test('readLinesSync keeps lines, CRLF and multi-byte characters across chunk boundaries', () => {
  const file = path.join(tmp('lines'), 'session.jsonl');
  fs.writeFileSync(file, ['﻿{"a":"ồ"}', '{"b":"tiếng Việt 🪙"}', '', '{"c":3}'].join('\r\n'));
  // 5-byte chunks split the multi-byte characters and the CRLF pairs.
  assert.deepEqual(readLinesSync(file, 5), ['{"a":"ồ"}', '{"b":"tiếng Việt 🪙"}', '{"c":3}']);
});

test('PNG receipt draws a long diagnosis on a second line instead of cutting it', () => {
  const lightPixelsInRow = (png, y) => {
    const idat = [];
    for (let i = 8; i < png.length; ) {
      const len = png.readUInt32BE(i);
      if (png.toString('ascii', i + 4, i + 8) === 'IDAT') idat.push(png.subarray(i + 8, i + 8 + len));
      i += 12 + len;
    }
    const raw = zlib.inflateSync(Buffer.concat(idat));
    const stride = 560 * 4 + 1;
    let n = 0;
    for (let x = 54; x < 500; x++) if (raw[y * stride + 1 + x * 4] === 250) n++; // inside the dark banner only
    return n;
  };
  // Row 505 lies below a one-line banner text (484..497) and inside the second line (494..507).
  assert.ok(lightPixelsInRow(renderReceiptPng({ diagnosis: 'CONTEXT OVER-SPENDER (Needs Range Bounds)' }), 505) > 0);
  assert.equal(lightPixelsInRow(renderReceiptPng({ diagnosis: 'CERTIFIED SCROOGE' }), 505), 0);
});
