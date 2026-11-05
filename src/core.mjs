/**
 * 🪙 Stingy Core Engine — Honest, Deterministic Coin Budget & Transcript Autopsy
 * Zero external dependencies.
 * - Per-session isolation (never leaks duplicate-read state across separate session files)
 * - User-turn grouping (accumulates all assistant tool calls within one human user turn)
 * - Dynamic tool_result payload measurement (1-line file read = 0 waste; 2,000-line read = proportional waste)
 */

export const COIN_TABLE = Object.freeze({
  TURN_BUDGET: 10.0,
  GREP_SEARCH: 0.5,
  SURGICAL_READ: 1.0,       // <= 120 lines (via range args OR small file <= 120 lines)
  MEDIUM_READ: 2.0,         // 121..250 lines
  FULL_FILE_READ: 4.0,      // Unbounded read > 250 lines
  DUPLICATE_REREAD: 5.0,    // Re-reading the exact same file un-ranged without an edit in between
  BLIND_RETRY: 4.0,         // Consecutive failed shell command without an edit in between
  FORBIDDEN_PATH_READ: 10.0 // Lockfiles, node_modules, build artifacts
});

const FORBIDDEN_PATTERNS = [
  /(^|[\\/])node_modules([\\/]|$)/i,
  /(^|[\\/])(dist|build|\.next|out|coverage)([\\/]|$)/i,
  /package-lock\.json$/i,
  /pnpm-lock\.yaml$/i,
  /yarn\.lock$/i,
  /cargo\.lock$/i,
  /\.min\.(js|css)$/i
];

export function isForbiddenPath(filePath = '') {
  return FORBIDDEN_PATTERNS.some((re) => re.test(String(filePath)));
}

/**
 * Estimate BPE tokens from character count (~4 chars per token for source code/JSON).
 */
export function estimateTokensFromChars(charCount) {
  const n = Number(charCount || 0);
  if (n <= 0) return 0;
  return Math.ceil(n / 4);
}

/**
 * Determine line span from either StartLine/EndLine (Antigravity/Cursor) or offset/limit (Claude Code)
 */
export function getReadLineSpan(args = {}) {
  const start = args.startLine ?? args.StartLine ?? args.start_line;
  const end = args.endLine ?? args.EndLine ?? args.end_line;
  if (typeof start === 'number' && typeof end === 'number' && end >= start) {
    return end - start + 1;
  }

  const limit = args.limit ?? args.maxLines ?? args.max_lines;
  if (typeof limit === 'number' && limit > 0) {
    return limit;
  }

  const offset = args.offset;
  if (typeof offset === 'number' && offset >= 0 && typeof limit !== 'number') {
    return 100;
  }

  return null;
}

/**
 * Score a single tool action against the 10-Coin Turn Budget Contract.
 */
