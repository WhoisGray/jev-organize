// Build the organized folder from a scan. Copies (or links) files; never moves, renames,
// overwrites or deletes an original. Running it twice is safe: files already in place
// are skipped.
import { copyFileSync, constants, existsSync, linkSync, mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { readCatalog } from './report/catalog.mjs';
import { indexMarkdown, agentsMarkdown } from './report/index-md.mjs';

const MODES = ['copy', 'link', 'symlink'];
const hashOf = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');

export function applyPlan(outDir, cfg, { mode = 'copy', dest, only } = {}) {
  if (!MODES.includes(mode)) throw new Error(`--mode must be one of ${MODES.join(', ')}`);
  const { records, meta } = readCatalog(outDir);
  const root = resolve(dest ?? join(outDir, 'organized'));
  const input = meta.input;
  if (root === resolve(input) || root.startsWith(resolve(input) + '/')) throw new Error('The organized folder must not be inside the input folder.');
  mkdirSync(root, { recursive: true });
  const stats = { copied: 0, linked: 0, skipped: 0, renamed: 0, missing: 0 };
  const moved = [];
  const actual = new Map(); // original path -> where it really landed
  for (const r of records) {
    if (only && !only(r)) continue;
    const src = join(input, r.path);
    if (!existsSync(src)) { stats.missing++; continue; }
    let dst = join(root, r.target);
    if (existsSync(dst)) {
      if (statSync(dst).size === r.size && hashOf(dst) === r.sha256) { stats.skipped++; actual.set(r.path, r.target); continue; }
      // Something else is already there: keep it and pick a free name.
      const ext = extname(dst), stem = dst.slice(0, dst.length - ext.length);
      let n = 2;
      while (existsSync(dst)) dst = `${stem} (${n++})${ext}`;
      stats.renamed++;
    }
    mkdirSync(dirname(dst), { recursive: true });
    if (mode === 'copy') { copyFileSync(src, dst, constants.COPYFILE_EXCL); stats.copied++; }
    else if (mode === 'symlink') { symlinkSync(src, dst); stats.linked++; }
    else {
      try { linkSync(src, dst); stats.linked++; } catch { copyFileSync(src, dst, constants.COPYFILE_EXCL); stats.copied++; } // other disk: copy
    }
    const to = relative(root, dst).split('\\').join('/');
    actual.set(r.path, to);
    moved.push({ from: r.path, to, mode });
  }
  // Make the organized folder self-describing for people and agents.
  const placed = records.filter((r) => actual.has(r.path)).map((r) => ({ ...r, target: actual.get(r.path) }));
  writeFileSync(join(root, 'INDEX.md'), indexMarkdown(placed, meta, cfg, { base: '' }));
  writeFileSync(join(root, 'AGENTS.md'), agentsMarkdown(meta, cfg));
  writeFileSync(join(root, 'CLAUDE.md'), '@AGENTS.md\n');
  writeFileSync(join(root, 'catalog.jsonl'), placed.map((r) => JSON.stringify(r)).join('\n') + '\n');
  writeFileSync(join(outDir, 'applied.jsonl'), moved.map((m) => JSON.stringify(m)).join('\n') + (moved.length ? '\n' : ''), { flag: 'a' });
  return { root, stats };
}
