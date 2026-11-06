#!/usr/bin/env node

/**
 * 🪙 STINGY CLI — Input Token & Tool-Call Auditor for AI Coding Agents
 * Commands:
 *   stingy roast [path]    -> Audit local JSONL transcripts & print a Token Autopsy Receipt
 *   stingy usage [agent]   -> Summarize agent tokens and estimated cost via ccusage
 *   stingy audit [dir]     -> Find high-token files ("Token Black Holes") & generate .claudeignore
 *   stingy init [--mode]   -> Install Stingy Mode into .agents/skills, CLAUDE.md, or .cursorrules
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeJsonlLines } from '../src/core.mjs';
import { findLocalLogs, readTranscript, ROAST_SOURCES } from '../src/transcripts.mjs';
import { readUsageReport, USAGE_SOURCES } from '../src/usage.mjs';

export { findLocalLogs };

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  white: '\x1b[37m'
};

const args = process.argv.slice(2);
const command = (args[0] || 'help').toLowerCase();

function padRight(str, len) {
  const s = String(str);
  return s.length >= len ? s.slice(0, len) : s + ' '.repeat(len - s.length);
}

function padLeft(str, len) {
  const s = String(str);
  return s.length >= len ? s.slice(0, len) : ' '.repeat(len - s.length) + s;
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
  const { target: customPath, source } = reportArguments({ '--source': 'value' });
  if (source && !ROAST_SOURCES.includes(source)) {
    const usageHint = USAGE_SOURCES.includes(source) ? ` For usage totals, run stingy usage ${source}.` : '';
    throw new Error(`Transcript sources are ${ROAST_SOURCES.join(', ')}.${usageHint}`);
  }
  if (customPath && !fs.existsSync(path.resolve(process.cwd(), customPath))) {
    console.log('');
    console.log(`${C.red}Path not found: ${customPath}${C.reset}`);
    console.log(
      `${C.dim}Usage: stingy roast [path] [--source agent]${C.reset}`
    );
    console.log('');
    return;
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
  console.log(row('Frustration / Fix Prompts', s.rageMessages, s.rageWastedTokens));
  console.log(`${C.green}${row('Surgical Line-Range Reads', s.surgicalReads, 0)}${C.reset}`);
  console.log(`${C.green}${row('Targeted Grep Searches', s.grepCalls, 0)}${C.reset}`);
  console.log(`  |-----------------------------------------------|`);
  console.log(
    `  | 10-COIN TURN BUDGET SCORE:  ${padLeft(`${s.avgTurnCoins} / 10.0 Coins`, 17)} |`
  );
  console.log(
    `  | BANKRUPT TURNS (>10 Coins): ${padLeft(`${s.bankruptTurns} / ${s.totalTurnsScored} turns`, 17)} |`
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
  console.log('  Estimated waste is in tokens. For usage and model-based estimates, run stingy usage.');
  console.log('');
}

/**
 * Audit a workspace directory to find "Token Black Holes"
 */
function runAudit(targetDir = process.cwd()) {
  const heavyFiles = [];
  const ignoreDirs = new Set(['.git', 'node_modules', '.next', 'dist', 'build', 'coverage']);

  function scan(dir, depth = 0) {
    if (depth > 5) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (ignoreDirs.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scan(full, depth + 1);
      } else if (entry.isFile()) {
        try {
          const stat = fs.statSync(full);
          if (stat.size > 12 * 1024) {
            heavyFiles.push({
              relPath: path.relative(targetDir, full),
              bytes: stat.size,
              estTokens: Math.round(stat.size / 4)
            });
          }
        } catch {
          // ignore
        }
      }
    }
  }

  scan(targetDir);
  heavyFiles.sort((a, b) => b.estTokens - a.estTokens);
  const top = heavyFiles.slice(0, 10);

  console.log(
    `\n${C.yellow}${C.bold}🪙 STINGY REPO AUDIT — Top Token Black Holes in ${path.basename(targetDir)}${C.reset}\n`
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
    const coins = f.estTokens > 10000 ? '10.0 (BAN)' : f.estTokens > 3000 ? '4.0 Coins' : '2.0 Coins';
    console.log(
      `  ${padRight(f.relPath, 42)} ${C.red}${padLeft(f.estTokens.toLocaleString('en-US') + ' tok', 14)}${C.reset}   ${padLeft(coins, 10)}`
    );
  }
  console.log(
    `\n  ${C.cyan}Tip:${C.reset} Run ${C.bold}npx github:Kuro0No/stingy init${C.reset} to force agents to use surgical line ranges on these files.\n`
  );
}

/**
 * Install Stingy Mode skill into current workspace
 */
function runInit() {
  const modeIndex = args.indexOf('--mode');
  const mode = modeIndex !== -1 && args[modeIndex + 1] ? args[modeIndex + 1] : 'scrooge';

  const targetDirs = [
    path.join(process.cwd(), '.claude', 'skills', 'stingy'),
    path.join(process.cwd(), '.agents', 'skills', 'stingy')
  ];

  const bundledSkill = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'skills',
    'stingy',
    'SKILL.md'
  );

  const createdPaths = [];
  for (const dir of targetDirs) {
    fs.mkdirSync(dir, { recursive: true });
    const targetSkill = path.join(dir, 'SKILL.md');
    if (fs.existsSync(bundledSkill)) {
      fs.copyFileSync(bundledSkill, targetSkill);
    } else {
      fs.writeFileSync(
        targetSkill,
        `---\nname: stingy\ndescription: Stingy Mode (${mode}) — Enforce 10-Coin Turn Budget & surgical line-range reads.\n---\n\n# Stingy Mode (${mode.toUpperCase()})\n1. Always grep with line numbers before reading files.\n2. Always supply StartLine/EndLine or offset/limit (max 100 lines) when reading files.\n3. Never re-read a file already in context.\n`,
        'utf8'
      );
    }
    createdPaths.push(path.relative(process.cwd(), targetSkill));
  }

  console.log(`\n${C.green}${C.bold}🪙 Stingy Mode (${mode.toUpperCase()}) installed!${C.reset}`);
  for (const p of createdPaths) {
    console.log(`  ${C.dim}Created:${C.reset} ${p}`);
  }
  console.log(
    `  ${C.dim}Activate in Claude Code / Antigravity / Cursor:${C.reset} ${C.yellow}/stingy ${mode}${C.reset}\n`
  );
}

if (command === 'roast' || command === 'usage') {
  try {
    if (command === 'roast') runRoast();
    else runUsage();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
} else if (command === 'audit') {
  runAudit(args[1] || process.cwd());
} else if (command === 'init') {
  runInit();
} else {
  console.log(`
${C.yellow}${C.bold}🪙 stingy${C.reset} — Roast tool waste and tally local agent usage.

${C.bold}Usage:${C.reset}
  npx github:Kuro0No/stingy roast [path] [--source agent]
  npx github:Kuro0No/stingy usage [agent] [--from report.json] [--json]
  npx github:Kuro0No/stingy audit [dir]        ${C.dim}# Scan repo for Token Black Hole files${C.reset}
  npx github:Kuro0No/stingy init --mode scrooge ${C.dim}# Install /stingy skill into your project${C.reset}
`);
}
