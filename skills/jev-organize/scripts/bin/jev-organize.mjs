#!/usr/bin/env node
// jev-organize: classify and organize a folder of company files with TypeSafe's Jev.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG_FILE, DEFAULT_CONFIG, loadConfig, labelOf } from '../src/config.mjs';
import { scanFolder } from '../src/organize.mjs';
import { applyPlan } from '../src/apply.mjs';
import { writeCatalog, readCatalog, filterRecords } from '../src/report/catalog.mjs';
import { indexMarkdown } from '../src/report/index-md.mjs';
import { reportHtml } from '../src/report/html.mjs';
import { ask, choice, usageLine, DEFAULT_MODEL } from '../src/jev.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(HERE, '..');
const VERSION = (() => { try { return JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf8')).version; } catch { return 'dev'; } })();

const HELP = `jev-organize ${VERSION}: classify and organize a folder of company files with Jev.

Usage
  jev-organize scan <input-folder> [options]   Classify every file; write catalog, INDEX.md and report.html
  jev-organize apply <output-folder>           Copy the files into <output-folder>/organized
  jev-organize query <output-folder> [filters] Find files in the catalog
  jev-organize init                            Write ${CONFIG_FILE} (taxonomy, folders, rules) to edit
  jev-organize install [--claude] [--codex]    Install the Claude skill and/or the Codex agent + skill
  jev-organize doctor                          Check Node, the API key, pdftotext and one live Jev call

Scan options
  --out <dir>          Output folder (default: <input>-organized next to the input)
  --config <file>      Config file (default: ${CONFIG_FILE} in the output, input or current folder)
  --limit <n>          Only the first n files: try a sample first
  --estimate           Count files and estimate the cost, classify nothing
  --max-cost <usd>     Stop before starting if the estimate is higher (default 5)
  --names-only         Send only file paths, never file contents (less accurate)
  --no-redact          Don't mask emails, phone numbers, IBANs, card numbers and secrets before sending
  --no-cache           Ask Jev again even for files classified before
  --concurrency <n>    Parallel Jev calls (default 8)
  --apply              Run apply right after the scan
  --json               Print a JSON summary (for scripts and agents)

Apply options
  --mode copy|link|symlink   copy (default), hard links (no extra disk space), or symlinks
  --dest <dir>               Organized folder (default: <output-folder>/organized)

Query filters
  --department <id> --type <id> --sensitivity <id> --tag <id> --year <yyyy>
  --counterparty <text> --text <text> --review --pii --all (include duplicates and noise)
  --json (full records) --paths (only original paths) --limit <n>

The key: set OPENROUTER_API_KEY in your shell or in a .env file (https://openrouter.ai/settings/keys).
Originals are never moved, renamed or deleted.`;

// ---------- args ----------

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const [k, inline] = a.slice(2).split(/=(.*)/s);
    const key = k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (key.startsWith('no') && key.length > 2 && inline === undefined) { out[key[2].toLowerCase() + key.slice(3)] = false; continue; }
    const next = argv[i + 1];
    const valueFlags = ['out', 'config', 'limit', 'maxCost', 'concurrency', 'mode', 'dest', 'department', 'type', 'sensitivity', 'tag', 'year', 'counterparty', 'text'];
    if (inline !== undefined) out[key] = inline;
    else if (valueFlags.includes(key) && next !== undefined && !next.startsWith('--')) { out[key] = next; i++; }
    else out[key] = true;
  }
  return out;
}

function loadEnv() {
  if (process.env.OPENROUTER_API_KEY) return;
  for (const f of [resolve('.env'), join(PKG_ROOT, '.env'), join(homedir(), '.config', 'jev-organize', '.env')]) {
    if (existsSync(f)) { try { process.loadEnvFile(f); } catch { /* ignore a malformed file */ } if (process.env.OPENROUTER_API_KEY) return; }
  }
}

function findConfig(args, dirs) {
  if (args.config) return args.config;
  return dirs.map((d) => d && join(d, CONFIG_FILE)).find((f) => f && existsSync(f)) ?? null;
}

const say = (...a) => console.error(...a); // progress and messages go to stderr; results to stdout

// ---------- commands ----------

async function cmdScan(args) {
  const input = args._[1];
  if (!input) throw new Error('Usage: jev-organize scan <input-folder>');
  const root = resolve(input);
  if (!existsSync(root)) throw new Error(`Folder not found: ${root}`);
  const outDir = resolve(args.out ?? join(dirname(root), `${basename(root)}-organized`));
  const cfgPath = findConfig(args, [outDir, root, process.cwd()]);
  const { config } = loadConfig(cfgPath);
  if (args.redact === false) config.redact = false;
  config.ignore = [...config.ignore, CONFIG_FILE];
  mkdirSync(outDir, { recursive: true });
  const t0 = Date.now();
  if (cfgPath) say(`Config: ${cfgPath}`);
  const tty = process.stderr.isTTY;
  const result = await scanFolder(root, {
    config, outDir,
    limit: args.limit ? Number(args.limit) : undefined,
    concurrency: args.concurrency ? Number(args.concurrency) : 8,
    namesOnly: !!args.namesOnly,
    noCache: args.cache === false,
    maxCost: args.maxCost != null ? Number(args.maxCost) : 5,
    estimateOnly: !!args.estimate,
    log: say,
    progress: (done, total) => {
      if (tty) process.stderr.write(`\r  classified ${done}/${total}`);
      else if (done % 50 === 0 || done === total) say(`  classified ${done}/${total}`);
    },
  });
  if (tty && !args.estimate) process.stderr.write('\n');
  if (args.estimate) { if (args.json) console.log(JSON.stringify(result.estimate, null, 2)); return; }
  const { records, meta } = result;
  writeCatalog(outDir, records, meta);
  writeFileSync(join(outDir, 'INDEX.md'), indexMarkdown(records, meta, config));
  writeFileSync(join(outDir, 'report.html'), reportHtml(records, meta, config));
  const live = records.filter((r) => !r.duplicate_of && !r.noise);
  const summary = {
    output: outDir,
    files: records.length,
    filed: live.filter((r) => !r.review).length,
    needs_review: live.filter((r) => r.review).length,
    restricted: live.filter((r) => r.sensitivity === 'restricted').length,
    duplicates: records.filter((r) => r.duplicate_of).length,
    noise: records.filter((r) => r.noise).length,
    failed: meta.failed,
    by_department: Object.fromEntries(Object.entries(count(live, (r) => r.department ?? 'unclassified')).sort((a, b) => b[1] - a[1])),
    cost_usd: meta.usage.cost_usd,
    seconds: Math.round((Date.now() - t0) / 100) / 10,
    company: meta.company,
  };
  if (args.json) console.log(JSON.stringify(summary, null, 2));
  else {
    console.log(`\nClassified ${summary.files} files in ${summary.seconds} s: ${summary.filed} filed, ${summary.needs_review} to review, ${summary.restricted} restricted, ${summary.duplicates} duplicates, ${summary.noise} noise${summary.failed ? `, ${summary.failed} failed` : ''}.`);
    console.log(Object.entries(summary.by_department).map(([d, n]) => `  ${labelOf(config.departments, d).padEnd(24)} ${n}`).join('\n'));
    console.log(`\nWrote ${join(outDir, 'INDEX.md')}\n      ${join(outDir, 'report.html')}\n      ${join(outDir, 'catalog.jsonl')} and catalog.csv`);
    console.log(usageLine());
  }
  if (args.apply) await cmdApply({ ...args, _: ['apply', outDir] }, config);
  else if (!args.json) console.log(`\nNext: jev-organize apply "${outDir}"   (copies the files into ${join(outDir, 'organized')}; originals stay untouched)`);
}

async function cmdApply(args, config) {
  const outDir = resolve(args._[1] ?? '');
  if (!args._[1] || !existsSync(join(outDir, 'catalog.jsonl'))) throw new Error('Usage: jev-organize apply <output-folder> (the folder a scan wrote catalog.jsonl to)');
  if (!config) {
    const { meta } = readCatalog(outDir);
    config = loadConfig(findConfig(args, [outDir, meta.input, process.cwd()])).config;
  }
  const { root, stats } = applyPlan(outDir, config, { mode: args.mode ?? 'copy', dest: args.dest });
  const msg = `Organized folder: ${root}\n  ${stats.copied} copied, ${stats.linked} linked, ${stats.skipped} already there${stats.renamed ? `, ${stats.renamed} renamed to avoid overwriting` : ''}${stats.missing ? `, ${stats.missing} originals missing` : ''}.\n  It has INDEX.md, AGENTS.md and catalog.jsonl, so Claude Code or Codex opened there knows the map.`;
  if (args.json) console.log(JSON.stringify({ organized: root, ...stats }, null, 2)); else console.log(msg);
}

function cmdQuery(args) {
  const outDir = resolve(args._[1] ?? '');
  if (!args._[1] || !existsSync(join(outDir, 'catalog.jsonl'))) throw new Error('Usage: jev-organize query <output-folder> [filters]');
  const { records } = readCatalog(outDir);
  let hits = filterRecords(records, { ...args, includeDuplicates: !!args.all, includeNoise: !!args.all });
  if (args.limit) hits = hits.slice(0, Number(args.limit));
  if (args.json) { console.log(JSON.stringify(hits, null, 2)); return; }
  if (args.paths) { console.log(hits.map((r) => r.path).join('\n')); return; }
  for (const r of hits) console.log(`${(r.date ?? '').padEnd(10)}  ${String(r.department ?? '-').padEnd(19)} ${String(r.type ?? '-').padEnd(17)} ${String(r.sensitivity ?? '-').padEnd(12)} ${r.path}${r.counterparty ? `  [${r.counterparty}]` : ''}`);
  console.error(`${hits.length} of ${records.length} files`);
}

function cmdInit(args) {
  const file = resolve(args.out ?? CONFIG_FILE);
  if (existsSync(file) && !args.force) throw new Error(`${file} already exists. Use --force to overwrite it.`);
  const cfg = {
    _readme: 'jev-organize config. Edit freely: add or rename departments, types, tags and rules; set company.name. Ids (the keys) end up in catalog.jsonl, labels become folder names. Changing questions (taxonomy, rules, tags) re-asks Jev on the next scan; changing thresholds, layout or folders does not.',
    ...structuredClone(DEFAULT_CONFIG),
  };
  writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
  console.log(`Wrote ${file}. Set company.name, then edit the taxonomy to match how your company works.`);
}

function cmdInstall(args) {
  const both = !args.claude && !args.codex;
  const project = !!args.project;
  const base = project ? process.cwd() : homedir();
  const skillSrc = join(PKG_ROOT, 'skills', 'jev-organize');
  const done = [];
  const copyDir = (from, to) => {
    if (existsSync(to) && !args.force) { done.push(`${to} already exists (use --force to replace it)`); return; }
    mkdirSync(dirname(to), { recursive: true });
    cpSync(from, to, { recursive: true, force: true });
    done.push(to);
  };
  if (!existsSync(join(skillSrc, 'scripts', 'bin', 'jev-organize.mjs'))) throw new Error('The skill bundle is missing. Run `npm run build` in the jev-organize folder first.');
  if (both || args.claude) copyDir(skillSrc, join(base, '.claude', 'skills', 'jev-organize'));
  if (both || args.codex) {
    copyDir(skillSrc, join(base, '.agents', 'skills', 'jev-organize'));
    const agentDir = join(base, '.codex', 'agents');
    const agentFile = join(agentDir, 'jev_organizer.toml');
    if (existsSync(agentFile) && !args.force) done.push(`${agentFile} already exists (use --force to replace it)`);
    else { mkdirSync(agentDir, { recursive: true }); cpSync(join(PKG_ROOT, '.codex', 'agents', 'jev_organizer.toml'), agentFile); done.push(agentFile); }
  }
  console.log(`Installed:\n  ${done.join('\n  ')}\n\nThe skill needs OPENROUTER_API_KEY in the environment (or a .env file where you run it).`);
}

async function cmdDoctor() {
  const checks = [];
  const [major, minor] = process.versions.node.split('.').map(Number);
  checks.push([major > 22 || (major === 22 && minor >= 9), `Node ${process.versions.node} (needs 22.9 or newer)`]);
  let pdf = false;
  try { (await import('node:child_process')).execFileSync('pdftotext', ['-v'], { stdio: 'ignore' }); pdf = true; } catch { /* optional */ }
  checks.push([pdf ? true : null, pdf ? 'pdftotext found (best PDF text)' : 'pdftotext not found: simple PDFs still work; install poppler for the rest']);
  const key = !!process.env.OPENROUTER_API_KEY;
  checks.push([key, key ? 'OPENROUTER_API_KEY is set' : 'OPENROUTER_API_KEY is not set (https://openrouter.ai/settings/keys)']);
  if (key) {
    try {
      const t0 = Date.now();
      const a = await ask({ file: { path: 'Finance/INV-2026-0418.pdf' }, content: 'Invoice INV-2026-0418. Amount due: GBP 1,240.00. Payment within 30 days.' },
        { department: choice('Which department owns this file?', { finance: 'Finance: invoices, payments', marketing: 'Marketing: campaigns' }) });
      checks.push([a.department.choice === 'finance', `Live Jev call: "${a.department.choice}" in ${Date.now() - t0} ms (${process.env.JEV_MODEL || DEFAULT_MODEL})`]);
    } catch (err) { checks.push([false, `Live Jev call failed: ${err.message}`]); }
  }
  for (const [ok, msg] of checks) console.log(`${ok === true ? 'ok  ' : ok === null ? 'note' : 'FAIL'}  ${msg}`);
  if (checks.some(([ok]) => ok === false)) process.exitCode = 1;
}

const count = (rs, key) => rs.reduce((m, r) => { const k = key(r); m[k] = (m[k] ?? 0) + 1; return m; }, {});

// ---------- main ----------

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];
loadEnv();
try {
  if (args.version) console.log(VERSION);
  else if (!cmd || args.help || cmd === 'help') console.log(HELP);
  else if (cmd === 'scan') await cmdScan(args);
  else if (cmd === 'apply') await cmdApply(args);
  else if (cmd === 'query') cmdQuery(args);
  else if (cmd === 'init') cmdInit(args);
  else if (cmd === 'install') cmdInstall(args);
  else if (cmd === 'doctor') await cmdDoctor();
  else throw new Error(`Unknown command "${cmd}". Run jev-organize --help.`);
} catch (err) {
  console.error(`\njev-organize: ${err.message}`);
  process.exitCode = 1;
}
