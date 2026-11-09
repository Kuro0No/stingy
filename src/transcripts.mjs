import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';

export const ROAST_SOURCES = Object.freeze([
  'claude', 'antigravity', 'codex', 'gemini', 'pi', 'openclaw', 'copilot'
]);

function configuredRoots(variable, defaults) {
  const configured = process.env[variable];
  return configured === undefined ? defaults : configured.split(',').map((dir) => dir.trim()).filter(Boolean);
}

function sourceRoots(home) {
  const configHome = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
  return {
    claude: configuredRoots('CLAUDE_CONFIG_DIR', [path.join(home, '.claude'), path.join(configHome, 'claude')])
      .map((dir) => path.basename(dir) === 'projects' ? dir : path.join(dir, 'projects')),
    antigravity: configuredRoots('ANTIGRAVITY_DATA_DIR', [path.join(home, '.gemini', 'antigravity')])
      .map((dir) => path.basename(dir) === 'brain' ? dir : path.join(dir, 'brain')),
    codex: configuredRoots('CODEX_HOME', [path.join(home, '.codex')])
      .flatMap((dir) => ['sessions', 'archived_sessions'].map((part) => path.join(dir, part))),
    gemini: configuredRoots('GEMINI_DATA_DIR', [path.join(home, '.gemini', 'tmp')]),
    pi: configuredRoots('PI_AGENT_DIR', [path.join(home, '.pi', 'agent', 'sessions')]),
    openclaw: configuredRoots('OPENCLAW_DIR', ['.openclaw', '.clawdbot', '.moltbot', '.moldbot'].map((name) => path.join(home, name)))
      .map((dir) => path.join(dir, 'agents')),
    copilot: configuredRoots('COPILOT_HOME', [path.join(home, '.copilot')])
      .map((dir) => path.join(dir, 'session-state'))
  };
}

function isSessionFile(name, source) {
  const lower = name.toLowerCase();
  if (source === 'copilot') return lower === 'events.jsonl';
  if (source === 'gemini') return /^session.*\.jsonl?$/.test(lower);
  return (lower.endsWith('.jsonl') && !lower.includes('transcript_full')) ||
    (!source && /^session.*\.json$/.test(lower));
}

export function findLocalLogs(customTarget = null, source = null) {
  const files = new Map();

  function addFile(file, origin) {
    try {
      const stat = fs.statSync(file);
      if (stat.isFile() && stat.size > 0) {
        const resolved = fs.realpathSync(file);
        if (!files.has(resolved)) files.set(resolved, { path: resolved, size: stat.size, mtime: stat.mtimeMs, source: origin });
      }
    } catch {
      // Files can be rotated while the CLI is scanning.
    }
  }

  function walk(dir, origin, depth = 0) {
    if (depth > 5) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(child, origin, depth + 1);
      else if (entry.isFile() && isSessionFile(entry.name, origin)) addFile(child, origin);
    }
  }

  if (customTarget) {
    const resolved = path.resolve(customTarget);
    addFile(resolved, source);
    if (files.size === 0) walk(resolved, source);
  } else {
    const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
    const roots = sourceRoots(home);
    for (const origin of source ? [source] : ROAST_SOURCES) {
      for (const dir of roots[origin] ?? []) walk(dir, origin);
    }
  }

  return [...files.values()]
    .sort((a, b) => b.mtime - a.mtime || a.path.localeCompare(b.path))
    .slice(0, customTarget ? 50 : 25);
}

function parseObject(raw) {
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function textContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((item) => item?.text ?? '').join('\n');
}

const toolAliases = new Map([['view', 'read'], ['create', 'write'], ['apply_patch', 'edit']]);

function callRecord(id, name, rawArgs) {
  if (typeof name !== 'string' || !name) return null;
  const toolName = name.split(/[.:]/).at(-1).toLowerCase();
  const args = typeof rawArgs === 'string' ? parseObject(rawArgs) ?? {} : { ...rawArgs };
  if (toolName === 'view' && Array.isArray(args.view_range)) {
    const [start, end] = args.view_range;
    if (Number.isInteger(start) && Number.isInteger(end) && end >= start) {
      args.startLine = start;
      args.endLine = end;
    }
  }
  if (toolName === 'apply_patch' && typeof rawArgs === 'string') {
    args.path = rawArgs.match(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/m)?.[1]?.trim();
  }
  return { tool_calls: [{ id, name: toolAliases.get(toolName) ?? toolName, arguments: args }] };
}

function resultRecord(id, content, isError = false) {
  return id ? { tool_use_id: id, content, is_error: isError } : null;
}

