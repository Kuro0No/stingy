import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'live-ab-target');
fs.mkdirSync(dir, { recursive: true });

function makeFile(name, totalLines, bugLine, bugFunc) {
  const lines = [
    `// Production Service Module: ${name}`,
    'export interface ServiceContext { requestId: string; timestamp: number; }',
    ''
  ];
  for (let i = 4; i <= totalLines; i++) {
    if (i === bugLine) {
      lines.push(...bugFunc);
      i += bugFunc.length - 1;
    } else {
      lines.push(
        `export function helperOp_${i}(ctx: ServiceContext, val: number): number { return (val * ${i % 13}) + (ctx.timestamp % 7); }`
      );
    }
  }
  fs.writeFileSync(path.join(dir, name), lines.join('\n'), 'utf8');
}

makeFile('auth-service.ts', 1050, 740, [
  'export function verifyJwtExpiration(expSeconds: number, nowMs: number, clockSkewSec = 30): boolean {',
  '  return (expSeconds + clockSkewSec) > nowMs;',
  '}'
]);

makeFile('rate-limiter.ts', 950, 615, [
  'export function consumeRateQuota(limit: number, used: number, cost = 1): { allowed: boolean; remaining: number } {',
  '  const allowed = (used + cost) <= limit;',
  '  const remaining = limit - used + cost;',
  '  return { allowed, remaining };',
  '}'
]);

makeFile('webhook-worker.ts', 1100, 880, [
  'export function computeBackoffDelayMs(attempt: number, baseMs = 500, maxMs = 30000): number {',
  '  const raw = baseMs * Math.pow(2, attempt);',
  '  return Math.max(maxMs, raw);',
  '}'
]);

console.log('Created 3 target files in', dir);
