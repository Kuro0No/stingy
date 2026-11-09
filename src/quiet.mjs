import { spawnSync } from 'node:child_process';

const FAIL = /(fail|error|✖|✗|not ok|assert|expected|actual|exception|traceback|panic|cannot find)/i;
const PASS = /^\s*(✔|✓|√|ok \d|PASS\b)|\bPASSED\b/; // a passing test named "…fails…" is not a failure
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;

/**
 * Keeps what an agent needs from a test or build log: failure lines with a little context and the summary.
 * A passing run collapses to its last lines. Every kept line stays in the agent's context for later calls.
 */
export function compressOutput(text, exitCode, { maxLines = 60, context = 2, tail = 8 } = {}) {
  const lines = String(text).replace(ANSI, '').split(/\r?\n/).filter((line) => line.trim());
  // Test runners print their pass/fail counts in the last few lines.
  if (exitCode === 0) return [`exit 0 (${lines.length} lines, last ${Math.min(tail, lines.length)} shown)`, ...lines.slice(-tail)].join('\n');

  const keep = new Set();
  lines.forEach((line, i) => {
    if (!FAIL.test(line) || PASS.test(line)) return;
    for (let j = Math.max(0, i - context); j <= Math.min(lines.length - 1, i + context); j++) keep.add(j);
  });
  for (let j = Math.max(0, lines.length - tail); j < lines.length; j++) keep.add(j);

  const out = [];
  const seen = new Set();
  let last = -1;
  for (const i of [...keep].sort((a, b) => a - b)) {
    if (seen.has(lines[i])) continue; // repeated stack frames and log lines
    seen.add(lines[i]);
    if (last !== -1 && i > last + 1) out.push('…');
    out.push(lines[i]);
    last = i;
  }
  const shown = out.length > maxLines ? [...out.slice(0, maxLines - 1), `… ${out.length - maxLines + 1} more lines`] : out;
  return [`exit ${exitCode} (${lines.length} lines, ${shown.length} shown)`, ...shown].join('\n');
}

/** `stingy quiet -- <command...>`: runs the command, prints the compressed log and keeps its exit code. */
export function runQuiet(argv) {
  const cut = argv.indexOf('--');
  const parts = cut === -1 ? argv : argv.slice(cut + 1);
  if (parts.length === 0) throw new Error('Usage: stingy quiet -- <command> [args...]');
  const quote = (arg) => (/[\s"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg);
  const res = spawnSync(parts.map(quote).join(' '), { shell: true, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (res.error) throw res.error;
  const code = res.status ?? 1;
  console.log(compressOutput(`${res.stdout || ''}\n${res.stderr || ''}`, code));
  process.exitCode = code;
}