export function scoreToolAction(action) {
  if (!action || typeof action !== 'object') {
    throw new TypeError('Action must be an object');
  }

  if (action.path && isForbiddenPath(action.path)) {
    return {
      coins: COIN_TABLE.FORBIDDEN_PATH_READ,
      category: 'FORBIDDEN_PATH_READ',
      bankrupt: true,
      reason: `Forbidden path read: ${action.path}`
    };
  }

  switch (action.type) {
    case 'grep':
      return {
        coins: COIN_TABLE.GREP_SEARCH,
        category: 'GREP_SEARCH',
        bankrupt: false,
        reason: 'Targeted symbol/line search'
      };

    case 'read': {
      if (action.isDuplicateRead) {
        return {
          coins: COIN_TABLE.DUPLICATE_REREAD,
          category: 'DUPLICATE_REREAD',
          bankrupt: false,
          reason: `Duplicate re-read of ${action.path || 'file'} without intermediate edit`
        };
      }

      const span = getReadLineSpan(action);
      if (span !== null) {
        if (span <= 120) {
          return {
            coins: COIN_TABLE.SURGICAL_READ,
            category: 'SURGICAL_READ',
            bankrupt: false,
            reason: `Surgical line-range read (${span} lines)`
          };
        }
        if (span <= 250) {
          return {
            coins: COIN_TABLE.MEDIUM_READ,
            category: 'MEDIUM_READ',
            bankrupt: false,
            reason: `Medium line-range read (${span} lines)`
          };
        }
      }

      const fileLines = Number(action.totalFileLines ?? 500);
      if (span === null && fileLines <= 120) {
        return {
          coins: COIN_TABLE.SURGICAL_READ,
          category: 'SURGICAL_READ',
          bankrupt: false,
          reason: `Small file read (${fileLines} lines)`
        };
      }
      if (span === null && fileLines <= 250) {
        return {
          coins: COIN_TABLE.MEDIUM_READ,
          category: 'MEDIUM_READ',
          bankrupt: false,
          reason: `Medium file read (${fileLines} lines)`
        };
      }

      return {
        coins: COIN_TABLE.FULL_FILE_READ,
        category: 'FULL_FILE_READ',
        bankrupt: false,
        reason: `Unbounded / full-file read (${fileLines} lines)`
      };
    }

    case 'command': {
      if (action.isBlindRetry) {
        return {
          coins: COIN_TABLE.BLIND_RETRY,
          category: 'BLIND_RETRY',
          bankrupt: false,
          reason: 'Consecutive failed command retry without prior edit'
        };
      }
      return {
        coins: 0.5,
        category: 'COMMAND_EXEC',
        bankrupt: false,
        reason: 'Shell command execution'
      };
    }

    case 'edit':
      return {
        coins: 0.5,
        category: 'SURGICAL_EDIT',
        bankrupt: false,
        reason: 'Surgical edit'
      };

    default:
      return {
        coins: 1.0,
        category: 'OTHER_TOOL',
        bankrupt: false,
        reason: `Tool call (${action.type || 'unknown'})`
      };
  }
}

/**
 * Evaluate a single user turn (all tool actions executed for one user prompt) against the 10-Coin Budget.
 */
export function evaluateTurnBudget(actions = []) {
  let totalCoins = 0;
  let bankrupt = false;
  const breakdown = [];

  for (const act of actions) {
    const scored = scoreToolAction(act);
    totalCoins = Math.round((totalCoins + scored.coins) * 100) / 100;
    if (scored.bankrupt || totalCoins > COIN_TABLE.TURN_BUDGET) {
      bankrupt = true;
    }
    breakdown.push({ ...act, ...scored });
  }

  return {
    budget: COIN_TABLE.TURN_BUDGET,
    totalCoins,
    remainingCoins: Math.max(0, Math.round((COIN_TABLE.TURN_BUDGET - totalCoins) * 100) / 100),
    withinBudget: totalCoins <= COIN_TABLE.TURN_BUDGET && !bankrupt,
    bankrupt,
    breakdown
  };
}

/**
 * Extract normalized tool calls from a parsed JSONL record.
 */
function extractNormalizedToolCalls(record) {
  const calls = [];

  const rawCalls = record.tool_calls || record.message?.tool_calls;
  if (Array.isArray(rawCalls)) {
    for (const tc of rawCalls) {
      const id = tc.id || tc.tool_call_id || null;
      const name = String(tc.name || tc.function?.name || tc.tool_name || '').toLowerCase();
      let args = tc.arguments ?? tc.function?.arguments ?? tc.input ?? tc.args ?? {};
      if (typeof args === 'string') {
        try {
          args = JSON.parse(args);
        } catch {
          args = {};
        }
      }
      const inlineResult = tc.result ?? tc.output ?? record.tool_result ?? null;
      calls.push({ id, name, args: args || {}, inlineResult });
    }
  }

  const contentBlocks = record.message?.content || (Array.isArray(record.content) ? record.content : null);
  if (Array.isArray(contentBlocks)) {
    for (const block of contentBlocks) {
      if (block && block.type === 'tool_use') {
        const id = block.id || null;
        const name = String(block.name || '').toLowerCase();
        const args = typeof block.input === 'object' && block.input ? block.input : {};
        calls.push({ id, name, args, inlineResult: null });
      }
    }
  }

  return calls;
}