function codexToolCall(id, name, args, command) {
  if (command?.source === 'user_shell') return null;
  const actions = command?.parsed_cmd;
  if (command?.exit_code === 0 && Array.isArray(actions) && actions.length === 1) {
    const action = actions[0];
    if (action?.type === 'read' && typeof action.path === 'string') {
      return callRecord(id, 'read', { path: action.path });
    }
    if (action?.type === 'search') return callRecord(id, 'grep', { path: action.path });
  }
  return callRecord(id, name, args);
}

function codexCommandFailed(command) {
  return command?.status === 'failed' || (Number.isInteger(command?.exit_code) && command.exit_code !== 0);
}

function codexRecords(entries) {
  const commands = new Map();
  const calls = new Set();
  const outputs = new Set();
  let hasUserItem = false;
  let hasUserEvent = false;
  for (const row of entries) {
    const item = row.payload;
    if (row.type === 'event_msg') {
      if (item?.type === 'user_message') hasUserEvent = true;
      if (item?.type === 'item_completed' && item.item?.type === 'UserMessage') hasUserItem = true;
      if (item?.type === 'item_completed' && item.item?.type === 'CommandExecution' && item.item.id) {
        commands.set(item.item.id, item.item);
      }
    } else if (row.type === 'response_item') {
      if (item?.type === 'function_call' || item?.type === 'custom_tool_call') calls.add(item.call_id);
      if (item?.type === 'function_call_output' || item?.type === 'custom_tool_call_output') outputs.add(item.call_id);
    }
  }

  return entries.flatMap((row) => {
    if (row.type === 'turn.started') return [{ type: 'user' }];
    if (row.type === 'item.completed') {
      const completed = row.item;
      if (completed?.type === 'command_execution') {
        return [
          callRecord(completed.id, 'exec_command', { cmd: completed.command }),
          resultRecord(completed.id, completed.aggregated_output, codexCommandFailed(completed))
        ];
      }
      if (completed?.type === 'file_change' && completed.status === 'completed') {
        const paths = Array.isArray(completed.changes) ? completed.changes.map((change) => change?.path) : [];
        return [callRecord(completed.id, 'edit', { paths })];
      }
      return [];
    }
    const item = row.payload;
    if (!item) return [];
    if (row.type === 'event_msg') {
      if (!hasUserItem && item.type === 'user_message') return [{ type: 'user', content: item.message }];
      if (item.type !== 'item_completed') return [];
      const finished = item.item;
      if (finished?.type === 'UserMessage') return [{ type: 'user', content: textContent(finished.content) }];
      if (finished?.type !== 'CommandExecution' || !finished.id || finished.source === 'user_shell') return [];
      const records = [];
      if (!calls.has(finished.id)) {
        records.push(codexToolCall(finished.id, 'exec_command', { cmd: JSON.stringify(finished.command) }, finished));
      }
      if (!outputs.has(finished.id)) {
        records.push(resultRecord(finished.id, finished.aggregated_output, codexCommandFailed(finished)));
      }
      return records;
    }
    if (row.type !== 'response_item') return [];
    if (!hasUserItem && !hasUserEvent && item.type === 'message' && item.role === 'user') {
      return [{ type: 'user', content: textContent(item.content) }];
    }
    const command = commands.get(item.call_id);
    if (item.type === 'function_call' || item.type === 'custom_tool_call') {
      return [codexToolCall(item.call_id, item.name, item.arguments ?? item.input, command)];
    }
    if (item.type === 'function_call_output' || item.type === 'custom_tool_call_output') {
      const content = item.output?.output ?? item.output;
      const text = textContent(content);
      const frame = text.match(/^(Chunk ID:[\s\S]*?)\r?\n(?:Final output|Output):\r?\n([\s\S]*)$/);
      const exit = (frame?.[1] ?? text).match(/^(?:Process exited with code|Exit code:)\s*(-?\d+)\s*$/m);
      const isError = codexCommandFailed(command) || item.output?.success === false ||
        (exit !== null && Number(exit[1]) !== 0);
      return [resultRecord(item.call_id, frame?.[2] ?? content, isError)];
    }
    return [];
  });
}

function copilotRecords(entries) {
  return entries.map(({ type, data }) => {
    if (!data) return null;
    if (type === 'user.message') return { type: 'user', content: data.content };
    if (type === 'tool.execution_start') return callRecord(data.toolCallId, data.toolName, data.arguments);
    if (type === 'tool.execution_complete') {
      return resultRecord(data.toolCallId, data.result?.content ?? data.error?.message, data.success === false);
    }
    return null;
  });
}

function piRecords(entries) {
  return entries.flatMap(({ message }) => {
    if (message?.role === 'user') return [{ type: 'user', content: textContent(message.content) }];
    if (message?.role === 'toolResult') {
      return [resultRecord(message.toolCallId, message.content, message.isError === true)];
    }
    if (message?.role === 'assistant' && Array.isArray(message.content)) {
      return message.content
        .filter((item) => item?.type === 'toolCall')
        .map((item) => callRecord(item.id, item.name, item.arguments));
    }
    return [];
  });
}

