// Live evaluation: scan examples/company-data with Jev and score against examples/labels.json.
//   node --env-file=.env scripts/evaluate.mjs [--no-cache] [--names-only] [--config file]
// Writes out/eval/ (catalog, INDEX.md, report.html); with --no-cache also results/evaluation.json.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.mjs';
import { scanFolder } from '../src/organize.mjs';
import { writeCatalog } from '../src/report/catalog.mjs';
import { indexMarkdown } from '../src/report/index-md.mjs';
import { reportHtml } from '../src/report/html.mjs';
import { usageLine, usage } from '../src/jev.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const cfgPath = args.includes('--config') ? args[args.indexOf('--config') + 1] : null;
const outDir = join(ROOT, 'out', flag('--names-only') ? 'eval-names-only' : 'eval');
mkdirSync(outDir, { recursive: true });

const labels = JSON.parse(readFileSync(join(ROOT, 'examples', 'labels.json'), 'utf8')).files;
const { config } = loadConfig(cfgPath);
const t0 = Date.now();
const { records, meta } = await scanFolder(join(ROOT, 'examples', 'company-data'), {
  config, outDir, noCache: flag('--no-cache'), namesOnly: flag('--names-only'), log: (m) => console.error(m),
});
const seconds = (Date.now() - t0) / 1000;
writeCatalog(outDir, records, meta);
writeFileSync(join(outDir, 'INDEX.md'), indexMarkdown(records, meta, config));
writeFileSync(join(outDir, 'report.html'), reportHtml(records, meta, config));

const norm = (s) => String(s ?? '').toLowerCase().replace(/\b(ltd|limited|llp|llc|inc|gmbh|plc|bv|group)\b/g, '').replace(/[^a-z0-9]/g, '');
const sameOrg = (a, b) => (a == null && b == null) || (a != null && b != null && (norm(a) === norm(b) || (norm(a).length > 4 && norm(b).length > 4 && (norm(a).includes(norm(b)) || norm(b).includes(norm(a))))));
const LEVELS = ['public', 'internal', 'confidential', 'restricted'];

const rows = [];
const missing = Object.keys(labels).filter((p) => !records.some((r) => r.path === p));
for (const r of records) {
  const l = labels[r.path];
  if (!l) { console.error(`No label for ${r.path}`); continue; }
  rows.push({ r, l });
}
const content = rows.filter(({ l }) => !l.noise && !l.duplicate_of);
const pct = (n, d) => (d ? Math.round((1000 * n) / d) / 10 : null);
const score = (list, ok) => ({ correct: list.filter(ok).length, of: list.length, pct: pct(list.filter(ok).length, list.length) });

const dept = (x) => x.r.department === x.l.department;
const type = (x) => x.r.type === x.l.type;
const sens = (x) => x.r.sensitivity === x.l.sensitivity;
const sensNear = (x) => Math.abs(LEVELS.indexOf(x.r.sensitivity) - LEVELS.indexOf(x.l.sensitivity)) <= 1;
const date = (x) => (x.r.date ?? null) === (x.l.date ?? null);
const party = (x) => sameOrg(x.r.counterparty, x.l.counterparty);
const confident = content.filter((x) => !x.r.review);

const metrics = {
  files: records.length,
  department: score(content, dept),
  department_when_not_in_review: score(confident, dept),
  type: score(content, type),
  type_when_not_in_review: score(confident, type),
  sensitivity_exact: score(content, sens),
  sensitivity_within_one_level: score(content, sensNear),
  restricted_recall: score(content.filter((x) => x.l.sensitivity === 'restricted'), (x) => x.r.sensitivity === 'restricted'),
  restricted_precision: score(content.filter((x) => x.r.sensitivity === 'restricted'), (x) => x.l.sensitivity === 'restricted'),
  date: score(content, date),
  date_when_labelled: score(content.filter((x) => x.l.date), date),
  counterparty: score(content, party),
  counterparty_when_labelled: score(content.filter((x) => x.l.counterparty), party),
  noise_found: score(rows.filter(({ l }) => l.noise), (x) => x.r.noise),
  noise_false_alarms: rows.filter(({ l, r }) => !l.noise && r.noise).map(({ r }) => r.path),
  duplicates_found: score(rows.filter(({ l }) => l.duplicate_of), (x) => !!x.r.duplicate_of),
  sent_to_review: score(content, (x) => x.r.review),
};
const misses = content.flatMap((x) => [
  !dept(x) && `department  ${x.r.path}: ${x.r.department} (${x.r.department_confidence}) expected ${x.l.department}`,
  !type(x) && `type        ${x.r.path}: ${x.r.type} (${x.r.type_confidence}) expected ${x.l.type}`,
  !sens(x) && `sensitivity ${x.r.path}: ${x.r.sensitivity} expected ${x.l.sensitivity}`,
  !date(x) && `date        ${x.r.path}: ${x.r.date} expected ${x.l.date}`,
  !party(x) && `counterparty ${x.r.path}: ${x.r.counterparty} expected ${x.l.counterparty}`,
].filter(Boolean));

console.log('\nMetric                              Correct   Share');
for (const [k, v] of Object.entries(metrics)) {
  if (v && typeof v === 'object' && 'pct' in v) console.log(`${k.padEnd(36)}${`${v.correct}/${v.of}`.padEnd(10)}${v.pct ?? '-'}%`);
}
if (metrics.noise_false_alarms.length) console.log(`noise false alarms: ${metrics.noise_false_alarms.join(', ')}`);
if (missing.length) console.log(`Labelled but not found: ${missing.join(', ')}`);
console.log(`\nMisses (${misses.length}):\n  ${misses.join('\n  ')}`);
console.log(`\n${usageLine()}, ${seconds.toFixed(1)} s`);

// Only a run that asked Jev for every file is a measurement worth saving.
if (!flag('--no-cache')) {
  console.log('Not saved to results/ (answers came from the cache). Run with --no-cache to save a measurement.');
  process.exit(0);
}
mkdirSync(join(ROOT, 'results'), { recursive: true });
const name = flag('--names-only') ? 'evaluation-names-only.json' : 'evaluation.json';
writeFileSync(join(ROOT, 'results', name), JSON.stringify({
  ran_at: new Date().toISOString(),
  answered_by: meta.models,
  company_detected: meta.company,
  names_only: flag('--names-only'),
  // this_run: what this run spent (0 when every answer came from the cache).
  // classification: what classifying all files cost, cached answers included.
  usage: {
    this_run: { calls: usage.calls, input_tokens: usage.inputTokens, cost_usd: Number(usage.cost.toFixed(6)), seconds },
    classification: { files_sent: meta.classified, cost_usd: meta.total_cost_usd, cost_per_1000_files_usd: meta.classified ? Number(((meta.total_cost_usd / meta.classified) * 1000).toFixed(4)) : null },
  },
  metrics,
  misses,
}, null, 2) + '\n');
console.log(`Saved results/${name}`);
