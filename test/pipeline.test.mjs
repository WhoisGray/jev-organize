import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installFakeJev, uninstallFakeJev, requests } from './fake-jev.mjs';
import { loadConfig } from '../src/config.mjs';
import { scanFolder, targetFor } from '../src/organize.mjs';
import { writeCatalog, readCatalog, filterRecords } from '../src/report/catalog.mjs';
import { indexMarkdown } from '../src/report/index-md.mjs';
import { reportHtml } from '../src/report/html.mjs';
import { applyPlan } from '../src/apply.mjs';
import { makeXlsx } from '../scripts/office-writer.mjs';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'jev-organize.mjs');
const base = mkdtempSync(join(tmpdir(), 'jev-organize-pipe-'));
const input = join(base, 'dump');
const outDir = join(base, 'dump-organized');
const put = (p, data) => { const f = join(input, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, data); };
const hashTree = (dir) => {
  const out = {};
  (function walk(d) { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else out[p] = createHash('sha256').update(readFileSync(p)).digest('hex'); } })(dir);
  return out;
};

const INVOICE = 'INVOICE INV-2026-0418\nNorthfell Textiles Ltd, 4 Mill Lane, Leeds\nBill to: Kestrel Bay Supplies Ltd\nInvoice date: 18 April 2026\nDue date: 18 May 2026\nFinance: invoices payment amount due GBP 1,240.00\nPay to IBAN GB82 WEST 1234 5698 7654 32';