/**
 * First pass over a single session's parsed records to map tool_use_id -> tool_result text size & line count.
 */
function collectToolResultsMap(records) {
  const resultMap = new Map();

  for (const rec of records) {
    // Claude Code / Anthropic format: content array with { type: 'tool_result', tool_use_id, content }
    const contentBlocks = rec.message?.content || (Array.isArray(rec.content) ? rec.content : null);
    if (Array.isArray(contentBlocks)) {
      for (const block of contentBlocks) {
        if (block && block.type === 'tool_result' && block.tool_use_id) {
          const text =
            typeof block.content === 'string'
              ? block.content
              : JSON.stringify(block.content || '');
          const lineCount = text ? text.split(/\r?\n/).length : 0;
          resultMap.set(block.tool_use_id, {
            chars: text.length,
            lines: lineCount,
            isError: Boolean(block.is_error)
          });
        }
      }
    }

    // Antigravity / generic format: tool_UseResult or tool_results array
    if (rec.tool_use_id && typeof rec.content === 'string') {
      const lineCount = rec.content.split(/\r?\n/).length;
      resultMap.set(rec.tool_use_id, {
        chars: rec.content.length,
        lines: lineCount,
        isError: rec.status === 'ERROR'
      });
    }
  }

  return resultMap;
}

/**
 * Check if a record is a genuine human prompt (not a tool_result wrapper message).
 */
function isHumanPromptRecord(step) {
  const isUserRole =
    step.type === 'USER_INPUT' ||
    step.role === 'user' ||
    step.message?.role === 'user' ||
    step.type === 'user';
  if (!isUserRole) return false;

  const contentBlocks = step.message?.content || (Array.isArray(step.content) ? step.content : null);
  if (Array.isArray(contentBlocks) && contentBlocks.length > 0) {
    // If every block is a tool_result, this is an automated tool response, NOT a new human prompt turn
    const allToolResults = contentBlocks.every((b) => b && b.type === 'tool_result');
    if (allToolResults) return false;
  }

  return true;
}

/**
 * Analyze one or more sessions honestly.
 * Accepts either:
 *   - An array of JSONL line strings (single session)
 *   - An array of arrays of JSONL line strings (multiple independent sessions, keeping state isolated per session)
 */
