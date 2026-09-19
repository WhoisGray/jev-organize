// report.html: one self-contained page (no network) to browse and filter the catalog.
import { labelOf } from '../config.mjs';

export function reportHtml(records, meta, cfg) {
  const data = {
    meta: { company: meta.company, input: meta.input, generated_at: meta.generated_at, models: meta.models, cost: meta.total_cost_usd ?? meta.usage?.cost_usd ?? 0, bytes: meta.bytes },
    labels: {
      department: Object.fromEntries(Object.keys(cfg.departments).map((k) => [k, labelOf(cfg.departments, k)])),
      type: Object.fromEntries(Object.keys(cfg.types).map((k) => [k, labelOf(cfg.types, k)])),
      sensitivity: Object.fromEntries(Object.keys(cfg.sensitivity).map((k) => [k, labelOf(cfg.sensitivity, k)])),
    },
    records: records.map((r) => ({
      p: r.path, n: r.name, t: r.target, ti: r.title, d: r.department, ty: r.type, s: r.sensitivity, dt: r.date, c: r.counterparty,
      tg: r.tags ?? [], rv: !!r.review, rr: r.review_reasons ?? [], du: r.duplicate_of ?? null, no: !!r.noise,
      cf: Math.min(r.department_confidence ?? 0, r.type_confidence ?? 0), pii: (r.pii_columns ?? []).map((x) => `${x.name}: ${x.data}`),
      fl: Object.entries(r.flags ?? {}).filter(([, p]) => p >= 0.5).map(([k]) => k.replace('_', ' ')), sr: r.sensitivity_reasons ?? [], er: r.error ?? null,
    })),
  };
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Data report${meta.company ? ` · ${escapeHtml(meta.company)}` : ''}</title>
<style>
:root {
  --bg: #f7f6f2; --panel: #ffffff; --ink: #1d1c1a; --muted: #6b6860; --line: #e4e1d8; --accent: #2f5d50; --accent-soft: #e3ece8;
  --public: #2e7d4f; --internal: #5c6770; --confidential: #a86400; --restricted: #b3261e; --warn: #a86400;
  --mono: ui-monospace, SFMono-Regular, Menlo, monospace; --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #161614; --panel: #1f1f1c; --ink: #ecebe6; --muted: #a09d94; --line: #34332e; --accent: #8cc4b2; --accent-soft: #23322d;
  --public: #6fcf97; --internal: #a7b1b9; --confidential: #f2b35b; --restricted: #ff8a80; --warn: #f2b35b;
} }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 14px/1.45 var(--sans); }
main { max-width: 1240px; margin: 0 auto; padding: 28px 16px 60px; }
h1 { font-size: 24px; margin: 0 0 4px; letter-spacing: -0.01em; }
.sub { color: var(--muted); margin: 0 0 22px; word-break: break-word; }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; margin-bottom: 18px; }
.tile { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; }
.tile b { display: block; font-size: 22px; font-variant-numeric: tabular-nums; }
.tile span { color: var(--muted); font-size: 12px; }
.grid { display: grid; grid-template-columns: 300px 1fr; gap: 16px; align-items: start; }
.grid > * { min-width: 0; } /* let the table scroll inside its box instead of widening the page */
@media (max-width: 860px) { .grid { grid-template-columns: 1fr; } }
.panel { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 14px; }
.panel h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin: 0 0 10px; }
.bar { display: grid; grid-template-columns: 1fr auto; gap: 2px 8px; width: 100%; text-align: left; background: none; border: 0; padding: 6px 4px; border-radius: 6px; color: inherit; font: inherit; cursor: pointer; }
.bar:hover, .bar[aria-pressed="true"] { background: var(--accent-soft); }
.bar i { grid-column: 1 / -1; display: block; height: 6px; border-radius: 3px; background: var(--accent); opacity: .85; }
.bar em { font-style: normal; color: var(--muted); font-variant-numeric: tabular-nums; }
.controls { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.controls input[type=search] { flex: 1 1 220px; }
input, select { font: inherit; color: inherit; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 7px 9px; min-width: 0; }
label.check { display: flex; align-items: center; gap: 6px; color: var(--muted); }
.table-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 10px; background: var(--panel); }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { font-size: 12px; color: var(--muted); font-weight: 600; cursor: pointer; white-space: nowrap; user-select: none; }
tr:last-child td { border-bottom: 0; }
td .path { display: block; color: var(--muted); font: 12px var(--mono); word-break: break-all; }
td.date { white-space: nowrap; font-variant-numeric: tabular-nums; }
td.target { font: 12px var(--mono); color: var(--muted); word-break: break-all; min-width: 200px; }
.badge { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 12px; border: 1px solid currentColor; white-space: nowrap; }
.s-public { color: var(--public); } .s-internal { color: var(--internal); } .s-confidential { color: var(--confidential); } .s-restricted { color: var(--restricted); }
.flag { color: var(--warn); font-size: 12px; display: block; }
.conf { font-variant-numeric: tabular-nums; }
.empty { padding: 30px; text-align: center; color: var(--muted); }
.count { color: var(--muted); margin: 0 0 8px; }
footer { margin-top: 26px; color: var(--muted); font-size: 12px; }
footer a { color: var(--accent); }
</style>
</head>
<body>
<main>
  <h1>Data report</h1>
  <p class="sub" id="sub"></p>
  <section class="tiles" id="tiles"></section>
  <div class="grid">
    <aside class="panel"><h2>Departments</h2><div id="bars"></div></aside>
    <section>
      <div class="controls">
        <input type="search" id="q" placeholder="Search file, title or counterparty" aria-label="Search">
        <select id="f-type" aria-label="Type"><option value="">All types</option></select>
        <select id="f-sens" aria-label="Sensitivity"><option value="">All sensitivity</option></select>
        <select id="f-tag" aria-label="Tag"><option value="">All tags</option></select>
        <label class="check"><input type="checkbox" id="f-review"> Needs review</label>
        <label class="check"><input type="checkbox" id="f-all"> Duplicates and noise</label>
      </div>
      <p class="count" id="count"></p>
      <div class="table-wrap"><table>
        <thead><tr><th data-k="n">File</th><th data-k="d">Department</th><th data-k="ty">Type</th><th data-k="s">Sensitivity</th><th data-k="dt">Date</th><th data-k="c">Counterparty</th><th data-k="cf">Conf.</th><th data-k="t">Organized as</th></tr></thead>
        <tbody id="rows"></tbody>
      </table></div>
    </section>
  </div>
  <footer>Made with <a href="https://github.com/nexibeo/jev-organize">jev-organize</a>. Everything on this page comes from <code>catalog.jsonl</code>; nothing is loaded from the network.</footer>
