import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { execFileSync } from 'node:child_process';
import { readJsonObject } from './hygiene.mjs';

const IGNORED = new Set([
  '.git', 'node_modules', 'dist', 'build', '.next', 'coverage', 'vendor', '.venv', 'venv', '__pycache__',
  'target', '.gradle', 'Pods', '.dart_tool', 'out', '.turbo', '.cache'
]);
const MAX_FILE_BYTES = 2 * 1024 * 1024;

// Kept short on purpose: every tool definition is re-sent with every model call.
export const TOOLS = [
  {
    name: 'find',
    description: 'Search code; returns each match with surrounding lines, so search and read take one call.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regular expression' },
        path: { type: 'string', description: 'File or folder (default .)' },
        context: { type: 'number', description: 'Lines around each match (default 20)' },
        max: { type: 'number', description: 'Max matches (default 8)' }
      },
      required: ['pattern']
    }
  },
  {
    name: 'outline',
    description: 'Functions, classes and types of a file, with line numbers.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
  }
];

/** Resolves a path inside the project root (`root` is a real path); `..` and symlinks that lead out are refused. */
function inside(root, p) {
  const outside = (target) => {
    const rel = path.relative(root, target);
    return rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);
  };
  const full = path.resolve(root, p || '.');
  if (outside(full)) throw new Error(`Path outside the project: ${p}`);
  const real = fs.realpathSync(full);
  if (outside(real)) throw new Error(`Path outside the project: ${p}`);
  return real;
}

/** Files git would track (respects .gitignore); outside a git repo, a walk that skips generated folders. */
function listFiles(dir) {
  try {
    const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 256 * 1024 * 1024
    });
    return out.split('\0').filter(Boolean).map((f) => path.join(dir, f));
  } catch {
    const files = [];
    (function walk(d) {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        if (IGNORED.has(entry.name)) continue;
        const p = path.join(d, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (entry.isFile()) files.push(p);
      }
    })(dir);
    return files;
  }
}

/** Text of a file, or null for binaries and files over 2 MB. */
function readText(file) {
  if (fs.statSync(file).size > MAX_FILE_BYTES) return null;
  const buf = fs.readFileSync(file);
  return buf.subarray(0, 8000).includes(0) ? null : buf.toString('utf8');
}

export function find(root, { pattern, path: p = '.', context = 20, max = 8 } = {}) {
  const re = new RegExp(pattern);
  const target = inside(root, p);
  const files = fs.statSync(target).isDirectory() ? listFiles(target) : [target];
  const ctx = Math.min(Math.max(0, Number(context) || 0), 60);
  const limit = Math.min(Math.max(1, Number(max) || 8), 20);
  const out = [];
  let matches = 0;
  for (const file of files) {
    let text = null;
    try {
      text = readText(file);
    } catch {
      continue;
    }
    if (text === null) continue;
    const lines = text.split(/\r?\n/);
    let shownTo = -1;
    for (let i = 0; i < lines.length && matches < limit; i++) {
      if (!re.test(lines[i])) continue;
      matches++;
      const from = Math.max(i - ctx, shownTo + 1); // overlapping ranges print once
      const to = Math.min(lines.length - 1, i + ctx);
      if (from > to) continue;
      out.push(`${path.relative(root, file)}:${from + 1}-${to + 1}`);
      for (let j = from; j <= to; j++) out.push(`${j + 1}\t${lines[j]}`);
      shownTo = to;
    }
    if (matches >= limit) break;
  }
  return matches ? out.join('\n') : `No match for /${pattern}/ in ${p}`;
}

const DECLARATION =
  /^\s*(export\s+)?(default\s+)?(async\s+)?(function\*?|class|interface|type|enum|def|func|struct|impl|trait|fn|module)\s+[\w$]+|^\s*(export\s+)?(const|let|var)\s+[\w$]+\s*=\s*(async\s*)?(\([^)]*\)|[\w$]+)\s*=>|^\s*(public|private|protected|static|internal|override)[\w\s<>,[\]?]*\s+[\w$]+\s*\(/;

export function outline(root, { path: p } = {}) {
  const file = inside(root, p);
  const text = readText(file);
  if (text === null) throw new Error(`Not a text file under 2 MB: ${p}`);
  const out = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (out.length < 300 && DECLARATION.test(line)) out.push(`${i + 1}\t${line.trim().slice(0, 160)}`);
  });
  return out.length ? out.join('\n') : `No declarations found in ${p}`;
}

/** Minimal MCP server over stdio (newline-delimited JSON-RPC): read-only, inside the project root. */
export function serveMcp({ root = process.cwd(), input = process.stdin, output = process.stdout, version = '0.0.0' } = {}) {
  root = fs.realpathSync(root);
  const send = (msg) => output.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  rl.on('line', (line) => {
    let req;
    try {
      req = JSON.parse(line);
    } catch {
      return;
    }
    if (req?.id === undefined) return; // notifications need no answer
    if (req.method === 'initialize') {
      send({
        id: req.id,
        result: {
          protocolVersion: req.params?.protocolVersion || '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'stingy', version }
        }
      });
    } else if (req.method === 'tools/list') {
      send({ id: req.id, result: { tools: TOOLS } });
    } else if (req.method === 'tools/call') {
      const { name, arguments: input = {} } = req.params || {};
      const tool = { find, outline }[name];
      let text;
      let isError = false;
      try {
        if (!tool) throw new Error(`Unknown tool: ${name}`);
        text = tool(root, input);
      } catch (error) {
        text = error.message;
        isError = true;
      }
      send({ id: req.id, result: { content: [{ type: 'text', text }], isError } });
    } else if (req.method === 'ping') {
      send({ id: req.id, result: {} });
    } else {
      send({ id: req.id, error: { code: -32601, message: `Method not found: ${req.method}` } });
    }
  });
  return new Promise((resolve) => rl.on('close', resolve));
}

/** Adds the stingy server to Claude Code's project `.mcp.json`, keeping other servers. */
export function installClaudeMcp(root = process.cwd()) {
  const file = path.join(root, '.mcp.json');
  const config = readJsonObject(file);
  config.mcpServers = config.mcpServers && typeof config.mcpServers === 'object' ? config.mcpServers : {};
  const args = ['-y', 'github:Kuro0No/stingy', 'mcp'];
  config.mcpServers.stingy = process.platform === 'win32'
    ? { command: 'cmd', args: ['/c', 'npx', ...args] }
    : { command: 'npx', args };
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
  return file;
}