export function analyzeJsonlLines(input = [], pricePerMillionInput = 3.0) {
  const sessions =
    Array.isArray(input) && input.length > 0 && Array.isArray(input[0]) ? input : [input];

  let totalSteps = 0;
  let fullFileReads = 0;
  let mediumReads = 0;
  let surgicalReads = 0;
  let duplicateReads = 0;
  let forbiddenReads = 0;
  let grepCalls = 0;
  let editCalls = 0;
  let commandCalls = 0;
  let commandRetries = 0;
  let rageMessages = 0;

  let baselineToolTokens = 0;
  let wastedTokens = 0;
  let observedCharTokens = 0;
  let telemetryInputTokens = 0;
  let telemetryCacheReadTokens = 0;

  const turnScores = [];

  for (const sessionLines of sessions) {
    if (!Array.isArray(sessionLines)) continue;

    // Parse valid JSON records for this isolated session
    const records = [];
    for (const rawLine of sessionLines) {
      if (!rawLine || !rawLine.trim()) continue;
      observedCharTokens += estimateTokensFromChars(rawLine.length);
      try {
        records.push(JSON.parse(rawLine));
      } catch {
        // skip malformed line
      }
    }

    const toolResultsMap = collectToolResultsMap(records);

    // Session-scoped state (never leaks to other session files!)
    const uneditedReadPaths = new Set();
    let lastCommandFailed = false;
    let currentTurnActions = [];

    function flushCurrentTurn() {
      if (currentTurnActions.length > 0) {
        turnScores.push(evaluateTurnBudget(currentTurnActions));
        currentTurnActions = [];
      }
    }

    for (const step of records) {
      totalSteps++;

      // Collect actual API usage telemetry if logged
      const usage = step.usage || step.message?.usage;
      if (usage && typeof usage === 'object') {
        telemetryInputTokens +=
          Number(usage.input_tokens || 0) + Number(usage.cache_creation_input_tokens || 0);
        telemetryCacheReadTokens += Number(usage.cache_read_input_tokens || 0);
      }

      if (isHumanPromptRecord(step)) {
        // A new human prompt starts a new User Turn! Flush the previous turn's accumulated actions.
        flushCurrentTurn();

        const textContent =
          typeof step.content === 'string'
            ? step.content
            : typeof step.message?.content === 'string'
              ? step.message.content
              : Array.isArray(step.message?.content)
                ? step.message.content
                    .filter((b) => b && b.type === 'text')
                    .map((b) => b.text)
                    .join(' ')
                : '';

        if (
          textContent &&
          /\b(wrong|fix it|still broken|not working|try again|you broke|sai rồi|vẫn lỗi)\b/i.test(
            textContent
          )
        ) {
          rageMessages++;
          const rageTok = Math.max(400, estimateTokensFromChars(textContent.length) * 4);
          baselineToolTokens += rageTok;
          wastedTokens += rageTok;
        }
      }

      const toolCalls = extractNormalizedToolCalls(step);
      if (toolCalls.length === 0) continue;

      for (const tc of toolCalls) {
        const { id, name, args, inlineResult } = tc;
        const targetPath = String(
          args.Path || args.file_path || args.path || args.filePath || args.file || ''
        );

        // Look up actual tool_result payload if present in the session log
        const observedResult =
          (id && toolResultsMap.get(id)) ||
          (typeof inlineResult === 'string'
            ? { chars: inlineResult.length, lines: inlineResult.split(/\r?\n/).length }
            : null);

        if (name === 'read' || name.includes('read_file') || name.includes('view_file')) {
          if (targetPath && isForbiddenPath(targetPath)) {
            forbiddenReads++;
            currentTurnActions.push({ type: 'read', path: targetPath });
            const tok = observedResult ? estimateTokensFromChars(observedResult.chars) : 8000;
            baselineToolTokens += tok;
            wastedTokens += tok;
            continue;
          }

          const span = getReadLineSpan(args);
          const effectiveLines =
            span !== null ? span : observedResult ? observedResult.lines : null;
          const actualReadTokens = observedResult
            ? Math.max(25, estimateTokensFromChars(observedResult.chars))
            : null;

          const isDup = Boolean(
            targetPath &&
              uneditedReadPaths.has(targetPath) &&
              span === null &&
              (effectiveLines === null || effectiveLines > 120)
          );

          if (isDup) {
            duplicateReads++;
            const dupTokens = actualReadTokens ?? 3600;
            baselineToolTokens += dupTokens;
            wastedTokens += dupTokens;
            currentTurnActions.push({
              type: 'read',
              path: targetPath,
              totalFileLines: effectiveLines ?? 500,
              isDuplicateRead: true
            });
          } else if (effectiveLines !== null && effectiveLines <= 120) {
            // Either explicit range <=120 lines OR actual file/result is small (<=120 lines): 0 waste!
            surgicalReads++;
            const surgTokens = actualReadTokens ?? Math.max(120, effectiveLines * 8);
            baselineToolTokens += surgTokens;
            currentTurnActions.push({
              type: 'read',
              path: targetPath,
              startLine: 1,
              endLine: effectiveLines,
              totalFileLines: effectiveLines
            });
          } else if (effectiveLines !== null && effectiveLines <= 250) {
            mediumReads++;
            const medTokens = actualReadTokens ?? effectiveLines * 8;
            const surgicalBaseline = 650;
            baselineToolTokens += medTokens;
            wastedTokens += Math.max(0, medTokens - surgicalBaseline);
            currentTurnActions.push({
              type: 'read',
              path: targetPath,
              startLine: 1,
              endLine: effectiveLines,
              totalFileLines: effectiveLines
            });
          } else {
            fullFileReads++;
            const fullTokens = actualReadTokens ?? 3450;
            const surgicalEquivalent = 650;
            baselineToolTokens += fullTokens;
            wastedTokens += Math.max(0, fullTokens - surgicalEquivalent);
            currentTurnActions.push({
              type: 'read',
              path: targetPath,
              totalFileLines: effectiveLines ?? 500
            });
          }

          if (targetPath) {
            uneditedReadPaths.add(targetPath);
          }
        } else if (
          name.includes('grep') ||
          name.includes('search') ||
          name === 'glob' ||
          name.includes('find')
        ) {
          grepCalls++;
          const grepTok = actualReadTokensFromResult(observedResult, 280);
          baselineToolTokens += grepTok;
          currentTurnActions.push({ type: 'grep', path: targetPath });
        } else if (
          name === 'edit' ||
          name === 'write' ||
          name === 'multiedit' ||
          name.includes('edit_file') ||
          name.includes('write_file') ||
          name.includes('replace')
        ) {
          editCalls++;
          if (targetPath) {
            uneditedReadPaths.delete(targetPath);
          }
          lastCommandFailed = false;
          baselineToolTokens += 400;
          currentTurnActions.push({ type: 'edit', path: targetPath });
        } else if (
          name === 'bash' ||
          name.includes('command') ||
          name.includes('shell') ||
          name.includes('exec')
        ) {
          commandCalls++;
          const failed =
            step.status === 'ERROR' ||
            step.is_error === true ||
            Boolean(observedResult && observedResult.isError);
          const cmdTok = actualReadTokensFromResult(observedResult, 500);
          baselineToolTokens += cmdTok;

          if (failed && lastCommandFailed) {
            commandRetries++;
            const retryWaste = observedResult ? cmdTok : 2400;
            wastedTokens += retryWaste;
            currentTurnActions.push({ type: 'command', isBlindRetry: true });
          } else {
            currentTurnActions.push({ type: 'command', isBlindRetry: false });
          }
          lastCommandFailed = failed;
        }
      }
    }

    flushCurrentTurn();
  }

  const totalTokens = baselineToolTokens > 0 ? baselineToolTokens : observedCharTokens;
  const clampedWastedTokens = Math.min(totalTokens, wastedTokens);
  const stingyTokens = Math.max(0, totalTokens - clampedWastedTokens);

  const rawCostUsd = Number(((totalTokens / 1_000_000) * pricePerMillionInput).toFixed(4));
  const stingyCostUsd = Number(((stingyTokens / 1_000_000) * pricePerMillionInput).toFixed(4));
  const wastedUsd = Number(Math.max(0, rawCostUsd - stingyCostUsd).toFixed(4));

  const savingsPct =
    totalTokens > 0 ? Number((((totalTokens - stingyTokens) / totalTokens) * 100).toFixed(1)) : 0.0;

  const totalTurnsScored = turnScores.length;
  const bankruptTurns = turnScores.filter((t) => t.bankrupt).length;
  const avgTurnCoins =
    totalTurnsScored > 0
      ? Number(
          (turnScores.reduce((acc, t) => acc + t.totalCoins, 0) / totalTurnsScored).toFixed(2)
        )
      : 0.0;

  return {
    totalSteps,
    fullFileReads,
    mediumReads,
    surgicalReads,
    duplicateReads,
    forbiddenReads,
    grepCalls,
    editCalls,
    commandCalls,
    commandRetries,
    rageMessages,
    totalTokens,
    wastedTokens: clampedWastedTokens,
    stingyTokens,
    rawCostUsd,
    stingyCostUsd,
    wastedUsd,
    savingsPct,
    totalTurnsScored,
    bankruptTurns,
    avgTurnCoins,
    telemetryInputTokens,
    telemetryCacheReadTokens
  };
}

function actualReadTokensFromResult(observedResult, fallbackTokens) {
  if (observedResult && observedResult.chars > 0) {
    return Math.max(20, estimateTokensFromChars(observedResult.chars));
  }
  return fallbackTokens;
}