</main>
<script id="data" type="application/json">${json}</script>
<script>
const D = JSON.parse(document.getElementById('data').textContent);
const L = D.labels, R = D.records;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const lab = (g, k) => (L[g] && L[g][k]) || k || '–';
const live = R.filter((r) => !r.du && !r.no);
const fmtBytes = (n) => n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
$('sub').textContent = [D.meta.company, D.meta.input, 'organized ' + new Date(D.meta.generated_at).toLocaleDateString('en-CA'), D.meta.models.join(', ')].filter(Boolean).join(' · ');
const tiles = [
  [R.length, 'files, ' + fmtBytes(D.meta.bytes)],
  [new Set(live.map((r) => r.d)).size, 'departments'],
  [live.filter((r) => r.rv).length, 'need review'],
  [live.filter((r) => r.s === 'restricted').length, 'restricted'],
  [R.filter((r) => r.du).length, 'duplicates'],
  ['$' + D.meta.cost.toFixed(4), 'Jev cost'],
];
$('tiles').innerHTML = tiles.map(([b, s]) => '<div class="tile"><b>' + esc(b) + '</b><span>' + esc(s) + '</span></div>').join('');
const state = { dept: '', sort: 'd', dir: 1 };
function fill(id, values, group) {
  const sel = $(id);
  for (const v of values) { const o = document.createElement('option'); o.value = v; o.textContent = group ? lab(group, v) : v; sel.append(o); }
}
fill('f-type', [...new Set(live.map((r) => r.ty).filter(Boolean))].sort(), 'type');
fill('f-sens', Object.keys(L.sensitivity).filter((k) => live.some((r) => r.s === k)), 'sensitivity');
fill('f-tag', [...new Set(live.flatMap((r) => r.tg))].sort());
function bars() {
  const counts = {};
  for (const r of live) counts[r.d || 'unclassified'] = (counts[r.d || 'unclassified'] || 0) + 1;
  const max = Math.max(1, ...Object.values(counts));
  $('bars').innerHTML = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, n]) =>
    '<button class="bar" data-d="' + esc(k) + '" aria-pressed="' + (state.dept === k) + '"><span>' + esc(lab('department', k)) + '</span><em>' + n + '</em><i style="width:' + (100 * n / max).toFixed(1) + '%"></i></button>').join('');
  for (const b of $('bars').querySelectorAll('.bar')) b.onclick = () => { state.dept = state.dept === b.dataset.d ? '' : b.dataset.d; render(); };
}
function render() {
  bars();
  const q = $('q').value.trim().toLowerCase(), ty = $('f-type').value, s = $('f-sens').value, tg = $('f-tag').value;
  const rows = R.filter((r) => ($('f-all').checked || (!r.du && !r.no))
    && (!state.dept || (r.d || 'unclassified') === state.dept) && (!ty || r.ty === ty) && (!s || r.s === s) && (!tg || r.tg.includes(tg))
    && (!$('f-review').checked || r.rv)
    && (!q || (r.p + ' ' + (r.ti || '') + ' ' + (r.c || '')).toLowerCase().includes(q)));
  const k = state.sort;
  const val = (r) => k === 'd' ? lab('department', r.d) : k === 'ty' ? lab('type', r.ty) : k === 's' ? Object.keys(L.sensitivity).indexOf(r.s) : (r[k] ?? '');
  rows.sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : a.n.localeCompare(b.n)) * state.dir);
  $('count').textContent = rows.length + ' of ' + R.length + ' files';
  $('rows').innerHTML = rows.length ? rows.map((r) => {
    const notes = [];
    if (r.rv) notes.push('Review: ' + r.rr.join('; '));
    if (r.du) notes.push('Copy of ' + r.du);
    if (r.no) notes.push('Looks like noise');
    if (r.sr.length || r.fl.length) notes.push([...r.sr, ...r.fl].join('; '));
    if (r.pii.length) notes.push('PII columns: ' + r.pii.join(', '));
    if (r.er) notes.push('Error: ' + r.er);
    return '<tr><td><b>' + esc(r.n) + '</b><span class="path">' + esc(r.p) + '</span>' + notes.map((n) => '<span class="flag">' + esc(n) + '</span>').join('') + '</td>'
      + '<td>' + esc(lab('department', r.d)) + '</td><td>' + esc(lab('type', r.ty)) + '</td>'
      + '<td><span class="badge s-' + esc(r.s) + '">' + esc(lab('sensitivity', r.s)) + '</span></td>'
      + '<td class="date">' + esc(r.dt || '') + '</td><td>' + esc(r.c || '') + '</td><td class="conf">' + (r.cf ? r.cf.toFixed(2) : '') + '</td>'
      + '<td class="target">' + esc(r.t) + '</td></tr>';
  }).join('') : '<tr><td colspan="8" class="empty">No files match these filters.</td></tr>';
}
for (const id of ['q', 'f-type', 'f-sens', 'f-tag', 'f-review', 'f-all']) $(id).addEventListener('input', render);
for (const th of document.querySelectorAll('th[data-k]')) th.onclick = () => { state.dir = state.sort === th.dataset.k ? -state.dir : 1; state.sort = th.dataset.k; render(); };
render();
</script>
</body>
</html>
`;
}

function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