before(() => {
  installFakeJev();
  put('old stuff/scan_0041.txt', INVOICE);
  put('Downloads/copy of invoice.txt', INVOICE); // byte-identical duplicate
  put('IT/server notes.txt', 'Server setup for the shop. db_password = Kx7!pQ2rT9vL\nKestrel Bay Supplies Ltd IT security access backups');
  put('Desktop/test.txt', 'asdf asdf 123');
  put('HR/staff.xlsx', makeXlsx([['Name', 'Email', 'Salary'], ['Ann Lee', 'ann@kestrelbay.example', '52000'], ['Bo Kim', 'bo@kestrelbay.example', '61000']]));
  put('website/about.html', '<title>About</title><p>Kestrel Bay Supplies Ltd sells outdoor gear. Marketing campaigns brand website social newsletters press.</p>');
  put('Board/minutes.txt', 'Board meeting minutes, Kestrel Bay Supplies Ltd, 12 March 2026. Strategy, investors, OKRs, company goals discussed by the board.');
  put('photos/team.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]));
});
after(() => uninstallFakeJev());

let run;
test('scan classifies, dedupes, redacts and routes', async () => {
  const before = hashTree(input);
  const { config } = loadConfig(null);
  run = await scanFolder(input, { config, outDir, log: () => {} });
  const { records, meta } = run;
  assert.equal(records.length, 8);
  assert.equal(meta.company, 'Kestrel Bay Supplies Ltd', 'the most-named organisation is detected as our company');
  const by = Object.fromEntries(records.map((r) => [r.path, r]));

  // One Jev call per unique file: the duplicate is not sent.
  assert.equal(requests.length, 7);
  // Of two copies, the one called "copy of ..." in Downloads/ is the duplicate.
  const dup = by['Downloads/copy of invoice.txt'];
  assert.equal(dup.duplicate_of, 'old stuff/scan_0041.txt');
  assert.match(dup.target, /(^|\/)_Duplicates\//);

  // Nothing sensitive leaves the machine.
  const sent = JSON.stringify(requests);
  assert.doesNotMatch(sent, /Kx7!pQ2rT9vL|WEST 1234|ann@kestrelbay/);

  const inv = by['old stuff/scan_0041.txt'];
  assert.equal(inv.department, 'finance');
  assert.equal(inv.counterparty, 'Northfell Textiles Ltd', 'our own company is never a candidate');
  assert.ok(['2026-04-18', '2026-05-18'].includes(inv.date));
  assert.equal(inv.sensitivity === 'public' || inv.sensitivity === 'internal', false, 'an IBAN lifts the floor to confidential');

  const secret = by['IT/server notes.txt'];
  assert.equal(secret.sensitivity, 'restricted');
  assert.match(secret.target, /^_Restricted\//);
  assert.ok(secret.sensitivity_reasons.join(' ').includes('secrets'));

  assert.equal(by['Desktop/test.txt'].noise, true);
  assert.match(by['Desktop/test.txt'].target, /^_Noise\//);
  assert.equal(by['photos/team.jpg'].review, true);
  assert.ok(by['photos/team.jpg'].review_reasons.includes('no readable text'));
  assert.ok(by['HR/staff.xlsx'].pii_columns?.length >= 0);

  // Targets are unique and the input folder is untouched.
  assert.equal(new Set(records.map((r) => r.target.toLowerCase())).size, records.length);
  assert.deepEqual(hashTree(input), before);
});

test('the cache means a second scan asks Jev nothing', async () => {
  requests.length = 0;
  const { config } = loadConfig(null);
  await scanFolder(input, { config, outDir, log: () => {} });
  assert.equal(requests.length, 0);
});

test('reports and apply', () => {
  const { config } = loadConfig(null);
  writeCatalog(outDir, run.records, run.meta);
  const md = indexMarkdown(run.records, run.meta, config);
  assert.match(md, /## For AI agents/);
  assert.match(md, /## Restricted \(\d+\)/);
  const html = reportHtml(run.records, run.meta, config);
  assert.doesNotMatch(html, /<\/script>\s*<\/script>/);
  assert.ok(html.includes('"records"'));

  const before = hashTree(input);
  const first = applyPlan(outDir, config, {});
  assert.equal(first.stats.copied, 8);
  const second = applyPlan(outDir, config, {});
  assert.equal(second.stats.skipped, 8, 'running apply again copies nothing');
  assert.deepEqual(hashTree(input), before, 'originals untouched');
  for (const f of ['INDEX.md', 'AGENTS.md', 'CLAUDE.md', 'catalog.jsonl']) assert.ok(existsSync(join(first.root, f)), f);
  const { records } = readCatalog(outDir);
  for (const r of records) assert.ok(existsSync(join(first.root, r.target)), r.target);
  assert.equal(filterRecords(records, { department: 'finance' }).length, 1, 'duplicates are hidden by default');
  assert.equal(filterRecords(records, { department: 'finance', includeDuplicates: true }).length, 2);
});

test('apply refuses to write inside the input folder', () => {
  const { config } = loadConfig(null);
  assert.throws(() => applyPlan(outDir, config, { dest: join(input, 'organized') }), /must not be inside the input/);
});

test('layout tokens and restricted folder', () => {
  const { config } = loadConfig(null);
  const rec = { name: 'a:b.pdf', department: 'finance', type: 'invoice', sensitivity: 'confidential', date: '2026-04-18', counterparty: 'Northfell/Textiles' };
  assert.equal(targetFor(rec, config), 'Finance/Invoices/2026/a-b.pdf');
  assert.equal(targetFor({ ...rec, date: null }, { ...config, layout: '{department}/{counterparty}/{quarter}/{name}' }), 'Finance/Northfell-Textiles/Undated/a-b.pdf');
  assert.equal(targetFor({ ...rec, sensitivity: 'restricted' }, config), '_Restricted/Finance/Invoices/2026/a-b.pdf');
});

test('config validation', () => {
  const f = join(base, 'bad.json');
  writeFileSync(f, JSON.stringify({ layout: '{department}/{type}' }));
  assert.throws(() => loadConfig(f), /layout must contain/);
  writeFileSync(f, JSON.stringify({ company: { name: 'Acme' }, thresholds: { department: 0.9 } }));
  const { config } = loadConfig(f);
  assert.equal(config.company.name, 'Acme');
  assert.equal(config.thresholds.type, 0.5, 'thresholds merge with the defaults');
});

test('CLI: help, estimate without a key, query', () => {
  const env = { ...process.env, OPENROUTER_API_KEY: '', HOME: base };
  assert.match(execFileSync('node', [BIN, '--help'], { env }).toString(), /jev-organize scan <input-folder>/);
  const est = JSON.parse(execFileSync('node', [BIN, 'scan', input, '--out', join(base, 'est'), '--estimate', '--json'], { env, cwd: base }).toString());
  assert.equal(est.files, 7);
  const q = execFileSync('node', [BIN, 'query', outDir, '--sensitivity', 'restricted', '--paths'], { env, cwd: base, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  assert.ok(q.split('\n').includes('IT/server notes.txt'), q);
});
