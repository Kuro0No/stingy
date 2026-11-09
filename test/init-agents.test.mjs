import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../bin/stingy.mjs', import.meta.url));
const run = (args, cwd) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });
const made = [];
const tmp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stingy-agents-'));
  made.push(dir);
  return dir;
};
test.after(() => made.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');

test('init --agent all writes every agent file and keeps user text in shared files', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# Team rules\n\nUse pnpm.\n');
  const res = run(['init', '--agent', 'all', '--mode', 'lite'], dir);
  assert.equal(res.status, 0, res.stderr);

  for (const rel of [
    '.claude/skills/stingy/SKILL.md',
    '.agents/skills/stingy/SKILL.md',
    'AGENTS.md',
    'GEMINI.md',
    '.github/copilot-instructions.md',
    'CONVENTIONS.md',
    '.cursor/rules/stingy.mdc',
    '.windsurf/rules/stingy.md',
    '.clinerules/stingy.md'
  ]) {
    assert.ok(fs.existsSync(path.join(dir, rel)), `${rel} written`);
  }

  const agents = read(dir, 'AGENTS.md');
  assert.match(agents, /^# Team rules\n\nUse pnpm\.\n\n<!-- stingy:start -->\n/);
  assert.match(agents, /Default mode is \*\*`lite`\*\*/);
  assert.match(agents, /^## 🪙 Stingy Mode/m, 'headings move down one level inside a shared file');
  assert.match(agents, /sed -n '120,200p'/);
  assert.match(read(dir, '.cursor/rules/stingy.mdc'), /^---\ndescription: .+\nalwaysApply: true\n---\n\n# 🪙 Stingy Mode/);
  assert.match(read(dir, '.windsurf/rules/stingy.md'), /^---\ntrigger: always_on\n---\n\n# 🪙 Stingy Mode/);
  assert.match(res.stdout, /aider\.conf\.yml/);
});

test('re-running init replaces the stingy block in place and keeps text after it', () => {
  const dir = tmp();
  assert.equal(run(['init', '--agent', 'codex', '--mode', 'lite'], dir).status, 0);
  fs.appendFileSync(path.join(dir, 'AGENTS.md'), '\n## After\nkeep me\n');
  assert.equal(run(['init', '--agent', 'codex', '--mode', 'scrooge'], dir).status, 0);

  const text = read(dir, 'AGENTS.md');
  assert.equal(text.split('<!-- stingy:start -->').length, 2, 'exactly one stingy block');
  assert.match(text, /Default mode is \*\*`scrooge`\*\*/);
  assert.doesNotMatch(text, /Default mode is \*\*`lite`\*\*/);
  assert.match(text, /## After\nkeep me/);
});

test('a rules-only agent writes no skill folders; an unknown agent fails', () => {
  const dir = tmp();
  const res = run(['init', '--agent', 'gemini'], dir);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(fs.existsSync(path.join(dir, '.claude')), false);
  assert.doesNotMatch(res.stdout, /stingy-build/);

  const bad = run(['init', '--agent', 'vim'], dir);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /Unknown agent "vim"/);
});