function geminiMessages(entries) {
  const messages = new Map();
  for (const entry of entries) {
    const snapshot = entry.messages ?? entry.$set?.messages;
    for (const message of Array.isArray(snapshot) ? snapshot : [entry]) {
      if (message?.type === 'user' || message?.type === 'gemini') {
        messages.set(message.id ?? Symbol(), { ...message });
      }
    }
    const patch = entry.$patch;
    if (!patch) continue;
    const updates = Array.isArray(patch.updates) ? [...patch.updates, patch] : [patch];
    for (const update of updates) {
      const message = messages.get(update?.id);
      if (!message) continue;
      if (update.content !== undefined) message.content = update.content;
      if (Array.isArray(update.toolCalls) && Array.isArray(message.toolCalls)) {
        const byId = new Map(update.toolCalls.filter(Boolean).map((call) => [call.id, call]));
        message.toolCalls = message.toolCalls.map((call) => ({ ...call, ...byId.get(call?.id) }));
      }
    }
  }
  return [...messages.values()];
}

function geminiRecords(entries) {
  const records = [];
  for (const message of geminiMessages(entries)) {
    if (message.type === 'user') records.push({ type: 'user', content: textContent(message.content) });
    if (!Array.isArray(message.toolCalls)) continue;
    for (const call of message.toolCalls) {
      if (!call) continue;
      records.push(callRecord(call.id, call.name, call.args));
      const parts = Array.isArray(call.result) ? call.result : [call.result];
      const content = parts.flatMap((part) => {
        const response = part?.functionResponse?.response;
        const value = response?.output ?? response?.content ?? response?.error ?? part?.text ?? part;
        return typeof value === 'string' ? [value] : [];
      });
      const isError = ['error', 'failed'].includes(String(call.status).toLowerCase());
      records.push(resultRecord(call.id, content.length > 0 ? content.join('\n') : undefined, isError));
    }
  }
  return records;
}

const adapters = new Map([
  ['codex', codexRecords],
  ['copilot', copilotRecords],
  ['pi', piRecords],
  ['openclaw', piRecords],
  ['gemini', geminiRecords]
]);

function detectSource(entries) {
  if (entries.some((row) => row.type === 'session_meta' || row.type === 'response_item' ||
      (row.type === 'thread.started' && typeof row.thread_id === 'string') ||
      (row.type === 'item.completed' && row.item?.type === 'command_execution') ||
      (row.type === 'event_msg' && row.payload?.item?.type === 'CommandExecution'))) return 'codex';
  if (entries.some((row) => row.type === 'session.start' || row.type === 'tool.execution_start')) return 'copilot';
  if (entries.some((row) => row.type === 'gemini' || Array.isArray(row.messages) || row.projectHash)) return 'gemini';
  if (entries.some((row) => row.message?.role === 'toolResult' ||
      (Array.isArray(row.message?.content) && row.message.content.some((item) => item?.type === 'toolCall')))) {
    return 'pi';
  }
  return null;
}

/**
 * Non-empty lines of a JSONL file, read in 8 MB chunks: a transcript over ~512 MB cannot be held
 * in one JavaScript string, and reading it whole made roast skip the biggest sessions silently.
 */
export function readLinesSync(filePath, chunkSize = 8 * 1024 * 1024) {
  const fd = fs.openSync(filePath, 'r');
  const decoder = new StringDecoder('utf8');
  const buf = Buffer.alloc(chunkSize);
  const lines = [];
  let rest = '';
  try {
    for (let n; (n = fs.readSync(fd, buf, 0, buf.length, null)) > 0; ) {
      const parts = (rest + decoder.write(buf.subarray(0, n))).split(/\r?\n/);
      rest = parts.pop();
      for (const line of parts) if (line.trim()) lines.push(line);
    }
    rest += decoder.end();
    if (rest.trim()) lines.push(rest);
  } finally {
    fs.closeSync(fd);
  }
  if (lines.length > 0) lines[0] = lines[0].replace(/^\uFEFF/, '');
  return lines;
}

export function readTranscript(file) {
  const isJson = /\.json$/i.test(file.path);
  const raw = isJson ? fs.readFileSync(file.path, 'utf8').replace(/^\uFEFF/, '') : null;
  const lines = isJson ? raw.split(/\r?\n/).filter((line) => line.trim()) : readLinesSync(file.path);
  if (file.source === 'claude' || file.source === 'antigravity') return lines;

  const entries = (isJson ? [raw] : lines).map(parseObject).filter(Boolean);
  const source = file.source ?? detectSource(entries);
  const adapt = adapters.get(source);
  if (!adapt) return isJson ? [] : lines;
  const normalized = adapt(entries).filter(Boolean);
  return normalized.some((row) => row.tool_calls?.length) ? normalized.map((row) => JSON.stringify(row)) : [];
}
