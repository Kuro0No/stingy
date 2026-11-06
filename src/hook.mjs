import fs from 'node:fs';
import path from 'node:path';
import { getReadLineSpan, isForbiddenPath } from './core.mjs';

export const DEFAULT_MAX_FULL_READ_LINES = 250;
export const RECOMMENDED_SURGICAL_LINES = 120;

function stripOuterQuotes(str) {
  return String(str || '').trim().replace(/^["']+|["']+$/g, '');
}

/**
 * Count lines in a local file safely. Returns null if the file does not exist or cannot be read.
 */
export function getLocalFileLineCount(filePath, cwd = process.cwd()) {
  if (!filePath) return null;
  const cleaned = stripOuterQuotes(filePath);
  const resolved = path.isAbsolute(cleaned) ? cleaned : path.resolve(cwd, cleaned);
  try {
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) return null;
    const content = fs.readFileSync(resolved, 'utf8');
    if (content.length === 0) return 0;
    return content.split(/\r?\n/).length;
  } catch {
    return null;
  }
}

/**
 * Extract a file path if a shell command is attempting an unbounded file dump (`cat` / `Get-Content`)
 * without `head`, `tail`, `-TotalCount`, `-Tail`, `Select-Object`, or `wc`.
 */
export function extractUnboundedShellReadTarget(commandStr) {
  const cmd = String(commandStr || '').trim();
  if (!cmd) return null;

  // If piped to a bounding filter (head, tail, wc, Select-Object, Measure-Object, grep, rg, findstr), allow it
  if (
    /\|\s*(head|tail|wc|grep|rg|findstr|Select-Object|Measure-Object| Select\b)/i.test(cmd) ||
    /\b(-TotalCount|-Tail|-Head|-First|-Last)\b/i.test(cmd)
  ) {
    return null;
  }

  const catMatch = cmd.match(/^(?:cat|type|Get-Content|gc)\s+([^\s|;&><]+)/i);
  if (!catMatch) return null;

  const candidate = stripOuterQuotes(catMatch[1]);
  if (!candidate || candidate.startsWith('-')) return null;
  return candidate;
}

/**
 * Evaluate a PreToolUse hook event against Stingy's 10-Coin Input Discipline rules.
 */
export function evaluatePreToolHook(event = {}, options = {}) {
  const maxLines = Number(options.maxLines || DEFAULT_MAX_FULL_READ_LINES);
  const cwd = event.cwd || options.cwd || process.cwd();

  const rawToolName = String(
    event.tool_name || event.toolName || event.name || event.tool || ''
  ).trim();
  const toolInput =
    event.tool_input || event.toolInput || event.args || event.arguments || event.input || {};

  const isReadTool = /^(Read|read_file|view_file|mcp_read_file)$/i.test(rawToolName);
  const isShellTool = /^(Bash|run_command|exec_command|shell)$/i.test(rawToolName);

  if (isReadTool) {
    const rawPath = stripOuterQuotes(
      toolInput.file_path ||
        toolInput.Path ||
        toolInput.AbsolutePath ||
        toolInput.path ||
        toolInput.filePath ||
        toolInput.file ||
        ''
    );

    if (rawPath && isForbiddenPath(rawPath)) {
      return {
        allowed: false,
        decision: 'block',
        code: 'FORBIDDEN_PATH',
        targetPath: rawPath,
        reason: `🪙 [STINGY PRE-TOOL HOOK BLOCKED]: Reading forbidden/generated path "${path.basename(rawPath)}" costs 10.0 Coins (Instant Turn Bankruptcy). Inspect package.json or source files instead.`
      };
    }

    const span = getReadLineSpan(toolInput);
    if (span !== null) {
      if (span > maxLines) {
        return {
          allowed: false,
          decision: 'block',
          code: 'RANGE_TOO_WIDE',
          targetPath: rawPath,
          requestedLines: span,
          reason: `🪙 [STINGY PRE-TOOL HOOK BLOCKED]: Requested line range (${span} lines) on "${path.basename(rawPath)}" exceeds the ${maxLines}-line cap. Read at most ${RECOMMENDED_SURGICAL_LINES} lines around the target symbol.`
        };
      }
      return {
        allowed: true,
        decision: 'allow',
        code: 'SURGICAL_READ',
        targetPath: rawPath,
        requestedLines: span
      };
    }

    // No explicit bounded range was provided -> check if the file on disk exceeds maxLines
    const lineCount = getLocalFileLineCount(rawPath, cwd);
    if (lineCount !== null && lineCount > maxLines) {
      return {
        allowed: false,
        decision: 'block',
        code: 'UNBOUNDED_FULL_READ',
        targetPath: rawPath,
        fileLines: lineCount,
        reason: `🪙 [STINGY PRE-TOOL HOOK BLOCKED]: "${path.basename(rawPath)}" has ${lineCount} lines (exceeds ${maxLines}-line full-read cap). Run Grep/ripgrep first (0.5 Coins) to locate target line numbers, then Read with offset & limit <= ${RECOMMENDED_SURGICAL_LINES} lines (1.0 Coin).`
      };
    }

    return {
      allowed: true,
      decision: 'allow',
      code: 'SMALL_OR_UNKNOWN_FILE',
      targetPath: rawPath,
      fileLines: lineCount
    };
  }

  if (isShellTool) {
    const commandStr = String(
      toolInput.command || toolInput.CommandLine || toolInput.cmd || ''
    ).trim();
    const shellTarget = extractUnboundedShellReadTarget(commandStr);
    if (shellTarget) {
      if (isForbiddenPath(shellTarget)) {
        return {
          allowed: false,
          decision: 'block',
          code: 'FORBIDDEN_PATH',
          targetPath: shellTarget,
          reason: `🪙 [STINGY PRE-TOOL HOOK BLOCKED]: Dumping forbidden path "${path.basename(shellTarget)}" via shell costs 10.0 Coins.`
        };
      }

      const lineCount = getLocalFileLineCount(shellTarget, cwd);
      if (lineCount !== null && lineCount > maxLines) {
        return {
          allowed: false,
          decision: 'block',
          code: 'SHELL_READ_BYPASS',
          targetPath: shellTarget,
          fileLines: lineCount,
          reason: `🪙 [STINGY PRE-TOOL HOOK BLOCKED]: Unbounded shell dump of "${path.basename(shellTarget)}" (${lineCount} lines) bypasses line-range limits. Use Grep + bounded Read (<= ${RECOMMENDED_SURGICAL_LINES} lines) instead.`
        };
      }
    }
  }

  return {
    allowed: true,
    decision: 'allow',
    code: 'ALLOWED'
  };
}

/**
 * Format the evaluation result as a Claude Code / Universal PreToolUse JSON response.
 */
export function formatHookResponse(evalResult) {
  if (evalResult.allowed) {
    return {
      decision: 'allow',
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow'
      }
    };
  }
  return {
    decision: 'block',
    reason: evalResult.reason,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: evalResult.reason
    }
  };
}

