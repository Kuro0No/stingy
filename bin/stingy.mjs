#!/usr/bin/env node

/**
 * 🪙 STINGY CLI — Input Token & Tool-Call Auditor for AI Coding Agents
 * Commands:
 *   stingy roast [path]    -> Audit local JSONL transcripts & print a Token Autopsy Receipt
 *   stingy audit [dir]     -> Find high-token files ("Token Black Holes") & generate .claudeignore
 *   stingy init [--mode]   -> Install Stingy Mode into .agents/skills, CLAUDE.md, or .cursorrules
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { analyzeJsonlLines } from '../src/core.mjs';

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

function formatUsd(val, decimals = 2) {
  const n = Number(val || 0);
  if (n === 0) return decimals === 4 ? '$0.0000' : '$0.00';
  return `$${n.toFixed(decimals)}`;
}

/**
 * Discover JSONL session logs from an explicit path or default HOME locations.
 * Respects process.env.HOME / process.env.USERPROFILE for isolated testing.
 */
export function findLocalLogs(customTarget = null) {
  const jsonlFiles = [];

  function walk(dir, depth = 0) {
    if (depth > 5 || !fs.existsSync(dir)) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, depth + 1);
      } else if (
        entry.isFile() &&
        entry.name.endsWith('.jsonl') &&
        !entry.name.includes('transcript_full')
      ) {
        try {
          const stat = fs.statSync(fullPath);
          if (stat.size > 0) {
            jsonlFiles.push({ path: fullPath, size: stat.size, mtime: stat.mtimeMs });
          }
        } catch {
          // ignore unreadable file
        }
      }
    }
  }

  if (customTarget && !customTarget.startsWith('-')) {
    const resolved = path.resolve(process.cwd(), customTarget);
    if (fs.existsSync(resolved)) {
      const stat = fs.statSync(resolved);
      if (stat.isFile()) {
        return [{ path: resolved, size: stat.size, mtime: stat.mtimeMs }];
      }
      walk(resolved, 0);
      return jsonlFiles.sort((a, b) => b.mtime - a.mtime).slice(0, 50);
    }
    return [];
  }

  const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
  const candidates = [
    path.join(home, '.claude', 'projects'),
    path.join(home, '.gemini', 'antigravity', 'brain')
  ];

  for (const dir of candidates) {
    walk(dir);
  }

  return jsonlFiles.sort((a, b) => b.mtime - a.mtime).slice(0, 25);
}

/**
 * Run the Honest Token Autopsy Receipt on real JSONL transcripts.
 */
