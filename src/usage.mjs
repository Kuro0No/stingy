import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

// Source IDs accepted by the ccusage unified CLI.
export const USAGE_SOURCES = Object.freeze([
  'claude', 'codex', 'opencode', 'amp', 'droid', 'codebuff', 'hermes', 'pi',
  'goose', 'openclaw', 'kilo', 'kimi', 'qwen', 'copilot', 'gemini',
  'antigravity', 'grok', 'zcode'
]);

const tokenFields = ['inputTokens', 'outputTokens', 'cacheCreationTokens', 'cacheReadTokens'];
const counts = ['sessions', ...tokenFields, 'totalTokens', 'estimatedCostUsd', 'unpricedSessions'];
const isAmount = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const emptyCounts = () => Object.fromEntries(counts.map((field) => [field, 0]));

export function summarizeCcusage(report, source) {
  const sessions = report?.session ?? report?.sessions;
  if (!Array.isArray(sessions)) {
    throw new Error('Expected a JSON session report from ccusage session --json --offline.');
  }

  const totals = emptyCounts();
  const agents = new Map();
  for (const row of sessions) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error('Invalid session entry in the ccusage report.');
    }

    const reportedAgent = row.agent ?? row.source;
    const agent = typeof reportedAgent === 'string' && /^[a-z0-9_-]+$/.test(reportedAgent)
      ? reportedAgent
      : source ?? 'unknown';
    if (source && agent !== source) continue;

    const session = { sessions: 1 };
    for (const field of tokenFields) session[field] = isAmount(row[field]) ? row[field] : 0;
    session.totalTokens = isAmount(row.totalTokens)
      ? row.totalTokens
      : tokenFields.reduce((sum, field) => sum + session[field], 0);
    session.estimatedCostUsd = isAmount(row.totalCost) ? row.totalCost : 0;
    session.unpricedSessions = isAmount(row.totalCost) ? 0 : 1;

    if (!agents.has(agent)) agents.set(agent, { agent, ...emptyCounts() });
    const group = agents.get(agent);
    for (const field of counts) {
      group[field] += session[field];
      totals[field] += session[field];
    }
  }

  return {
    agents: [...agents.values()].sort((a, b) => b.totalTokens - a.totalTokens || a.agent.localeCompare(b.agent)),
    totals
  };
}

function runCcusage(source) {
  const args = [...(source ? [source] : []), 'session', '--json', '--offline'];
  // cmd.exe resolves the .cmd shim created by npm on Windows. Only fixed
  // arguments and an allowlisted source reach this command.
  const windows = process.platform === 'win32';
  const result = spawnSync(
    windows ? 'cmd.exe' : 'ccusage',
    windows ? ['/d', '/c', 'ccusage', ...args] : args,
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true }
  );
  if (result.error?.code === 'ENOENT' || /not recognized as an internal or external command/i.test(result.stderr ?? '')) {
    throw new Error('ccusage was not found. Install it on PATH or use stingy usage --from with a ccusage JSON report.');
  }
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    if (/no (?:usage data|session data|sessions) (?:found|available)/i.test(detail)) {
      return '{"session":[]}';
    }
    throw new Error(detail || 'ccusage could not load a session report.');
  }
  return result.stdout;
}

export function readUsageReport({ source, from } = {}) {
  if (source && !USAGE_SOURCES.includes(source)) {
    throw new Error(`Unknown agent ${source}. Usage sources are ${USAGE_SOURCES.join(', ')}.`);
  }
  const raw = from ? fs.readFileSync(from === '-' ? 0 : from, 'utf8') : runCcusage(source);
  return summarizeCcusage(JSON.parse(raw.replace(/^\uFEFF/, '')), source);
}
