#!/usr/bin/env node

/**
 * 🪙 STINGY CLI — Input Token & Tool-Call Auditor for AI Coding Agents
 * Commands:
 *   stingy roast [path]    -> Audit local JSONL transcripts & print a Token Autopsy Receipt
 *   stingy usage [agent]   -> Summarize agent tokens and estimated cost via ccusage
 *   stingy audit [dir]     -> Find high-token text files ("Token Black Holes")
 *   stingy init [--mode]   -> Install /stingy and /stingy-build project skills
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { analyzeJsonlLines, isForbiddenPath } from '../src/core.mjs';
import { findLocalLogs, readTranscript, ROAST_SOURCES } from '../src/transcripts.mjs';
import { readUsageReport, USAGE_SOURCES } from '../src/usage.mjs';
import { evaluatePreToolHook, formatHookResponse, installPreToolHook } from '../src/hook.mjs';
import { renderReceiptSvg, renderReceiptPng } from '../src/export-image.mjs';

export { findLocalLogs };

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODES = ['lite', 'strict', 'scrooge'];

// Where each agent reads instructions. Skill agents get skill folders; the rest get the same rules in a file.
const SKILL_DIRS = { claude: '.claude', antigravity: '.agents' };
const RULE_FILES = {
  codex: { file: 'AGENTS.md', shared: true }, // Codex / ChatGPT agents and other AGENTS.md readers
  gemini: { file: 'GEMINI.md', shared: true }, // Gemini CLI
  copilot: { file: path.join('.github', 'copilot-instructions.md'), shared: true },
  aider: {
    file: 'CONVENTIONS.md',
    shared: true,
    hint: 'Aider: add "read: CONVENTIONS.md" to .aider.conf.yml (or run aider --read CONVENTIONS.md).'
  },
  cursor: {
    file: path.join('.cursor', 'rules', 'stingy.mdc'),
    wrap: (body) => `---\ndescription: Stingy Mode - fewer round trips, lean context\nalwaysApply: true\n---\n\n${body}`
  },
  windsurf: { file: path.join('.windsurf', 'rules', 'stingy.md'), wrap: (body) => `---\ntrigger: always_on\n---\n\n${body}` },
  cline: { file: path.join('.clinerules', 'stingy.md'), wrap: (body) => body }
};
const AGENTS = [...Object.keys(SKILL_DIRS), ...Object.keys(RULE_FILES)];
const BLOCK_START = '<!-- stingy:start -->';
const BLOCK_END = '<!-- stingy:end -->';

function agentsFromArgs() {
  const eq = args.find((a) => a.startsWith('--agent='));
  const i = args.indexOf('--agent');
  const raw = (eq ? eq.slice('--agent='.length) : i !== -1 ? args[i + 1] || '' : 'claude,antigravity').toLowerCase();
  const list = raw === 'all' ? AGENTS : raw.split(',').map((a) => a.trim()).filter(Boolean);
  const unknown = list.filter((a) => !AGENTS.includes(a));
  if (list.length === 0 || unknown.length) {
    throw new Error(`Unknown agent "${unknown.join(', ') || raw}". Use --agent ${AGENTS.join('|')}|all (comma list allowed).`);
  }
  return [...new Set(list)];
}

/** The skill as plain rules for agents without skills, plus a shell fallback for searches and ranged reads. */
function rulesFor(skill) {
  const body = skill.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim();
  const shell = "\n\nNo search or ranged-read tool? Search with `rg -n -C 25 \"<symbol>\" <path>` (or `grep -n -C 25`); read a range with `sed -n '120,200p' <file>`.\n";
  // Inside a shared file the headings move down one level, under that file's own title.
  return { own: body + shell, shared: (body + shell).replace(/^(#{1,5}) /gm, '#$1 ') };
}

function writeFile(file, text) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, text);
}

/** Writes the rules between stingy markers and keeps the rest of a shared file (AGENTS.md, GEMINI.md…) as it is. */
function upsertManagedBlock(file, body) {
  const block = `${BLOCK_START}\n${body.trim()}\n${BLOCK_END}`;
  const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const start = old.indexOf(BLOCK_START);
  const end = start === -1 ? -1 : old.indexOf(BLOCK_END, start);
  const next = end !== -1
    ? old.slice(0, start) + block + old.slice(end + BLOCK_END.length)
    : `${old.trimEnd()}${old.trim() ? '\n\n' : ''}${block}\n`;
  writeFile(file, next);
}

// No escape codes when output goes to a file or pipe, or when NO_COLOR is set.
const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const paint = (code) => (useColor ? code : '');
const C = {
  reset: paint('\x1b[0m'),
  bold: paint('\x1b[1m'),
  dim: paint('\x1b[2m'),
  red: paint('\x1b[31m'),
  green: paint('\x1b[32m'),
  yellow: paint('\x1b[33m'),
  cyan: paint('\x1b[36m'),
  white: paint('\x1b[37m')
};

const args = process.argv.slice(2);
const command = (args[0] || 'help').toLowerCase();

// Pad only: a value wider than its column widens the row instead of losing digits.
function padRight(str, len) {
  return String(str).padEnd(len);
}

function padLeft(str, len) {
  return String(str).padStart(len);
}

function reportArguments(allowed) {
  const options = {};
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('-')) {
      if (options.target !== undefined) throw new Error('Expected a single path or agent.');
      options.target = arg;
      continue;
    }
    if (!Object.hasOwn(allowed, arg)) throw new Error(`Unknown option ${arg}.`);
    const key = arg.slice(2);
    if (allowed[arg] === 'flag') {
      options[key] = true;
    } else if (allowed[arg] === 'optional-value') {
      const next = args[i + 1];
      if (next && !next.startsWith('-') && !/\.(jsonl|json)$/i.test(next)) {
        options[key] = args[++i];
      } else {
        options[key] = true;
      }
    } else {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value.`);
      options[key] = value;
    }
  }
  return options;
}

function runUsage() {
  const { target, source, from, json } = reportArguments({ '--source': 'value', '--from': 'value', '--json': 'flag' });
  if (target && source) throw new Error('Specify the agent as a positional argument or with --source.');
  const report = readUsageReport({ source: source ?? target, from });
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  if (report.agents.length === 0) {
    console.log('No usage sessions found.');
    return;
  }

  const number = (value) => value.toLocaleString('en-US');
  const line = (text) => `  | ${text.padEnd(45)} |`;
  const row = (agent, sessions, tokens, cost) =>
    line(`${padRight(agent, 12)} ${sessions.padStart(8)} ${tokens.padStart(11)} ${cost.padStart(11)}`);
  const printAgent = (agent, usage) => {
    const cost = usage.unpricedSessions === usage.sessions
      ? 'unpriced'
      : `$${usage.estimatedCostUsd.toFixed(6)}${usage.unpricedSessions ? '*' : ''}`;
    console.log(row(agent, number(usage.sessions), number(usage.totalTokens), cost));
  };
  const divider = '  |-----------------------------------------------|';
  const border = '  =================================================';
  console.log(`${C.yellow}${C.bold}${border}${C.reset}`);
  console.log(line('          🪙 STINGY USAGE RECEIPT 🪙'));
  console.log(divider);
  console.log(row('AGENT', 'SESSIONS', 'TOKENS', 'EST. USD'));
  for (const agent of report.agents) printAgent(agent.agent, agent);
  console.log(divider);
  printAgent('TOTAL', report.totals);
  console.log(line(`Input ${number(report.totals.inputTokens)}  /  Output ${number(report.totals.outputTokens)}`));
  console.log(line(`Cache write ${number(report.totals.cacheCreationTokens)}  /  Cache read ${number(report.totals.cacheReadTokens)}`));
  console.log(border);
  if (report.totals.unpricedSessions > 0) {
    console.log(`  Sessions without a price: ${number(report.totals.unpricedSessions)}`);
  }
  console.log('  Usage data from ccusage. Costs are estimates.');
}

/**
 * Run the Honest Token Autopsy Receipt on real JSONL transcripts.
 */
function runRoast() {
  const { target: customPath, source, svg, png } = reportArguments({
    '--source': 'value',
    '--svg': 'optional-value',
    '--png': 'optional-value'
  });
  if (source && !ROAST_SOURCES.includes(source)) {
    const usageHint = USAGE_SOURCES.includes(source) ? ` For usage totals, run stingy usage ${source}.` : '';
    throw new Error(`Transcript sources are ${ROAST_SOURCES.join(', ')}.${usageHint}`);
  }
  if (customPath && !fs.existsSync(path.resolve(process.cwd(), customPath))) {
    throw new Error(`Path not found: ${customPath}\nUsage: stingy roast [path] [--source agent]`);
  }

  const files = findLocalLogs(customPath, source);

  if (files.length === 0) {
    console.log('');
    console.log(`${C.yellow}No local JSONL session transcripts found.${C.reset}`);
    console.log(
      `${C.dim}Sources: ${source ?? ROAST_SOURCES.join(', ')}${C.reset}`
    );
    console.log(
      `${C.dim}Usage: stingy roast [path] [--source agent]${C.reset}`
    );
    console.log('');
    return;
  }

  const sessionList = [];
  for (const f of files) {
    try {
      const lines = readTranscript(f);
      if (lines.length > 0) {
        sessionList.push(lines);
      }
    } catch {
      // skip unreadable file
    }
  }

  const s = analyzeJsonlLines(sessionList);

  if (s.totalTurnsScored === 0) {
    console.log('');
    console.log(`${C.yellow}No auditable transcript records found in scanned files.${C.reset}`);
    console.log('');
    return;
  }

  let diagnosis = 'CERTIFIED SCROOGE (0% Waste Detected)';
  if (s.wastedTokens === 0) {
    diagnosis = 'CERTIFIED SCROOGE (0% Waste Detected)';
  } else if (s.duplicateReads > 5) {
    diagnosis = 'THE GOLDFISH AGENT (Re-reads Same Files)';
  } else if (s.fullFileReads > s.surgicalReads * 2 && s.fullFileReads >= 5) {
    diagnosis = 'THE WHOLE-FILE GLUTTON (Unbounded Reads)';
  } else if (s.commandRetries >= 5) {
    diagnosis = 'THE BLIND LOOP GAMBLER (Retry Loops)';
  } else if (s.savingsPct >= 25) {
    diagnosis = 'CONTEXT OVER-SPENDER (Needs Range Bounds)';
  } else {
    diagnosis = 'DISCIPLINED CODER (Low Context Waste)';
  }

  const readWasteCount = s.fullFileReads + s.mediumReads + s.forbiddenReads;
  const readWasteLabel = s.mediumReads || s.forbiddenReads
    ? 'Full/Medium/Forbidden Reads'
    : 'Full-File Reads (No Range)';
  const row = (label, count, tokens) =>
    `  | ${padRight(label, 27)} ${padLeft(count + 'x', 5)}  ${tokens.toLocaleString('en-US').padStart(10)} |`;

  console.log('');
  console.log(`${C.yellow}${C.bold}  =================================================${C.reset}`);
  console.log(`${C.yellow}${C.bold}  |          🪙 STINGY TOKEN AUTOPSY 🪙           |${C.reset}`);
  console.log(`${C.yellow}  |      "Why burn 50k tokens when 400 do?"       |${C.reset}`);
  console.log(`  |-----------------------------------------------|`);
  console.log(
    `  | LOGS SCANNED: ${padRight(`${sessionList.length} files (${s.totalSteps} steps)`, 31)} |`
  );
  console.log(`  |-----------------------------------------------|`);
  console.log(`  | ITEM                         QTY   EST. WASTE |`);
  console.log(`  |-----------------------------------------------|`);
  console.log(row(readWasteLabel, readWasteCount, s.readWastedTokens));
  console.log(row('Duplicate File Re-Reads', s.duplicateReads, s.dupReadWastedTokens));
  console.log(row('Consecutive Cmd Retries', s.commandRetries, s.retryWastedTokens));
  console.log(`${C.green}${row('Surgical Line-Range Reads', s.surgicalReads, 0)}${C.reset}`);
  console.log(`${C.green}${row('Targeted Grep Searches', s.grepCalls, 0)}${C.reset}`);
  console.log(`  |-----------------------------------------------|`);
  console.log(
    `  | AVG COINS PER WORKER TURN: ${`${s.avgTurnCoins} / 10.0 Coins`.padStart(18)} |`
  );
  console.log(
    `  | BANKRUPT WORKER TURNS:     ${padLeft(`${s.bankruptTurns} / ${s.totalTurnsScored} turns`, 18)} |`
  );
  console.log(`  |-----------------------------------------------|`);
  console.log(
    `  | EST. TOOL CONTEXT TOKENS   ${padLeft(s.totalTokens.toLocaleString('en-US'), 18)} |`
  );
  console.log(
    `  | AVOIDABLE WASTED TOKENS    ${padLeft(`${s.wastedTokens.toLocaleString('en-US')} (${s.savingsPct}%)`, 18)} |`
  );
  console.log(`  |-----------------------------------------------|`);
  console.log(`  | DIAGNOSIS:                                    |`);
  console.log(`  | ${C.cyan}${C.bold}${padRight(diagnosis, 45)}${C.reset} |`);
  console.log(`${C.yellow}${C.bold}  =================================================${C.reset}`);
  console.log(`  Fix-like prompts (keyword signal only): ${s.rageMessages}. Excluded from waste totals.`);
  console.log('  Tool waste uses estimated token counts. For usage and model-based estimates, run stingy usage.');

  const receiptData = {
    filesCount: sessionList.length,
    totalSteps: s.totalSteps,
    readWasteLabel,
    readWasteCount,
    readWastedTokens: s.readWastedTokens,
    duplicateReads: s.duplicateReads,
    dupReadWastedTokens: s.dupReadWastedTokens,
    commandRetries: s.commandRetries,
    retryWastedTokens: s.retryWastedTokens,
    rageMessages: s.rageMessages,
    surgicalReads: s.surgicalReads,
    grepCalls: s.grepCalls,
    avgTurnCoins: s.avgTurnCoins,
    bankruptTurns: s.bankruptTurns,
    totalTurnsScored: s.totalTurnsScored,
    totalTokens: s.totalTokens,
    wastedTokens: s.wastedTokens,
    savingsPct: s.savingsPct,
    diagnosis
  };

  if (svg) {
    const svgPath = path.resolve(
      process.cwd(),
      typeof svg === 'string' ? svg : 'stingy-receipt.svg'
    );
    fs.writeFileSync(svgPath, renderReceiptSvg(receiptData), 'utf8');
    console.log(`  ${C.green}✓ Saved SVG receipt:${C.reset} ${svgPath}`);
  }

  if (png) {
    const pngPath = path.resolve(
      process.cwd(),
      typeof png === 'string' ? png : 'stingy-receipt.png'
    );
    fs.writeFileSync(pngPath, renderReceiptPng(receiptData));
    console.log(`  ${C.green}✓ Saved PNG receipt:${C.reset} ${pngPath}`);
  }

  console.log('');
}

/**
 * Audit a workspace directory to find "Token Black Holes"
 */
const AUDIT_IGNORED_DIRS = new Set([
  '.git', 'node_modules', '.next', 'dist', 'build', 'coverage', 'vendor', '.venv', 'venv', '__pycache__',
  'target', '.gradle', 'Pods', '.dart_tool', 'out', '.turbo', '.cache'
]);

/** Files git would track (respects .gitignore); outside a git repo, a full walk that skips generated folders. */
function listAuditFiles(dir) {
  try {
    const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 512 * 1024 * 1024
    });
    return out.split('\0').filter(Boolean).map((f) => path.join(dir, f));
  } catch {
    const files = [];
    (function walk(d) {
      let entries = [];
      try {
        entries = fs.readdirSync(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (AUDIT_IGNORED_DIRS.has(entry.name)) continue;
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile()) files.push(full);
      }
    })(dir);
    return files;
  }
}

/** Same rule as git: a NUL byte in the first 8000 bytes means binary (images, archives, fonts). */
function isBinaryFile(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(8000);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    return buf.subarray(0, n).includes(0);
  } finally {
    fs.closeSync(fd);
  }
}

function runAudit(targetDir = process.cwd()) {
  const root = path.resolve(targetDir);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`Not a directory: ${targetDir}`);
  }

  const heavyFiles = [];
  for (const full of listAuditFiles(root)) {
    try {
      const stat = fs.statSync(full);
      if (stat.size > 12 * 1024 && !isBinaryFile(full)) {
        heavyFiles.push({
          relPath: path.relative(root, full),
          bytes: stat.size,
          estTokens: Math.round(stat.size / 4)
        });
      }
    } catch {
      // deleted or unreadable: skip
    }
  }
  heavyFiles.sort((a, b) => b.estTokens - a.estTokens);
  const top = heavyFiles.slice(0, 10);

  console.log(
    `\n${C.yellow}${C.bold}🪙 STINGY REPO AUDIT — Top Token Black Holes in ${path.basename(root)}${C.reset}\n`
  );

  if (top.length === 0) {
    console.log(
      `${C.green}✓ Clean repo! No files >12KB found that would blow up your context window.${C.reset}\n`
    );
    return;
  }

  console.log(`  ${padRight('FILE PATH', 42)} ${padLeft('EST. TOKENS', 14)}   ${padLeft('COIN COST', 10)}`);
  console.log(`  ${'-'.repeat(70)}`);
  for (const f of top) {
    // Same table as the skill: only generated/lock paths are bankrupt; a big source file is a 4-coin full read.
    const coins = isForbiddenPath(f.relPath) ? '10.0 (BAN)' : f.estTokens > 3000 ? '4.0 Coins' : '2.0 Coins';
    console.log(
      `  ${padRight(f.relPath, 42)} ${C.red}${padLeft(f.estTokens.toLocaleString('en-US') + ' tok', 14)}${C.reset}   ${padLeft(coins, 10)}`
    );
  }
  console.log(
    `\n  ${C.cyan}Tip:${C.reset} Run ${C.bold}npx github:Kuro0No/stingy init${C.reset} to force agents to use surgical line ranges on these files.\n`
  );
}

/**
 * Install the bundled project skills into the current workspace.
 */
function runInit() {
  const modeArg = args.find((a) => a.startsWith('--mode='));
  const modeIndex = args.indexOf('--mode');
  const mode = (modeArg ? modeArg.slice('--mode='.length) : modeIndex !== -1 ? args[modeIndex + 1] || '' : 'strict').toLowerCase();
  if (!MODES.includes(mode)) throw new Error(`Unknown mode "${mode}". Use --mode ${MODES.join('|')}.`);

  // The chosen mode becomes the default mode written into the installed /stingy skill.
  const skillRoot = path.join(REPO_ROOT, 'skills');
  const general = fs
    .readFileSync(path.join(skillRoot, 'stingy', 'SKILL.md'), 'utf8')
    .replace(/Default mode is \*\*`\w+`\*\*/, `Default mode is **\`${mode}\`**`);
  const skills = [{ name: 'stingy', content: general }];
  const featureSkillName = 'stingy-build';
  const featureFile = path.join(skillRoot, featureSkillName, 'SKILL.md');
  const hasFeatureSkill = fs.existsSync(featureFile);
  if (hasFeatureSkill) {
    skills.push({ name: featureSkillName, content: fs.readFileSync(featureFile) });
  }

  const agents = agentsFromArgs();
  console.log(`\n${C.green}${C.bold}🪙 Installing Stingy for: ${agents.join(', ')}${C.reset}`);
  for (const agent of agents.filter((a) => SKILL_DIRS[a])) {
    for (const { name, content } of skills) {
      const file = path.join(SKILL_DIRS[agent], 'skills', name, 'SKILL.md');
      writeFile(file, content);
      console.log(`  ${C.dim}Installed:${C.reset} ${file}`);
    }
  }
  // Agents without skills read the same rules from their own instruction file.
  const rules = rulesFor(general);
  for (const agent of agents.filter((a) => RULE_FILES[a])) {
    const { file, shared, wrap, hint } = RULE_FILES[agent];
    if (shared) upsertManagedBlock(file, rules.shared);
    else writeFile(file, wrap(rules.own));
    console.log(`  ${C.dim}${agent}:${C.reset} ${file}${shared ? ' (stingy block; the rest of the file is kept)' : ''}`);
    if (hint) console.log(`    ${C.dim}${hint}${C.reset}`);
  }
  console.log(`  ${C.dim}General mode:${C.reset} ${C.yellow}/stingy ${mode}${C.reset}`);
  if (hasFeatureSkill && agents.some((a) => SKILL_DIRS[a])) {
    console.log(`  ${C.dim}Feature-building mode:${C.reset} ${C.yellow}/${featureSkillName}${C.reset}`);
  }

  if (args.includes('--hook')) {
    const { hookScriptPath, settingsPath } = installPreToolHook(process.cwd());
    console.log(`  ${C.dim}Installed PreToolUse Hook:${C.reset} ${hookScriptPath}`);
    console.log(`  ${C.dim}Updated Hook Config:${C.reset} ${settingsPath}`);
  }
}

