// Token buckets are uncached input, cached input, and output.
const workloads = {
  // benchmarks/codex-comparison.md (subtract cached tokens from reported input)
  codex: {
    source: 'https://github.com/Kuro0No/stingy/blob/main/benchmarks/codex-comparison.md',
    rows: [
      ['No skill', 45619, 144128, 1481],
      ['Caveman', 30096, 168448, 1350],
      ['Ponytail', 52401, 164608, 1523],
      ['Caveman + Ponytail', 65428, 200448, 1710],
      ['Stingy (Scrooge)', 44652, 137728, 1536]
    ]
  },
  // npm run benchmark:plugins
  bugHunt: {
    source: '#live-benchmark',
    rows: [
      ['No skill', 142542, 200806, 2186],
      ['Caveman', 143267, 311150, 2450],
      ['Ponytail', 141516, 203222, 3167],
      ['Caveman + Ponytail', 124392, 291817, 1732],
      ['Stingy (Scrooge)', 19449, 35159, 1063]
    ]
  }
};
// benchmarks/fixtures/live-whiteboard-*.jsonl
const featureRows = [
  ['No skill', 98333, 250256, 4516],
  ['Stingy Build', 19510, 31963, 2024]
];

// API Standard text rates in USD per million tokens.
const presets = {
  sol: [2, 0.1, 10],
  astra: [10, 1, 50],
  terra: [1, 0.05, 5],
  luna: [0.1, 0.01, 0.5]
};

const runs = document.getElementById('cost-runs');
const runCount = document.getElementById('cost-run-count');
const model = document.getElementById('cost-model');
const rates = ['rate-input', 'rate-cached', 'rate-output'].map((id) => document.getElementById(id));
const workload = document.getElementById('cost-workload');
const source = document.getElementById('cost-bug-source');
const status = document.getElementById('cost-status');
const bugRows = document.getElementById('cost-bug-rows');
const whiteboardRows = document.getElementById('cost-feature-rows');
const stingySavings = document.getElementById('cost-stingy-savings');
const buildSavings = document.getElementById('cost-build-savings');
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 });
const unitsPerDollar = 10000;

function showSavings(element, savings) {
  element.classList.toggle('cost-saves', savings > 0);
  element.classList.toggle('cost-extra', savings < 0);
  if (savings === null) element.textContent = '—';
  else if (savings > 0) element.textContent = `Save ${usd.format(savings / unitsPerDollar)}`;
  else if (savings < 0) element.textContent = `${usd.format(-savings / unitsPerDollar)} more`;
  else element.textContent = 'No change';
}

function renderCosts(tableBody, rows, prices, repeats, highlight) {
  const costs = rows.map(([, input, cached, output]) => {
    if (prices === null) return null;
    const [inputRate, cacheRate, outputRate] = prices;
    const monthlyUsd = repeats * (input * inputRate + cached * cacheRate + output * outputRate) / 1000000;
    return Math.round(monthlyUsd * unitsPerDollar);
  });
  const control = costs[0];
  const featuredIndex = rows.length - 1;
  const elements = rows.map(([label], index) => {
    const tr = document.createElement('tr');
    const heading = document.createElement('th');
    heading.scope = 'row';
    heading.textContent = label;
    tr.append(heading);

    const cost = costs[index];
    tr.insertCell().textContent = cost === null ? '—' : usd.format(cost / unitsPerDollar);
    const difference = tr.insertCell();
    if (index === 0) {
      difference.textContent = '—';
    } else {
      showSavings(difference, cost === null ? null : control - cost);
    }
    if (index === featuredIndex) {
      tr.className = 'cost-featured';
      showSavings(highlight, cost === null ? null : control - cost);
    }
    return tr;
  });
  tableBody.replaceChildren(...elements);
}

function updateCosts() {
  const repeats = runs.valueAsNumber;
  const prices = rates.every((field) => field.validity.valid) ? rates.map((field) => field.valueAsNumber) : null;
  runCount.value = String(repeats);
  status.hidden = prices !== null;
  status.textContent = prices === null ? 'Enter a valid rate in all three price fields.' : '';
  const bugFixes = workloads[workload.value];
  source.href = bugFixes.source;
  renderCosts(bugRows, bugFixes.rows, prices, repeats, stingySavings);
  renderCosts(whiteboardRows, featureRows, prices, repeats, buildSavings);
}

model.addEventListener('change', () => {
  const preset = presets[model.value];
  if (preset) rates.forEach((field, index) => { field.value = preset[index]; });
  updateCosts();
});
for (const field of rates) {
  field.addEventListener('input', () => {
    model.value = 'custom';
    updateCosts();
  });
}
runs.addEventListener('input', updateCosts);
workload.addEventListener('change', updateCosts);
updateCosts();