/**
 * Generate a standalone, zero-dependency `.claude/hooks/stingy-pre-tool.mjs` script
 * and wire it into `.claude/settings.json`.
 */
export function installPreToolHook(workspaceRoot = process.cwd(), maxLines = DEFAULT_MAX_FULL_READ_LINES) {
  const claudeDir = path.join(workspaceRoot, '.claude');
  const hooksDir = path.join(claudeDir, 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });

  const hookScriptPath = path.join(hooksDir, 'stingy-pre-tool.mjs');
  const standaloneScript = `#!/usr/bin/env node
// 🪙 Stingy PreToolUse Hook — Hard-blocks unbounded full-file reads (> ${maxLines} lines) & lockfiles
import fs from 'node:fs';
import path from 'node:path';

const MAX_LINES = Number(process.env.STINGY_MAX_LINES || ${maxLines});
const FORBIDDEN_PATTERNS = [
  /(^|[\\\\/])package-lock\\.json$/i,
  /(^|[\\\\/])pnpm-lock\\.yaml$/i,
  /(^|[\\\\/])yarn\\.lock$/i,
  /(^|[\\\\/])bun\\.lockb?$/i,
  /(^|[\\\\/])Cargo\\.lock$/i,
  /(^|[\\\\/])node_modules([\\\\/]|$)/i,
  /(^|[\\\\/])dist([\\\\/]|$)/i,
  /(^|[\\\\/])\\.next([\\\\/]|$)/i,
  /(^|[\\\\/])\\.git([\\\\/]|$)/i
];

function isForbidden(p) {
  return FORBIDDEN_PATTERNS.some((re) => re.test(String(p || '')));
}

function toNum(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.trim().replace(/^["']+|["']+$/g, ''));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function getSpan(args = {}) {
  const s = toNum(args.startLine ?? args.StartLine ?? args.start_line);
  const e = toNum(args.endLine ?? args.EndLine ?? args.end_line);
  if (s !== null && e !== null && e >= s) return e - s + 1;
  const lim = toNum(args.limit ?? args.maxLines ?? args.max_lines);
  if (lim !== null && lim > 0) return lim;
  return null;
}

let raw = '';
try {
  raw = fs.readFileSync(0, 'utf8');
} catch {
  process.exit(0);
}

if (!raw.trim()) process.exit(0);

let event = {};
try {
  event = JSON.parse(raw);
} catch {
  process.exit(0);
}

const toolName = String(event.tool_name || event.toolName || event.name || '').trim();
const input = event.tool_input || event.toolInput || event.args || {};
const cwd = event.cwd || process.cwd();

function block(reason) {
  const out = {
    decision: 'block',
    reason,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason
    }
  };
  process.stdout.write(JSON.stringify(out) + '\\n');
  process.exit(0);
}

if (/^(Read|read_file|view_file|mcp_read_file)$/i.test(toolName)) {
  const target = String(input.file_path || input.Path || input.AbsolutePath || input.path || '').trim().replace(/^["']+|["']+$/g, '');
  if (target && isForbidden(target)) {
    block(\`🪙 [STINGY PRE-TOOL HOOK BLOCKED]: Reading forbidden/generated path "\${path.basename(target)}" costs 10.0 Coins (Instant Bankruptcy).\`);
  }
  const span = getSpan(input);
  if (span !== null) {
    if (span > MAX_LINES) {
      block(\`🪙 [STINGY PRE-TOOL HOOK BLOCKED]: Requested line range (\${span} lines) on "\${path.basename(target)}" exceeds \${MAX_LINES}-line cap. Read <= 120 lines.\`);
    }
    process.exit(0);
  }
  if (target) {
    const resolved = path.isAbsolute(target) ? target : path.resolve(cwd, target);
    try {
      const content = fs.readFileSync(resolved, 'utf8');
      const lines = content.length === 0 ? 0 : content.split(/\\r?\\n/).length;
      if (lines > MAX_LINES) {
        block(\`🪙 [STINGY PRE-TOOL HOOK BLOCKED]: "\${path.basename(target)}" has \${lines} lines (> \${MAX_LINES}-line full-read cap). Use Grep first (0.5 Coins), then Read with offset & limit <= 120 lines (1.0 Coin).\`);
      }
    } catch {
      // File doesn't exist yet -> allow
    }
  }
}
`;

  fs.writeFileSync(hookScriptPath, standaloneScript, 'utf8');

  const settingsPath = path.join(claudeDir, 'settings.json');
  let settings = {};
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch {
      settings = {};
    }
  }

  if (!settings.hooks || typeof settings.hooks !== 'object') {
    settings.hooks = {};
  }
  if (!Array.isArray(settings.hooks.PreToolUse)) {
    settings.hooks.PreToolUse = [];
  }

  const hookCommand = 'node .claude/hooks/stingy-pre-tool.mjs';
  const alreadyInstalled = settings.hooks.PreToolUse.some(
    (entry) =>
      Array.isArray(entry?.hooks) &&
      entry.hooks.some((h) => typeof h?.command === 'string' && h.command.includes('stingy-pre-tool.mjs'))
  );

  if (!alreadyInstalled) {
    settings.hooks.PreToolUse.push({
      matcher: 'Read|read_file|view_file|Bash|run_command',
      hooks: [
        {
          type: 'command',
          command: hookCommand
        }
      ]
    });
  }

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');

  return {
    hookScriptPath,
    settingsPath
  };
}
