// INDEX.md: a map of the data for people and AI agents, and AGENTS.md: how an agent should
// work in the organized folder. Links point at `organized/...` (or at the file itself when
// the index sits inside the organized folder).
import { labelOf } from '../config.mjs';

const MAX_PER_SECTION = 60;
const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const size = (n) => (n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const day = (iso) => new Date(iso).toLocaleDateString('en-CA'); // local YYYY-MM-DD
const link = (r, base) => `[${esc(r.name)}](<${base}${r.target}>)`;

export function indexMarkdown(records, meta, cfg, { base = 'organized/' } = {}) {
  const live = records.filter((r) => !r.duplicate_of && !r.noise);
  const restricted = live.filter((r) => r.sensitivity === 'restricted');
  const review = live.filter((r) => r.review);
  const dupes = records.filter((r) => r.duplicate_of);
  const noise = records.filter((r) => r.noise);
  const L = [];
  L.push('# Data index', '');
  L.push(`Organized by [jev-organize](https://github.com/nexibeo/jev-organize) on ${day(meta.generated_at)}${meta.company ? ` for **${esc(meta.company)}**` : ''}: ${records.length} files (${size(meta.bytes)}), classified by ${meta.models.join(', ') || 'Jev'}${(meta.total_cost_usd ?? meta.usage?.cost_usd) ? ` for $${(meta.total_cost_usd ?? meta.usage.cost_usd).toFixed(4)}` : ''}.`);
  L.push('');
  const n = (count, one, many) => `${count} ${count === 1 ? one : many}`;
  L.push(`${live.length} files are filed by department and type. ${n(review.length, 'needs', 'need')} review, ${n(restricted.length, 'is', 'are')} restricted, ${n(dupes.length, 'is a duplicate', 'are duplicates')} and ${n(noise.length, 'looks', 'look')} like noise.`);
  L.push('');
  L.push('## For AI agents', '');
  L.push('- `catalog.jsonl` has one JSON object per file: `path` (original location), `target` (location in the organized folder), `department`, `type`, `sensitivity`, `date`, `counterparty`, `tags`, `flags`, `pii_columns` and a confidence for each answer. Filter it before opening files.');
  L.push('- The same filters from the command line: `jev-organize query <output-folder> --department finance --year 2026 --json`.');
  L.push(`- Files under \`${cfg.folders.restricted}/\` contain personal data, credentials or payment details. Do not open, quote, copy or upload them unless the user asks for that specific file.`);
  L.push(`- Files under \`${cfg.folders.review}/\` were classified with low confidence. Treat their labels as a guess.`);
  L.push('- Dates are the document\'s own date (issued, signed, sent), picked from dates written in the file. `null` means none was found.');
  L.push('');

  L.push('## Overview', '');
  L.push('| Department | Files | Most common types |', '| --- | ---: | --- |');
  const byDept = group(live, (r) => r.department ?? 'unclassified');
  for (const [dept, rs] of sortGroups(byDept)) {
    const types = sortGroups(group(rs, (r) => r.type)).slice(0, 4).map(([t, x]) => `${labelOf(cfg.types, t)} (${x.length})`).join(', ');
    L.push(`| ${esc(labelOf(cfg.departments, dept))} | ${rs.length} | ${esc(types)} |`);
  }
  L.push('');

  for (const [dept, rs] of sortGroups(byDept)) {
    L.push(`## ${esc(labelOf(cfg.departments, dept))} (${rs.length})`, '');
    for (const [type, ts] of sortGroups(group(rs, (r) => r.type))) {
      L.push(`### ${esc(labelOf(cfg.types, type))} (${ts.length})`, '');
      L.push('| Date | File | Counterparty | Sensitivity | Tags | Title |', '| --- | --- | --- | --- | --- | --- |');
      const sorted = [...ts].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || a.name.localeCompare(b.name));
      for (const r of sorted.slice(0, MAX_PER_SECTION)) {
        L.push(`| ${r.date ?? ''} | ${link(r, base)}${r.review ? ' ⚠︎' : ''} | ${esc(r.counterparty ?? '')} | ${r.sensitivity ?? ''} | ${esc((r.tags ?? []).join(', '))} | ${esc((r.title ?? '').slice(0, 70))} |`);
      }
      if (sorted.length > MAX_PER_SECTION) L.push(`| | … and ${sorted.length - MAX_PER_SECTION} more in \`catalog.jsonl\` | | | | |`);
      L.push('');
    }
  }

  if (review.length) {
    L.push(`## Needs review (${review.length})`, '', 'Marked ⚠︎ above. Low confidence or no readable text; check these by hand or improve the taxonomy in `jev-organize.config.json`.', '');
    L.push('| File | Best guess | Why |', '| --- | --- | --- |');
    for (const r of review.slice(0, 200)) L.push(`| ${link(r, base)} | ${esc(labelOf(cfg.departments, r.department ?? '-'))} / ${esc(labelOf(cfg.types, r.type ?? '-'))} | ${esc((r.review_reasons ?? []).join('; '))} |`);
    L.push('');
  }
  if (restricted.length) {
    L.push(`## Restricted (${restricted.length})`, '', 'Personal data, credentials or payment details. Consider tighter access for this folder.', '');
    L.push('| File | Why |', '| --- | --- |');
    for (const r of restricted.slice(0, 200)) {
      L.push(`| ${link(r, base)} | ${esc(whyRestricted(r) || 'judged restricted by its content')} |`);
    }
    L.push('');
  }
  if (dupes.length) {
    L.push(`## Duplicates (${dupes.length})`, '', 'Byte-identical copies of another file. Kept aside, not deleted.', '');
    for (const r of dupes.slice(0, 200)) L.push(`- ${link(r, base)} is a copy of \`${esc(r.duplicate_of)}\``);
    L.push('');
  }
  if (noise.length) {
    L.push(`## Noise (${noise.length})`, '', 'Empty, test or scratch files. Kept aside, not deleted.', '');
    for (const r of noise.slice(0, 200)) L.push(`- ${link(r, base)} (from \`${esc(r.path)}\`)`);
    L.push('');
  }
  return L.join('\n');
}