function runRoast() {
  const customPath = args[1] && !args[1].startsWith('-') ? args[1] : null;
  if (customPath && !fs.existsSync(path.resolve(process.cwd(), customPath))) {
    console.log('');
    console.log(`${C.red}Path not found: ${customPath}${C.reset}`);
    console.log(
      `${C.dim}Usage: stingy roast [path-to-session.jsonl | path-to-logs-dir]${C.reset}`
    );
    console.log('');
    return;
  }

  const files = findLocalLogs(customPath);

  if (files.length === 0) {
    console.log('');
    console.log(`${C.yellow}No local JSONL session transcripts found.${C.reset}`);
    console.log(
      `${C.dim}Searched in: ~/.claude/projects and ~/.gemini/antigravity/brain${C.reset}`
    );
    console.log(
      `${C.dim}Usage: stingy roast [path-to-session.jsonl | path-to-logs-dir]${C.reset}`
    );
    console.log('');
    return;
  }

  const sessionList = [];
  for (const f of files) {
    try {
      const content = fs.readFileSync(f.path, 'utf8');
      const lines = content.split(/\r?\n/).filter((l) => l.trim());
      if (lines.length > 0) {
        sessionList.push(lines);
      }
    } catch {
      // skip unreadable file
    }
  }

  const s = analyzeJsonlLines(sessionList, 3.0);

  if (s.totalSteps === 0) {
    console.log('');
    console.log(`${C.yellow}No valid JSONL transcript records found in scanned files.${C.reset}`);
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

  const fullReadUsd = s.fullReadUsd;
  const dupReadUsd = s.dupReadUsd;
  const retryUsd = s.retryUsd;
  const rageUsd = s.rageUsd;
  const hasSubCentItem = [fullReadUsd, dupReadUsd, retryUsd, rageUsd, s.wastedUsd].some(
    (v) => v > 0 && v < 0.005
  );
  const decimals = (s.rawCostUsd > 0 && s.rawCostUsd < 0.05) || hasSubCentItem ? 4 : 2;
  const zeroStr = formatUsd(0, decimals);

  const rFull = Number(fullReadUsd.toFixed(decimals));
  const rDup = Number(dupReadUsd.toFixed(decimals));
  const rRetry = Number(retryUsd.toFixed(decimals));
  const rRage = Number(rageUsd.toFixed(decimals));
  const rWasted = Number((rFull + rDup + rRetry + rRage).toFixed(decimals));
  const rRaw = Number(Math.max(rWasted, Number(s.rawCostUsd.toFixed(decimals))).toFixed(decimals));
  const rStingy = Number(Math.max(0, rRaw - rWasted).toFixed(decimals));

  console.log('');
  console.log(`${C.yellow}${C.bold}  =================================================${C.reset}`);
  console.log(`${C.yellow}${C.bold}  |          🪙 STINGY TOKEN AUTOPSY 🪙           |${C.reset}`);
  console.log(`${C.yellow}  |      "Why burn 50k tokens when 400 do?"       |${C.reset}`);
  console.log(`  |-----------------------------------------------|`);
  console.log(
    `  | LOGS SCANNED: ${padRight(`${files.length} files (${s.totalSteps} steps)`, 31)} |`
  );
  console.log(`  |-----------------------------------------------|`);
  console.log(`  | ITEM                         QTY     EST. USD |`);
  console.log(`  |-----------------------------------------------|`);
  console.log(
    `  | Full-File Reads (No Range)  ${padLeft(s.fullFileReads + 'x', 5)}   ${padLeft(formatUsd(rFull, decimals), 9)} |`
  );
  console.log(
    `  | Duplicate File Re-Reads     ${padLeft(s.duplicateReads + 'x', 5)}   ${padLeft(formatUsd(rDup, decimals), 9)} |`
  );
  console.log(
    `  | Consecutive Cmd Retries     ${padLeft(s.commandRetries + 'x', 5)}   ${padLeft(formatUsd(rRetry, decimals), 9)} |`
  );
  console.log(
    `  | Frustration / Fix Prompts   ${padLeft(s.rageMessages + 'x', 5)}   ${padLeft(formatUsd(rRage, decimals), 9)} |`
  );
  console.log(
    `  | ${C.green}Surgical Line-Range Reads   ${padLeft(s.surgicalReads + 'x', 5)}   ${padLeft(zeroStr, 9)}${C.reset} |`
  );
  console.log(
    `  | ${C.green}Targeted Grep Searches      ${padLeft(s.grepCalls + 'x', 5)}   ${padLeft(zeroStr, 9)}${C.reset} |`
  );
  console.log(`  |-----------------------------------------------|`);
  console.log(
    `  | 10-COIN TURN BUDGET SCORE:  ${padLeft(`${s.avgTurnCoins} / 10.0 Coins`, 17)} |`
  );
  console.log(
    `  | BANKRUPT TURNS (>10 Coins): ${padLeft(`${s.bankruptTurns} / ${s.totalTurnsScored} turns`, 17)} |`
  );
  console.log(`  |-----------------------------------------------|`);
  console.log(
    `  | EST. TOKENS PROCESSED      ${padLeft(s.totalTokens.toLocaleString('en-US'), 18)} |`
  );
  console.log(
    `  | AVOIDABLE WASTED TOKENS    ${padLeft(s.wastedTokens.toLocaleString('en-US'), 18)} |`
  );
  console.log(`  |-----------------------------------------------|`);
  console.log(`  | EST. BASELINE COST (@$3/1M):   ${padLeft(formatUsd(rRaw, decimals), 14)} |`);
  console.log(
    `  | ${C.green}WITH STINGY MODE (${padRight(`-${s.savingsPct}%):`, 9)}   ${padLeft(formatUsd(rStingy, decimals), 14)}${C.reset} |`
  );
  console.log(
    `  | ${C.red}${C.bold}AVOIDABLE TOKEN WASTE:         ${padLeft(formatUsd(rWasted, decimals), 14)}${C.reset} |`
  );
  console.log(`  |-----------------------------------------------|`);
  console.log(`  | DIAGNOSIS:                                    |`);
  console.log(`  | ${C.cyan}${C.bold}${padRight(diagnosis, 45)}${C.reset} |`);
  console.log(`${C.yellow}${C.bold}  =================================================${C.reset}`);
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

if (command === 'roast') {
  runRoast();
} else if (command === 'audit') {
  runAudit(args[1] || process.cwd());
} else if (command === 'init') {
  runInit();
} else {
  console.log(`
${C.yellow}${C.bold}🪙 stingy${C.reset} — Cut ~80% of AI agent input & tool-call token waste.

${C.bold}Usage:${C.reset}
  npx github:Kuro0No/stingy roast [path]       ${C.dim}# Audit local AI transcripts & print Token Autopsy Receipt${C.reset}
  npx github:Kuro0No/stingy audit [dir]        ${C.dim}# Scan repo for Token Black Hole files${C.reset}
  npx github:Kuro0No/stingy init --mode scrooge ${C.dim}# Install /stingy skill into your project${C.reset}
`);
}
