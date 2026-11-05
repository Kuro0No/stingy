/**
 * 🪙 Stingy Core Engine — Honest, Deterministic Coin Budget & Transcript Autopsy
 * Zero external dependencies.
 * - Per-session isolation (never leaks duplicate-read state across separate session files)
 * - User-turn grouping (accumulates all assistant tool calls within one human user turn)
 * - Dynamic tool_result payload measurement (supports both string and [{type:"text",text:"..."}] content blocks)
 * - Exact per-category waste tracking so receipt line items always sum to total wasted USD
 */

export const COIN_TABLE = Object.freeze({
  TURN_BUDGET: 10.0,
  GREP_SEARCH: 0.5,
  SURGICAL_READ: 1.0,       // <= 120 lines (via explicit range OR small file <= 120 lines)
  MEDIUM_READ: 2.0,         // 121..250 lines
  FULL_FILE_READ: 4.0,      // Unbounded read > 250 lines
  DUPLICATE_REREAD: 5.0,    // Re-reading the exact same file un-ranged without an edit in between
  BLIND_RETRY: 4.0,         // Consecutive failed shell command retry without an edit in between
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
 * Determine explicit line span from StartLine/EndLine (Antigravity/Cursor) or limit (Claude Code).
 * Note: An `offset` without `limit` or `EndLine` does NOT bound the read length (reads up to EOF / 2,000 lines),
 * so it returns `null` to defer to actual `tool_result` line count or full-file classification.
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
 * Normalize tool_result content (handles string OR array of { type: 'text', text: '...' } blocks
 * without escaping real newlines via JSON.stringify).
 */
function extractToolResultText(rawContent) {
  if (typeof rawContent === 'string') {
    return rawContent;
  }
  if (Array.isArray(rawContent)) {
    return rawContent
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item.text === 'string') return item.text;
        if (item && typeof item.content === 'string') return item.content;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (rawContent && typeof rawContent === 'object') {
    if (typeof rawContent.text === 'string') return rawContent.text;
    if (typeof rawContent.output === 'string') return rawContent.output;
  }
  return '';
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
    const contentBlocks = rec.message?.content || (Array.isArray(rec.content) ? rec.content : null);
    if (Array.isArray(contentBlocks)) {
      for (const block of contentBlocks) {
        if (block && block.type === 'tool_result' && block.tool_use_id) {
          const text = extractToolResultText(block.content);
          const lineCount = text ? text.split(/\r?\n/).length : 0;
          resultMap.set(block.tool_use_id, {
            chars: text.length,
            lines: lineCount,
            isError: Boolean(block.is_error)
          });
        }
      }
    }

    if (rec.tool_use_id && rec.content !== undefined) {
      const text = extractToolResultText(rec.content);
      const lineCount = text ? text.split(/\r?\n/).length : 0;
      resultMap.set(rec.tool_use_id, {
        chars: text.length,
        lines: lineCount,
        isError: rec.status === 'ERROR' || Boolean(rec.is_error)
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
    const allToolResults = contentBlocks.every((b) => b && b.type === 'tool_result');
    if (allToolResults) return false;
  }

  return true;
}

/**
 * Analyze one or more sessions honestly.
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
  let fullReadWastedTokens = 0;
  let mediumReadWastedTokens = 0;
  let dupReadWastedTokens = 0;
  let forbiddenReadWastedTokens = 0;
  let retryWastedTokens = 0;
  let rageWastedTokens = 0;

  let observedCharTokens = 0;
  let telemetryInputTokens = 0;
  let telemetryCacheReadTokens = 0;

  const turnScores = [];

  for (const sessionLines of sessions) {
    if (!Array.isArray(sessionLines)) continue;

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

    // Session-scoped state
    const uneditedReadPaths = new Set();
    let lastCommandFailed = false;
    let lastFailedCommandSig = null;
    let currentTurnActions = [];

    function flushCurrentTurn() {
      if (currentTurnActions.length > 0) {
        turnScores.push(evaluateTurnBudget(currentTurnActions));
        currentTurnActions = [];
      }
    }

    for (const step of records) {
      totalSteps++;

      const usage = step.usage || step.message?.usage;
      if (usage && typeof usage === 'object') {
        telemetryInputTokens +=
          Number(usage.input_tokens || 0) + Number(usage.cache_creation_input_tokens || 0);
        telemetryCacheReadTokens += Number(usage.cache_read_input_tokens || 0);
      }

      if (isHumanPromptRecord(step)) {
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
          rageWastedTokens += rageTok;
        }
      }

      const toolCalls = extractNormalizedToolCalls(step);
      if (toolCalls.length === 0) continue;

      for (const tc of toolCalls) {
        const { id, name, args, inlineResult } = tc;
        const targetPath = String(
          args.Path || args.file_path || args.path || args.filePath || args.file || ''
        );

        const inlineText = inlineResult !== null ? extractToolResultText(inlineResult) : '';
        const observedResult =
          (id && toolResultsMap.get(id)) ||
          (inlineText
            ? { chars: inlineText.length, lines: inlineText.split(/\r?\n/).length }
            : null);

        if (name === 'read' || name.includes('read_file') || name.includes('view_file')) {
          if (targetPath && isForbiddenPath(targetPath)) {
            forbiddenReads++;
            currentTurnActions.push({ type: 'read', path: targetPath });
            const tok = observedResult ? estimateTokensFromChars(observedResult.chars) : 8000;
            baselineToolTokens += tok;
            forbiddenReadWastedTokens += tok;
            continue;
          }

          const span = getReadLineSpan(args);
          // If explicit bounded range is supplied (e.g. offset+limit or StartLine+EndLine), use the smaller of span or actual returned lines
          const effectiveLines =
            span !== null
              ? observedResult
                ? Math.min(span, observedResult.lines)
                : span
              : observedResult
                ? observedResult.lines
                : null;

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
            dupReadWastedTokens += dupTokens;
            currentTurnActions.push({
              type: 'read',
              path: targetPath,
              totalFileLines: effectiveLines ?? 500,
              isDuplicateRead: true
            });
          } else if (effectiveLines !== null && effectiveLines <= 120) {
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
            const waste = Math.max(0, medTokens - surgicalBaseline);
            baselineToolTokens += medTokens;
            mediumReadWastedTokens += waste;
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
            const waste = Math.max(0, fullTokens - surgicalEquivalent);
            baselineToolTokens += fullTokens;
            fullReadWastedTokens += waste;
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
          lastFailedCommandSig = null;
          baselineToolTokens += 400;
          currentTurnActions.push({ type: 'edit', path: targetPath });
        } else if (
          name === 'bash' ||
          name.includes('command') ||
          name.includes('shell') ||
          name.includes('exec')
        ) {
          commandCalls++;
          const cmdRaw = String(
            args.command || args.CommandLine || args.cmd || args.script || ''
          ).trim();
          const cmdSig = cmdRaw ? cmdRaw.split(/\s+/)[0].toLowerCase() : '__unspecified_cmd__';

          const failed =
            step.status === 'ERROR' ||
            step.is_error === true ||
            Boolean(observedResult && observedResult.isError);
          const cmdTok = actualReadTokensFromResult(observedResult, 500);
          baselineToolTokens += cmdTok;

          // Only count as a blind retry if the previous command failed AND either the command signature matches
          // (e.g. re-running the same tool/test runner) or neither command specified a command string.
          const isSameFailedCommand =
            failed &&
            lastCommandFailed &&
            (cmdSig === lastFailedCommandSig ||
              cmdSig === '__unspecified_cmd__' ||
              lastFailedCommandSig === '__unspecified_cmd__');

          if (isSameFailedCommand) {
            commandRetries++;
            const retryWaste = observedResult ? cmdTok : 2400;
            retryWastedTokens += retryWaste;
            currentTurnActions.push({ type: 'command', isBlindRetry: true });
          } else {
            currentTurnActions.push({ type: 'command', isBlindRetry: false });
          }
          lastCommandFailed = failed;
          lastFailedCommandSig = failed ? cmdSig : null;
        }
      }
    }

    flushCurrentTurn();
  }

  const wastedTokens =
    fullReadWastedTokens +
    mediumReadWastedTokens +
    dupReadWastedTokens +
    forbiddenReadWastedTokens +
    retryWastedTokens +
    rageWastedTokens;

  const totalTokens = baselineToolTokens > 0 ? baselineToolTokens : observedCharTokens;
  const clampedWastedTokens = Math.min(totalTokens, wastedTokens);
  const stingyTokens = Math.max(0, totalTokens - clampedWastedTokens);

  const toUsd = (tok) => Number(((tok / 1_000_000) * pricePerMillionInput).toFixed(4));

  const fullReadUsd = toUsd(fullReadWastedTokens + mediumReadWastedTokens + forbiddenReadWastedTokens);
  const dupReadUsd = toUsd(dupReadWastedTokens);
  const retryUsd = toUsd(retryWastedTokens);
  const rageUsd = toUsd(rageWastedTokens);

  const rawCostUsd = toUsd(totalTokens);
  const stingyCostUsd = toUsd(stingyTokens);
  const wastedUsd = toUsd(clampedWastedTokens);

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
    fullReadWastedTokens,
    dupReadWastedTokens,
    retryWastedTokens,
    rageWastedTokens,
    fullReadUsd,
    dupReadUsd,
    retryUsd,
    rageUsd,
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
