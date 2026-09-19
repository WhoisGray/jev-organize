// catalog.jsonl (one JSON object per file) and catalog.csv (the same, flat, for spreadsheets).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function writeCatalog(outDir, records, meta) {
  writeFileSync(join(outDir, 'catalog.jsonl'), records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  writeFileSync(join(outDir, 'run.json'), JSON.stringify(meta, null, 2) + '\n');
  const cols = ['path', 'target', 'department', 'type', 'sensitivity', 'date', 'counterparty', 'tags', 'title', 'department_confidence', 'type_confidence', 'sensitivity_confidence', 'review', 'noise', 'duplicate_of', 'personal_data', 'credentials', 'payment_details', 'pii_columns', 'detected', 'kind', 'size', 'sha256', 'error'];
  const cell = (r, c) => {
    const v = c in (r.flags ?? {}) ? r.flags[c]
      : c === 'tags' ? (r.tags ?? []).join('; ')
      : c === 'pii_columns' ? (r.pii_columns ?? []).map((p) => `${p.name}=${p.data}`).join('; ')
      : c === 'detected' ? Object.entries(r.detected ?? {}).map(([k, n]) => `${k}:${n}`).join('; ')
      : r[c];
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  writeFileSync(join(outDir, 'catalog.csv'), [cols.join(','), ...records.map((r) => cols.map((c) => cell(r, c)).join(','))].join('\n') + '\n');
}

export function readCatalog(outDir) {
  const records = readFileSync(join(outDir, 'catalog.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const meta = JSON.parse(readFileSync(join(outDir, 'run.json'), 'utf8'));
  return { records, meta };
}

/** Filter records the way `jev-organize query` does. */
export function filterRecords(records, q) {
  const has = (v) => v != null && v !== '' && v !== false;
  return records.filter((r) =>
    (!has(q.department) || r.department === q.department)
    && (!has(q.type) || r.type === q.type)
    && (!has(q.sensitivity) || r.sensitivity === q.sensitivity)
    && (!has(q.tag) || (r.tags ?? []).includes(q.tag))
    && (!has(q.year) || (r.date ?? '').startsWith(String(q.year)))
    && (!has(q.counterparty) || (r.counterparty ?? '').toLowerCase().includes(String(q.counterparty).toLowerCase()))
    && (!has(q.text) || `${r.path} ${r.title} ${r.counterparty ?? ''}`.toLowerCase().includes(String(q.text).toLowerCase()))
    && (!q.review || r.review)
    && (!q.pii || (r.flags?.personal_data ?? 0) >= 0.5 || (r.pii_columns ?? []).length > 0)
    && (q.includeDuplicates || !r.duplicate_of)
    && (q.includeNoise || !r.noise));
}
