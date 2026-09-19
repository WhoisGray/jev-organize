// The scan pipeline: walk -> hash -> extract -> dedupe -> (detect company) -> estimate ->
// classify with Jev (cached) -> route -> records. Reads the input folder, never writes to it.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, lstatSync, writeFileSync, renameSync } from 'node:fs';
import { basename, extname, join, relative, resolve, sep } from 'node:path';
import { extract } from './extract/index.mjs';
import { prepare, buildRequest, askFor, interpret } from './classify.mjs';
import { orgCandidates, orgKey, withoutSuffix } from './candidates.mjs';
import { questionHash, labelOf } from './config.mjs';
import { mapLimit, usage, PRICE_PER_M_INPUT, DEFAULT_MODEL } from './jev.mjs';

// ---------- walking ----------

const globToRe = (g) => new RegExp(`^${g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i');

export function walk(root, { ignore = [], skipDirs = [] } = {}) {
  const res = ignore.map(globToRe);
  const skip = new Set(skipDirs.map((d) => resolve(d)));
  const files = [], skipped = [];
  (function visit(dir) {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch (err) { skipped.push({ path: relative(root, dir), reason: err.code ?? 'unreadable' }); return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const abs = join(dir, e.name);
      if (res.some((re) => re.test(e.name))) continue;
      if (e.isSymbolicLink()) { skipped.push({ path: relative(root, abs), reason: 'symlink' }); continue; }
      if (e.isDirectory()) { if (!skip.has(abs)) visit(abs); continue; }
      if (e.isFile()) files.push({ abs, path: relative(root, abs).split(sep).join('/'), size: lstatSync(abs).size });
    }
  })(root);
  return { files, skipped };
}

// Lower is more likely the original: penalise "copy", "(2)" and scratch folders.
const copyScore = (path) => (/\bcopy\b|\(\d+\)|\bkopie\b|\bduplicate\b/i.test(path.split('/').pop()) ? 3 : 0)
  + (/(^|\/)(downloads?|desktop|tmp|temp|old[^/]*|misc|archive|backup|unsorted)(\/|$)/i.test(path) ? 2 : 0);

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

// ---------- cache ----------

export function openCache(outDir) {
  const dir = join(outDir, '.jev-organize');
  const file = join(dir, 'cache.json');
  let data = { version: 1, entries: {} };
  if (existsSync(file)) { try { data = JSON.parse(readFileSync(file, 'utf8')); } catch { /* start over */ } }
  return {
    get: (k) => data.entries[k],
    set: (k, v) => { data.entries[k] = v; },
    save: () => {
      mkdirSync(dir, { recursive: true });
      writeFileSync(`${file}.tmp`, JSON.stringify(data));
      renameSync(`${file}.tmp`, file); // atomic: an interrupted run never leaves a broken cache
    },
  };
}

// ---------- company detection ----------

/** The organisation named in the most files is almost always the company that owns them. */
export function detectCompany(items) {
  const withText = items.filter((it) => it.extract.text?.trim());
  const count = new Map();
  for (const it of withText) {
    for (const { value } of orgCandidates(it.extract.text, { max: 30 })) {
      const key = value.replace(/[.,]/g, '').toLowerCase();
      const e = count.get(key) ?? { value, n: 0 };
      e.n++; count.set(key, e);
    }
  }
  const best = [...count.values()].sort((a, b) => b.n - a.n)[0];
  if (!best || best.n < Math.max(3, withText.length * 0.2)) return null;
  return { name: best.value, files: best.n, of: withText.length };
}

/** Organisation names across all files (excluding our own), each also without its legal suffix. */
export function corpusEntities(items, company, { max = 1000 } = {}) {
  const own = [company?.name, ...(company?.aliases ?? [])].filter(Boolean);
  const count = new Map();
  for (const it of items) {
    if (!it.extract.text?.trim()) continue;
    const seen = new Set();
    for (const { value } of orgCandidates(it.extract.text, { exclude: own, max: 50 })) {
      for (const name of new Set([value, withoutSuffix(value)])) {
        const k = orgKey(name) + (name === value ? '' : ' ~');
        if (seen.has(k)) continue;
        seen.add(k);
        const e = count.get(k) ?? { name, n: 0 };
        e.n++; count.set(k, e);
      }
    }
  }
  return [...count.values()].sort((a, b) => b.n - a.n).slice(0, max).map((e) => e.name);
}

// ---------- routing ----------

const clean = (s) => String(s).replace(/[/\\:*?"<>|\x00-\x1f]/g, '-').replace(/\s+/g, ' ').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 80) || '_';

export function targetFor(rec, cfg) {
  const f = cfg.folders;
  const restricted = cfg.restricted_separately && rec.sensitivity === 'restricted';
  const inRestricted = (p) => (restricted ? join(f.restricted, p) : p);
  if (rec.duplicate_of) return inRestricted(join(f.duplicates, rec.name));
  if (rec.noise) return join(f.noise, rec.name);
  if (rec.review) return inRestricted(join(f.review, clean(rec.department ? labelOf(cfg.departments, rec.department) : 'Unclassified'), rec.name));
  const [y, m] = rec.date ? rec.date.split('-') : [];
  const tokens = {
    department: labelOf(cfg.departments, rec.department), department_id: rec.department,
    type: labelOf(cfg.types, rec.type), type_id: rec.type,
    sensitivity: labelOf(cfg.sensitivity, rec.sensitivity),
    year: y ?? 'Undated', month: m ?? 'Undated', quarter: m ? `Q${Math.ceil(Number(m) / 3)}` : 'Undated', date: rec.date ?? 'Undated',
    counterparty: rec.counterparty ?? 'No counterparty',
    name: rec.name, stem: basename(rec.name, extname(rec.name)), ext: extname(rec.name),
  };
  const parts = cfg.layout.split('/').map((seg) => seg.replace(/\{(\w+)\}/g, (_, k) => tokens[k] ?? ''));
  const last = parts.pop();
  return inRestricted(join(...parts.map(clean), last.replace(/[/\\:*?"<>|]/g, '-') || rec.name));
}

function uniqueTargets(records) {
  const used = new Set();
  for (const r of records) {
    if (!r.target) continue;
    let t = r.target, n = 2;
    const ext = extname(t), stem = t.slice(0, t.length - ext.length);
    while (used.has(t.toLowerCase())) t = `${stem} (${n++})${ext}`;
    used.add(t.toLowerCase());
    r.target = t.split(sep).join('/');
  }
}

// ---------- the pipeline ----------

/**
 * Scan `input` and classify every file. Returns { records, meta }.
 * opts: { config, outDir, limit, concurrency, namesOnly, noCache, maxCost, estimateOnly, log, progress }
 */
export async function scanFolder(input, opts) {
  const cfg = opts.config;
  const root = resolve(input);
  const log = opts.log ?? (() => {});
  const { files, skipped } = walk(root, { ignore: cfg.ignore, skipDirs: [opts.outDir] });
  const picked = opts.limit ? files.slice(0, opts.limit) : files;
  log(`Found ${files.length} files${skipped.length ? ` (${skipped.length} skipped: symlinks or unreadable)` : ''}${opts.limit ? `, using the first ${picked.length}` : ''}.`);

  // Hash and extract. Identical files are read once and classified once. Of a set of
  // copies, the one in the best place ("Shared Drive/..." over "Downloads/... (copy)") is
  // the original and the others point to it.
  const items = picked.map((f) => ({ ...f, name: basename(f.path), sha256: sha256(f.abs) }));
  const groups = new Map();
  for (const it of items) { if (!groups.has(it.sha256)) groups.set(it.sha256, []); groups.get(it.sha256).push(it); }
  for (const copies of groups.values()) {
    const [original, ...rest] = copies.sort((a, b) => copyScore(a.path) - copyScore(b.path) || a.path.localeCompare(b.path));
    original.extract = extract(original.abs, {});
    for (const c of rest) c.duplicate_of = original.path;
  }
  const unique = items.filter((it) => !it.duplicate_of);

  // Whose data is this? Jev must know "us" to name the other party.
  let company = cfg.company;
  let detected = null;
  if (!company.name) {
    detected = detectCompany(unique);
    if (detected) { company = { ...company, name: detected.name }; log(`Detected your company as "${detected.name}" (named in ${detected.files} of ${detected.of} files). Set company.name in the config to override.`); }
  }

  // Organisations named anywhere in the data, so a name seen as "Cairn & Co Outfitters Ltd"
  // in one file is also recognised where another file just says "Cairn & Co Outfitters".
  const known = opts.namesOnly ? [] : corpusEntities(unique, company);

  const qhash = questionHash({ ...cfg, company }, { namesOnly: !!opts.namesOnly });
  // --no-cache means "ask again": fresh answers still go into the cache for next time.
  const cache = openCache(opts.outDir);
  const model = process.env.JEV_MODEL || DEFAULT_MODEL;
  const work = unique.map((it) => {
    const prep = prepare(it, cfg, { namesOnly: opts.namesOnly, company, known });
    const request = JSON.stringify(buildRequest(it, cfg, prep, { namesOnly: opts.namesOnly, company }));
    // The cache key is the exact request: answers refer to candidates by position, so any
    // change in what would be asked means asking again.
    const key = createHash('sha256').update(`${model}\n${request}`).digest('hex');
    return { it, prep, key, size: request.length, cached: opts.noCache ? undefined : cache.get(key) };
  });

  // Estimate before spending anything.
  const todo = work.filter((w) => !w.cached);
  const chars = todo.reduce((n, w) => n + w.size, 0);
  const tokens = Math.round(chars / 3.2);
  const estimate = { files: todo.length, cached: work.length - todo.length, tokens, usd: (tokens / 1e6) * PRICE_PER_M_INPUT };
  log(`To classify: ${todo.length} files${estimate.cached ? ` (${estimate.cached} already in the cache)` : ''}, about ${tokens.toLocaleString('en-US')} tokens, about $${estimate.usd.toFixed(4)}.`);
  if (opts.estimateOnly) return { estimate };
  if (opts.maxCost != null && estimate.usd > opts.maxCost) {
    throw new Error(`The estimated cost $${estimate.usd.toFixed(2)} is above --max-cost $${opts.maxCost}. Raise --max-cost, or try --limit first.`);
  }

  // Classify.
  let done = 0, failed = 0;
  await mapLimit(work, opts.concurrency ?? 8, async (w) => {
    if (!w.cached) {
      try {
        const { answers, model: answeredBy, cost } = await askFor(w.it, cfg, w.prep, { namesOnly: opts.namesOnly, company });
        w.cached = { answers, model: answeredBy, cost, at: new Date().toISOString() };
        cache.set(w.key, w.cached);
      } catch (err) {
        w.error = String(err.message ?? err).slice(0, 300);
        failed++;
        if (err.code === 'no_key' || err.status === 401 || err.status === 402) throw err; // no point going on
      }
      if (++done % 25 === 0) cache.save();
    } else done++;
    opts.progress?.(done, work.length);
  });
  cache.save();

  // Build records.
  const byHash = new Map();
  const records = [];
  for (const w of work) {
    const rec = baseRecord(w.it);
    const detectedCounts = Object.fromEntries(Object.entries(w.prep.detected.counts).filter(([, n]) => n > 0));
    if (Object.keys(detectedCounts).length) rec.detected = detectedCounts;
    if (w.cached) {
      const c = interpret(w.cached.answers, w.prep, cfg);
      Object.assign(rec, flatten(c, cfg), { model: w.cached.model });
      const reasons = [];
      if (c.department.confidence < cfg.thresholds.department) reasons.push(`department confidence ${c.department.confidence}`);
      if (c.type.confidence < cfg.thresholds.type) reasons.push(`type confidence ${c.type.confidence}`);
      if (w.it.extract.method === 'name-only' || w.it.extract.kind === 'empty') reasons.push('no readable text');
      // Noise needs content to judge: a photo or a scan without text goes to review instead.
      rec.noise = c.noise >= cfg.thresholds.noise && !rec.detected && w.it.extract.method !== 'name-only';
      rec.review = !rec.noise && reasons.length > 0;
      if (rec.review) rec.review_reasons = reasons;
    } else {
      rec.error = w.error ?? 'not classified';
      rec.review = true;
      rec.review_reasons = ['classification failed'];
    }
    rec.target = targetFor(rec, cfg);
    byHash.set(w.it.sha256, rec);
    records.push(rec);
  }
  for (const it of items.filter((x) => x.duplicate_of)) {
    const orig = byHash.get(it.sha256);
    const rec = { ...orig, ...baseRecord(it, orig), duplicate_of: it.duplicate_of, review: false, review_reasons: undefined };
    rec.target = targetFor(rec, cfg);
    records.push(rec);
  }
  records.sort((a, b) => a.path.localeCompare(b.path));
  uniqueTargets(records);

  const meta = {
    tool: 'jev-organize',
    input: root,
    generated_at: new Date().toISOString(),
    company: company.name || null,
    company_detected: !!detected,
    question_hash: qhash,
    names_only: !!opts.namesOnly,
    redacted: cfg.redact,
    models: [...new Set(work.map((w) => w.cached?.model).filter(Boolean))],
    files: records.length,
    bytes: records.reduce((n, r) => n + r.size, 0),
    classified: work.filter((w) => w.cached).length,
    failed,
    skipped,
    usage: { calls: usage.calls, input_tokens: usage.inputTokens, cost_usd: Number(usage.cost.toFixed(6)) },
    // What classifying everything cost, including answers that came from the cache this time.
    total_cost_usd: Number(work.reduce((n, w) => n + (w.cached?.cost ?? 0), 0).toFixed(6)),
    estimate,
  };
  return { records, meta };
}

function baseRecord(it, orig) {
  const ex = it.extract ?? orig?.extract ?? {};
  return {
    path: it.path, name: it.name, ext: extname(it.name).slice(1).toLowerCase(), size: it.size, sha256: it.sha256,
    kind: orig?.kind ?? ex.kind, extract_method: orig?.extract_method ?? ex.method,
    title: orig?.title ?? (ex.title || '').slice(0, 160),
    ...(ex.error ? { extract_error: ex.error } : {}),
  };
}

function flatten(c, cfg) {
  return {
    department: c.department.id, department_label: labelOf(cfg.departments, c.department.id), department_confidence: c.department.confidence,
    type: c.type.id, type_label: labelOf(cfg.types, c.type.id), type_confidence: c.type.confidence,
    sensitivity: c.sensitivity.id, sensitivity_confidence: c.sensitivity.confidence,
    ...(c.sensitivity.reasons ? { sensitivity_raised_from: c.sensitivity.raised_from, sensitivity_reasons: c.sensitivity.reasons } : {}),
    date: c.date, counterparty: c.counterparty,
    tags: c.tags, flags: c.flags,
    ...(c.pii_columns?.length ? { pii_columns: c.pii_columns } : {}),
    noise_score: c.noise,
  };
}