function runHook() {
  let raw = '';
  try {
    raw = fs.readFileSync(0, 'utf8');
  } catch {
    return;
  }
  if (!raw.trim()) return;
  let event = {};
  try {
    event = JSON.parse(raw);
  } catch {
    return;
  }
  const response = formatHookResponse(evaluatePreToolHook(event));
  // Print only to block; silence leaves the decision to Claude Code's permission rules.
  if (response) process.stdout.write(JSON.stringify(response) + '\n');
}

function printHelp(log = console.log) {
  log(`
${C.yellow}${C.bold}🪙 stingy${C.reset} — Roast tool waste and tally local agent usage.

${C.bold}Usage:${C.reset}
  npx github:Kuro0No/stingy roast [path] [--source agent] [--svg out.svg] [--png out.png]
  npx github:Kuro0No/stingy usage [agent] [--from report.json] [--json]
  npx github:Kuro0No/stingy audit [dir]        ${C.dim}# Scan repo for Token Black Hole files${C.reset}
  npx github:Kuro0No/stingy init [--agent claude,codex,gemini,…|all] [--mode lite|strict|scrooge] [--hook]
                                               ${C.dim}# Install Stingy for one or more agents & optional PreToolUse hook${C.reset}
  npx github:Kuro0No/stingy hook               ${C.dim}# Evaluate PreToolUse JSON event on stdin${C.reset}
  npx github:Kuro0No/stingy --version
`);
}

const commands = { roast: runRoast, usage: runUsage, audit: () => runAudit(args[1] || process.cwd()), init: runInit, hook: runHook };
try {
  if (commands[command]) {
    commands[command]();
  } else if (['help', '--help', '-h'].includes(command)) {
    printHelp();
  } else if (['version', '--version', '-v'].includes(command)) {
    console.log(JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')).version);
  } else {
    console.error(`Unknown command: ${args[0]}`);
    printHelp(console.error);
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
