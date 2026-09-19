// Bundle the CLI into the skill folder so the skill works on its own, and zip the skill
// for upload to Claude.ai. `--check` fails when the bundle is stale (run it in CI).
//   node scripts/build.mjs [--check]
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeZip } from '../src/extract/zip.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKILL = join(ROOT, 'skills', 'jev-organize');
const BUNDLE = join(SKILL, 'scripts');
const CHECK = process.argv.includes('--check');

function files(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.DS_Store') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...files(p)); else out.push(p);
  }
  return out.sort();
}

// What goes into the bundle: the CLI, its sources, and a trimmed package.json (for the version).
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const wanted = new Map();
for (const dir of ['bin', 'src']) for (const f of files(join(ROOT, dir))) wanted.set(relative(ROOT, f), readFileSync(f));
wanted.set('package.json', Buffer.from(JSON.stringify({ name: pkg.name, version: pkg.version, type: 'module', private: true, description: 'Bundled copy of jev-organize for the skill. Do not edit: run npm run build in the repo.' }, null, 2) + '\n'));

const stale = [];
for (const [rel, data] of wanted) {
  const target = join(BUNDLE, rel);
  if (!existsSync(target) || !readFileSync(target).equals(data)) stale.push(rel);
}
const extra = existsSync(BUNDLE) ? files(BUNDLE).map((f) => relative(BUNDLE, f)).filter((r) => !wanted.has(r)) : [];

if (CHECK) {
  if (stale.length || extra.length) {
    console.error(`The skill bundle is stale (${[...stale, ...extra].join(', ')}). Run: npm run build`);
    process.exit(1);
  }
  console.log('Skill bundle is up to date.');
  process.exit(0);
}

rmSync(BUNDLE, { recursive: true, force: true });
for (const [rel, data] of wanted) {
  const target = join(BUNDLE, rel);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, data);
}

// dist/jev-organize-skill.zip: the skill folder, ready to upload to Claude.ai.
const zipFiles = {};
for (const f of files(SKILL)) zipFiles[join('jev-organize', relative(SKILL, f)).split('\\').join('/')] = readFileSync(f);
mkdirSync(join(ROOT, 'dist'), { recursive: true });
writeFileSync(join(ROOT, 'dist', 'jev-organize-skill.zip'), writeZip(zipFiles));
const kb = (statSync(join(ROOT, 'dist', 'jev-organize-skill.zip')).size / 1024).toFixed(0);
console.log(`Bundled ${wanted.size} files into skills/jev-organize/scripts/ and wrote dist/jev-organize-skill.zip (${kb} KB).`);