/** AGENTS.md for the organized folder, so Claude Code or Codex opened there knows the map. */
export function agentsMarkdown(meta, cfg) {
  return [
    '# Working in this folder',
    '',
    `This folder was organized by jev-organize on ${day(meta.generated_at)}${meta.company ? ` from ${meta.company}'s files` : ''}. The originals are untouched in \`${meta.input}\`.`,
    '',
    '- Start with `INDEX.md` (overview and file tables) and `catalog.jsonl` (one JSON object per file with department, type, sensitivity, date, counterparty, tags and confidences).',
    '- To find files, filter `catalog.jsonl` first (for example with `jq` or a short script) instead of opening every file.',
    '- Folders: `<Department>/<Type>/<Year>/`. Dates are each document\'s own date.',
    `- \`${cfg.folders.restricted}/\` holds personal data, credentials or payment details. Only open those files when the user asks for them specifically, and never paste their contents into other tools.`,
    `- \`${cfg.folders.review}/\` holds files classified with low confidence. \`${cfg.folders.duplicates}/\` and \`${cfg.folders.noise}/\` hold exact copies and empty or scratch files.`,
    '- Do not rename or move files here by hand; change `jev-organize.config.json` and re-run `jev-organize scan` and `apply` instead, so the catalog stays correct.',
    '',
  ].join('\n');
}

const DETECTED = { secret: 'passwords or keys', card: 'card numbers', iban: 'IBANs', national_id: 'national ID numbers' };
const COLUMN = { person_name: 'names', email: 'emails', phone: 'phone numbers', address: 'addresses', birth_date: 'dates of birth', national_id: 'ID numbers', bank_card: 'bank or card numbers', salary: 'pay', health: 'health data', credentials: 'credentials' };

/** A short, plain reason why a file is restricted: what was found, not how. */
export function whyRestricted(r) {
  const why = Object.keys(r.detected ?? {}).filter((k) => DETECTED[k]).map((k) => DETECTED[k]);
  const flags = r.flags ?? {};
  if (flags.credentials >= 0.5 && !why.includes(DETECTED.secret)) why.push('credentials');
  if (flags.payment_details >= 0.5 && !why.some((w) => /card|IBAN/.test(w))) why.push('payment details');
  const cols = [...new Set((r.pii_columns ?? []).map((c) => COLUMN[c.data]).filter(Boolean))];
  if (cols.length) why.push(`columns with ${cols.join(', ')}`);
  if (flags.personal_data >= 0.5 && !cols.length) why.push('personal data');
  return why.join('; ');
}

function group(rs, key) {
  const m = new Map();
  for (const r of rs) { const k = key(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
  return m;
}
const sortGroups = (m) => [...m].sort((a, b) => b[1].length - a[1].length || String(a[0]).localeCompare(String(b[0])));
