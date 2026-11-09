import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_CONTEXT_WARN = 150000;
const WARN_STEP = 100000;
const MARK = '🪙 Stingy:';

/** Last bytes of a file as text: transcripts can be hundreds of MB. */
function tail(file, bytes = 2 * 1024 * 1024) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, bytes);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    return buf.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

/** Context size of the last main-chat model call in a Claude Code transcript, from its recorded usage. */
export function lastContextTokens(text) {
  const lines = String(text).split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"usage"')) continue;
    try {
      const entry = JSON.parse(lines[i]);
      const u = entry.message?.usage;
      if (!u || entry.isSidechain) continue; // subagents have their own context
      const total = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
      if (total > 0) return total; // synthetic entries record zero usage
    } catch {
      // the tail's first line is cut, or not JSON
    }
  }
  return 0;
}

/**
 * UserPromptSubmit check: once each call re-sends more than `limit` tokens, tell the user (a hook message,
 * not model context) that a new task belongs in a new chat. One warning per 100k step; a smaller context
 * after /compact starts over. The last step per transcript lives in one small temp file.
 */
export function hygieneMessage(
  event,
  limit = Number(process.env.STINGY_CONTEXT_WARN) || DEFAULT_CONTEXT_WARN,
  stateFile = path.join(os.tmpdir(), 'stingy-hygiene.json')
) {
  const file = event?.transcript_path;
  if (!file || !fs.existsSync(file)) return null;
  const tokens = lastContextTokens(tail(file));
  const step = tokens < limit ? -1 : Math.floor((tokens - limit) / WARN_STEP);
  let state = {};
  try {
    state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch {
    // no state yet
  }
  if (!state || typeof state !== 'object' || Array.isArray(state)) state = {};
  const warned = state[file] ?? -1;
  if (step === warned) return null;
  delete state[file];
  if (step >= 0) state[file] = step;
  try {
    fs.writeFileSync(stateFile, JSON.stringify(Object.fromEntries(Object.entries(state).slice(-50))));
  } catch {
    // temp folder not writable: the warning may repeat
  }
  if (step < warned) return null;
  return {
    systemMessage: `${MARK} this chat re-sends about ${Math.round(tokens / 1000)}k tokens on every call. For a new task, start a new chat (or run /compact) and paste a 3-line summary of what matters.`
  };
}

/** Standalone copy for `.claude/hooks/`: it must keep working after the npx cache is cleaned. */
export function hygieneScript() {
  return `#!/usr/bin/env node
// 🪙 Stingy session hygiene (UserPromptSubmit): tells you when this chat has grown expensive.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_CONTEXT_WARN = ${DEFAULT_CONTEXT_WARN};
const WARN_STEP = ${WARN_STEP};
const MARK = ${JSON.stringify(MARK)};
${tail.toString()}
${lastContextTokens.toString()}
${hygieneMessage.toString()}
let event = {};
try {
  event = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
} catch {
  process.exit(0);
}
const message = hygieneMessage(event);
if (message) process.stdout.write(JSON.stringify(message) + '\\n');
`;
}

/** Parses a JSON object file; an unparsable file is reported and never replaced. */
export function readJsonObject(file) {
  if (!fs.existsSync(file)) return {};
  let value;
  try {
    value = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot parse ${file} (${error.message}). Fix the JSON and try again; nothing was changed.`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${file} is not a JSON object; nothing was changed.`);
  }
  return value;
}

/** Writes the hook script and adds it to `.claude/settings.json` under UserPromptSubmit, keeping other settings. */
export function installHygieneHook(root = process.cwd()) {
  const settingsPath = path.join(root, '.claude', 'settings.json');
  const settings = readJsonObject(settingsPath);
  const script = path.join(root, '.claude', 'hooks', 'stingy-hygiene.mjs');
  fs.mkdirSync(path.dirname(script), { recursive: true });
  fs.writeFileSync(script, hygieneScript());

  settings.hooks = settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {};
  const list = Array.isArray(settings.hooks.UserPromptSubmit) ? settings.hooks.UserPromptSubmit : [];
  const installed = list.some((entry) =>
    (Array.isArray(entry?.hooks) ? entry.hooks : []).some((h) => String(h?.command || '').includes('stingy-hygiene.mjs'))
  );
  if (!installed) {
    list.push({ hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/stingy-hygiene.mjs"' }] });
  }
  settings.hooks.UserPromptSubmit = list;
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  return { script, settingsPath };
}
