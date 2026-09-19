// Build examples/company-data/ from the text sources in examples/company-data-src/.
//   name.docx.txt -> name.docx    name.pdf.txt -> name.pdf
//   name.xlsx.csv -> name.xlsx    name.pptx.md -> name.pptx (slides split by ---)
// Every other file is copied as it is. Run: npm run examples
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { walk } from '../src/organize.mjs';
import { makeDocx, makeXlsx, makePptx, parseDeck } from './office-writer.mjs';
import { makePdf } from '../src/extract/pdf.mjs';
import { parseDelimited } from '../src/extract/index.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'examples', 'company-data-src');
const OUT = join(ROOT, 'examples', 'company-data');

rmSync(OUT, { recursive: true, force: true });
const { files } = walk(SRC, { ignore: ['.DS_Store'] });
const counts = {};
for (const f of files) {
  const text = () => readFileSync(f.abs, 'utf8');
  const stem = (suffix) => f.path.slice(0, -suffix.length);
  const title = (p) => p.split('/').pop().replace(/\.[^.]+$/, '');
  let target = f.path, data;
  if (f.path.endsWith('.docx.txt')) { target = stem('.txt'); data = makeDocx(text(), { title: title(target) }); }
  else if (f.path.endsWith('.pdf.txt')) { target = stem('.txt'); data = makePdf(text().replace(/\r/g, '').split('\n'), { title: title(target) }); }
  else if (f.path.endsWith('.xlsx.csv')) { target = stem('.csv'); data = makeXlsx(parseDelimited(text(), ','), { sheet: title(target) }); }
  else if (f.path.endsWith('.pptx.md')) { target = stem('.md'); data = makePptx(parseDeck(text()), { title: title(target) }); }
  const out = join(OUT, target);
  mkdirSync(dirname(out), { recursive: true });
  if (data) writeFileSync(out, data); else cpSync(f.abs, out);
  const ext = target.split('.').pop();
  counts[ext] = (counts[ext] ?? 0) + 1;
}
console.log(`Built ${files.length} files into examples/company-data/: ${Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([e, n]) => `${n} .${e}`).join(', ')}`);
