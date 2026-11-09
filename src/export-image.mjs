import zlib from 'node:zlib';

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Render the Stingy Token Autopsy Receipt as a self-contained SVG card.
 */
export function renderReceiptSvg(data) {
  const {
    filesCount = 1,
    totalSteps = 0,
    readWasteLabel = 'Full/Medium/Forbidden Reads',
    readWasteCount = 0,
    readWastedTokens = 0,
    duplicateReads = 0,
    dupReadWastedTokens = 0,
    commandRetries = 0,
    retryWastedTokens = 0,
    rageMessages = 0,
    surgicalReads = 0,
    grepCalls = 0,
    avgTurnCoins = 0,
    bankruptTurns = 0,
    totalTurnsScored = 0,
    totalTokens = 0,
    wastedTokens = 0,
    savingsPct = 0,
    diagnosis = 'CERTIFIED SCROOGE (0% Waste Detected)'
  } = data;

  const fmt = (n) => Number(n || 0).toLocaleString('en-US');
  const rows = [
    { label: readWasteLabel, qty: `${readWasteCount}x`, val: `${fmt(readWastedTokens)} tok`, color: readWastedTokens > 0 ? '#D9381E' : '#111110' },
    { label: 'Duplicate File Re-Reads', qty: `${duplicateReads}x`, val: `${fmt(dupReadWastedTokens)} tok`, color: dupReadWastedTokens > 0 ? '#D9381E' : '#111110' },
    { label: 'Consecutive Cmd Retries', qty: `${commandRetries}x`, val: `${fmt(retryWastedTokens)} tok`, color: retryWastedTokens > 0 ? '#D9381E' : '#111110' },
    { label: 'Fix-like prompts (signal only)', qty: `${rageMessages}x`, val: 'Excluded', color: '#5C5A54' },
    { label: 'Surgical Line-Range Reads', qty: `${surgicalReads}x`, val: '0 tok', color: '#126E48' },
    { label: 'Targeted Grep Searches', qty: `${grepCalls}x`, val: '0 tok', color: '#126E48' }
  ];

  const rowsXml = rows
    .map((r, i) => {
      const y = 216 + i * 32;
      return `
    <text x="56" y="${y}" fill="${r.color}" font-family="'JetBrains Mono', 'IBM Plex Mono', monospace" font-size="14" font-weight="500">${escapeXml(r.label)}</text>
    <text x="415" y="${y}" fill="${r.color}" font-family="'JetBrains Mono', 'IBM Plex Mono', monospace" font-size="14" font-weight="600" text-anchor="end">${escapeXml(r.qty)}</text>
    <text x="584" y="${y}" fill="${r.color}" font-family="'JetBrains Mono', 'IBM Plex Mono', monospace" font-size="14" font-weight="700" text-anchor="end">${escapeXml(r.val)}</text>`;
    })
    .join('\n');

  const barWidth = Math.max(0, Math.min(528, Math.round((Number(savingsPct) / 100) * 528)));

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="640" height="700" viewBox="0 0 640 700">
  <rect width="640" height="700" fill="#141413"/>
  <!-- Brutalist Offset Shadow -->
  <rect x="36" y="36" width="576" height="636" fill="#D9381E"/>
  <!-- Main Receipt Paper -->
  <rect x="28" y="28" width="576" height="636" fill="#FAF9F5" stroke="#111110" stroke-width="2.5"/>

  <!-- Header -->
  <text x="316" y="72" fill="#111110" font-family="'JetBrains Mono', 'IBM Plex Mono', monospace" font-size="20" font-weight="800" text-anchor="middle">STINGY TOKEN AUTOPSY</text>
  <text x="316" y="96" fill="#5C5A54" font-family="'JetBrains Mono', 'IBM Plex Mono', monospace" font-size="13" font-weight="500" text-anchor="middle">"Why burn 50,000 input tokens when 400 do trick?"</text>
  <text x="316" y="120" fill="#D9381E" font-family="'JetBrains Mono', 'IBM Plex Mono', monospace" font-size="12" font-weight="700" text-anchor="middle">LOGS SCANNED: ${escapeXml(`${filesCount} files (${fmt(totalSteps)} steps)`)}</text>

  <line x1="52" y1="138" x2="584" y2="138" stroke="#111110" stroke-width="1.5" stroke-dasharray="6,4"/>

  <!-- Column Headers -->
  <text x="56" y="166" fill="#5C5A54" font-family="'JetBrains Mono', 'IBM Plex Mono', monospace" font-size="12" font-weight="700">ITEM</text>
  <text x="415" y="166" fill="#5C5A54" font-family="'JetBrains Mono', 'IBM Plex Mono', monospace" font-size="12" font-weight="700" text-anchor="end">QTY</text>
  <text x="584" y="166" fill="#5C5A54" font-family="'JetBrains Mono', 'IBM Plex Mono', monospace" font-size="12" font-weight="700" text-anchor="end">EST. WASTE</text>

  <line x1="52" y1="180" x2="584" y2="180" stroke="#D4D0C5" stroke-width="1.5"/>

  ${rowsXml}

  <line x1="52" y1="412" x2="584" y2="412" stroke="#111110" stroke-width="1.5" stroke-dasharray="6,4"/>

  <!-- Coin Budget Section -->
  <text x="56" y="442" fill="#111110" font-family="'JetBrains Mono', 'IBM Plex Mono', monospace" font-size="14" font-weight="700">AVG COINS PER WORKER TURN:</text>
  <text x="584" y="442" fill="#111110" font-family="'JetBrains Mono', 'IBM Plex Mono', monospace" font-size="14" font-weight="800" text-anchor="end">${escapeXml(`${avgTurnCoins} / 10.0 Coins`)}</text>

  <text x="56" y="468" fill="#5C5A54" font-family="'JetBrains Mono', 'IBM Plex Mono', monospace" font-size="13" font-weight="600">BANKRUPT WORKER TURNS:</text>
  <text x="584" y="468" fill="#D9381E" font-family="'JetBrains Mono', 'IBM Plex Mono', monospace" font-size="13" font-weight="700" text-anchor="end">${escapeXml(`${bankruptTurns} / ${totalTurnsScored} turns`)}</text>

  <line x1="52" y1="488" x2="584" y2="488" stroke="#111110" stroke-width="1.5" stroke-dasharray="6,4"/>

  <!-- Token Totals -->
  <text x="56" y="518" fill="#111110" font-family="'JetBrains Mono', 'IBM Plex Mono', monospace" font-size="15" font-weight="700">EST. TOOL CONTEXT TOKENS:</text>
  <text x="584" y="518" fill="#111110" font-family="'JetBrains Mono', 'IBM Plex Mono', monospace" font-size="15" font-weight="800" text-anchor="end">${escapeXml(fmt(totalTokens))}</text>

  <text x="56" y="546" fill="#D9381E" font-family="'JetBrains Mono', 'IBM Plex Mono', monospace" font-size="15" font-weight="800">AVOIDABLE WASTED TOKENS:</text>
  <text x="584" y="546" fill="#D9381E" font-family="'JetBrains Mono', 'IBM Plex Mono', monospace" font-size="15" font-weight="800" text-anchor="end">${escapeXml(`${fmt(wastedTokens)} (${savingsPct}%)`)}</text>

  <!-- Waste Progress Bar -->
  <rect x="56" y="560" width="528" height="10" fill="#E6E2D8"/>
  <rect x="56" y="560" width="${barWidth}" height="10" fill="#D9381E"/>

  <!-- Diagnosis Badge -->
  <rect x="56" y="584" width="528" height="44" fill="#141413"/>
  <text x="320" y="611" fill="#FAF9F5" font-family="'JetBrains Mono', 'IBM Plex Mono', monospace" font-size="14" font-weight="700" text-anchor="middle">${escapeXml(diagnosis)}</text>

  <!-- Footer -->
  <text x="320" y="650" fill="#5C5A54" font-family="'JetBrains Mono', 'IBM Plex Mono', monospace" font-size="11" font-weight="600" text-anchor="middle">npx github:Kuro0No/stingy roast  •  github.com/Kuro0No/stingy</text>
</svg>
`;
}

// ============================================================================
// Pure-Node Zero-Dependency PNG Renderer (5x7 Bitmap Font + zlib IDAT Encoder)
// ============================================================================
const FONT_5X7 = {
  ' ': [0,0,0,0,0,0,0],
  '!': [4,4,4,4,0,0,4],
  '"': [10,10,10,0,0,0,0],
  '$': [4,15,20,14,5,30,4],
  '%': [25,26,2,4,8,19,19],
  '&': [12,18,20,8,21,18,13],
  '\'': [4,4,8,0,0,0,0],
  '(': [2,4,8,8,8,4,2],
  ')': [8,4,2,2,2,4,8],
  '*': [0,4,21,14,21,4,0],
  '+': [0,4,4,31,4,4,0],
  ',': [0,0,0,0,4,4,8],
  '-': [0,0,0,31,0,0,0],
  '.': [0,0,0,0,0,0,4],
  '/': [1,1,2,4,8,16,16],
  '0': [14,17,19,21,25,17,14],
  '1': [4,12,4,4,4,4,14],
  '2': [14,17,1,6,8,16,31],
  '3': [31,2,4,6,1,17,14],
  '4': [2,6,10,18,31,2,2],
  '5': [31,16,30,1,1,17,14],
  '6': [6,8,16,30,17,17,14],
  '7': [31,1,2,4,8,8,8],
  '8': [14,17,17,14,17,17,14],
  '9': [14,17,17,15,1,2,12],
  ':': [0,4,0,0,0,4,0],
  '>': [16,8,4,2,4,8,16],
  '?': [14,17,1,2,4,0,4],
  '@': [14,17,23,21,23,16,14],
  'A': [14,17,17,31,17,17,17],
  'B': [30,17,17,30,17,17,30],
  'C': [14,17,16,16,16,17,14],
  'D': [28,18,17,17,17,18,28],
  'E': [31,16,16,30,16,16,31],
  'F': [31,16,16,30,16,16,16],
  'G': [14,17,16,23,17,17,15],
  'H': [17,17,17,31,17,17,17],
  'I': [14,4,4,4,4,4,14],
  'J': [7,2,2,2,2,18,12],
  'K': [17,18,20,24,20,18,17],
  'L': [16,16,16,16,16,16,31],
  'M': [17,27,21,21,17,17,17],
  'N': [17,25,21,19,17,17,17],
  'O': [14,17,17,17,17,17,14],
  'P': [30,17,17,30,16,16,16],
  'Q': [14,17,17,17,21,18,13],
  'R': [30,17,17,30,20,18,17],
  'S': [15,16,16,14,1,1,30],
  'T': [31,4,4,4,4,4,4],
  'U': [17,17,17,17,17,17,14],
  'V': [17,17,17,17,17,10,4],
  'W': [17,17,17,21,21,27,17],
  'X': [17,17,10,4,10,17,17],
  'Y': [17,17,10,4,4,4,4],
  'Z': [31,1,2,4,8,16,31],
  '_': [0,0,0,0,0,0,31]
};

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makePngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcVal = crc32(Buffer.concat([typeBuf, data]));
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crcVal, 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/**
 * Render the Stingy Token Autopsy Receipt as a valid lossless RGBA PNG Buffer.
 */
export function renderReceiptPng(data) {
  const width = 560;
  const height = 560;
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);

  function setPixel(x, y, r, g, b) {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const idx = y * stride + 1 + x * 4;
    raw[idx] = r;
    raw[idx + 1] = g;
    raw[idx + 2] = b;
    raw[idx + 3] = 255;
  }

  function fillRect(x0, y0, w, h, r, g, b) {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        setPixel(x, y, r, g, b);
      }
    }
  }

  function drawText(text, x0, y0, r, g, b, scale = 2) {
    const str = String(text).toUpperCase();
    for (let i = 0; i < str.length; i++) {
      const glyph = FONT_5X7[str[i]] || FONT_5X7[' '];
      const cx = x0 + i * (6 * scale);
      for (let row = 0; row < 7; row++) {
        const bits = glyph[row];
        for (let col = 0; col < 5; col++) {
          if ((bits >> (4 - col)) & 1) {
            fillRect(cx + col * scale, y0 + row * scale, scale, scale, r, g, b);
          }
        }
      }
    }
  }

  // 1. Background (#141413)
  fillRect(0, 0, width, height, 20, 20, 19);
  // 2. Brutalist Shadow (#D9381E)
  fillRect(28, 28, width - 48, height - 48, 217, 56, 30);
  // 3. Paper Card (#FAF9F5)
  fillRect(20, 20, width - 48, height - 48, 250, 249, 245);

  const fmt = (n) => Number(n || 0).toLocaleString('en-US');

  // Header
  drawText('STINGY TOKEN AUTOPSY', 150, 42, 17, 17, 16, 2);
  drawText(`SCANNED: ${data.filesCount || 1} FILES (${fmt(data.totalSteps)} STEPS)`, 95, 70, 217, 56, 30, 2);
  fillRect(40, 96, width - 88, 2, 17, 17, 16);

  const items = [
    ['FULL/MEDIUM READS', `${data.readWasteCount || 0}X`, `${fmt(data.readWastedTokens)} TOK`, data.readWastedTokens > 0],
    ['DUPLICATE RE-READS', `${data.duplicateReads || 0}X`, `${fmt(data.dupReadWastedTokens)} TOK`, data.dupReadWastedTokens > 0],
    ['CMD RETRY LOOPS', `${data.commandRetries || 0}X`, `${fmt(data.retryWastedTokens)} TOK`, data.retryWastedTokens > 0],
    ['FIX-LIKE PROMPTS', `${data.rageMessages || 0}X`, 'EXCLUDED', false],
    ['SURGICAL READS', `${data.surgicalReads || 0}X`, '0 TOK', false],
    ['GREP SEARCHES', `${data.grepCalls || 0}X`, '0 TOK', false]
  ];

  items.forEach(([label, qty, waste, isBad], idx) => {
    const y = 114 + idx * 32;
    const [r, g, b] = isBad ? [217, 56, 30] : idx >= 4 ? [18, 110, 72] : [17, 17, 16];
    drawText(label, 42, y, r, g, b, 2);
    drawText(qty, 285, y, r, g, b, 2);
    drawText(waste.padStart(11, ' '), 375, y, r, g, b, 2);
  });

  fillRect(40, 314, width - 88, 2, 17, 17, 16);

  drawText('COINS / WORKER TURN:', 42, 332, 17, 17, 16, 2);
  drawText(`${data.avgTurnCoins || 0} / 10.0`.padStart(12, ' '), 365, 332, 17, 17, 16, 2);

  drawText('BANKRUPT WORKER TURNS:', 42, 362, 92, 90, 84, 2);
  drawText(`${data.bankruptTurns || 0} / ${data.totalTurnsScored || 0}`.padStart(12, ' '), 365, 362, 217, 56, 30, 2);

  fillRect(40, 390, width - 88, 2, 17, 17, 16);

  drawText('TOOL CONTEXT TOKENS:', 42, 408, 17, 17, 16, 2);
  drawText(fmt(data.totalTokens).padStart(12, ' '), 365, 408, 17, 17, 16, 2);

  drawText('AVOIDABLE WASTE:', 42, 438, 217, 56, 30, 2);
  drawText(`${fmt(data.wastedTokens)} (${data.savingsPct || 0}%)`.padStart(14, ' '), 340, 438, 217, 56, 30, 2);

  // Diagnosis Banner
  fillRect(40, 472, width - 88, 38, 20, 20, 19);
  // The banner fits 36 characters per line: split "NAME (detail)" over two lines instead of cutting it.
  const diag = String(data.diagnosis || 'CERTIFIED SCROOGE');
  const cut = diag.indexOf(' (');
  const diagLines = diag.length > 36 && cut > 0 ? [diag.slice(0, cut), diag.slice(cut + 1)] : [diag];
  diagLines.forEach((line, i) => drawText(line, 54, diagLines.length > 1 ? 476 + i * 18 : 484, 250, 249, 245, 2));

  // Encode PNG chunks
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8-bit depth
  ihdr[9] = 6; // RGBA color type
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const compressed = zlib.deflateSync(raw);
  return Buffer.concat([
    signature,
    makePngChunk('IHDR', ihdr),
    makePngChunk('IDAT', compressed),
    makePngChunk('IEND', Buffer.alloc(0))
  ]);
}
