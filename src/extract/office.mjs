// Text out of Office Open XML (docx, xlsx, pptx) and OpenDocument (odt, ods, odp) files.
import { listZip, readZipEntry } from './zip.mjs';

export function decodeXml(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

const stripTags = (xml) => decodeXml(xml.replace(/<[^>]+>/g, ''));
const tidy = (s) => s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

function coreMeta(zip, entries) {
  const core = readZipEntry(zip, entries, 'docProps/core.xml')?.toString('utf8');
  if (!core) return {};
  const tag = (t) => { const m = core.match(new RegExp(`<${t}[^>]*>([^<]*)</${t}>`)); return m ? decodeXml(m[1]).trim() : undefined; };
  const meta = { title: tag('dc:title'), author: tag('dc:creator'), created: tag('dcterms:created'), modified: tag('dcterms:modified') };
  return Object.fromEntries(Object.entries(meta).filter(([, v]) => v));
}

export function docxText(buf) {
  const entries = listZip(buf);
  const xml = readZipEntry(buf, entries, 'word/document.xml')?.toString('utf8');
  if (!xml) throw new Error('no word/document.xml');
  const text = stripTags(xml
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:(br|cr)\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<\/w:tc>/g, '\t'));
  return { text: tidy(text), meta: coreMeta(buf, entries) };
}

export function pptxText(buf) {
  const entries = listZip(buf);
  const slides = [...entries.keys()]
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  const parts = slides.map((name, i) => {
    const xml = readZipEntry(buf, entries, name).toString('utf8');
    return `Slide ${i + 1}:\n${tidy(stripTags(xml.replace(/<\/a:p>/g, '\n')))}`;
  });
  // A deck's title is the first line of its first slide, not the (often template) core title.
  const title = parts[0]?.split('\n').slice(1).find((l) => l.trim())?.replace(/^[•\-\s]+/, '').slice(0, 120) ?? '';
  return { text: parts.join('\n\n'), title, meta: { ...coreMeta(buf, entries), slides: slides.length } };
}

const colIndex = (ref) => {
  const letters = ref.match(/^[A-Z]+/)?.[0] ?? 'A';
  let n = 0;
  for (const c of letters) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
};

/** Sheets as { name, rows: string[][] }. At most `maxRows` rows per sheet. */
export function xlsxSheets(buf, { maxRows = 2000 } = {}) {
  const entries = listZip(buf);
  const read = (n) => readZipEntry(buf, entries, n)?.toString('utf8') ?? '';
  const shared = [...read('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map((m) => decodeXml([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
  const rels = Object.fromEntries([...read('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)].map((m) => [
    m[0].match(/Id="([^"]+)"/)?.[1], m[0].match(/Target="([^"]+)"/)?.[1],
  ]));
  const sheets = [...read('xl/workbook.xml').matchAll(/<sheet\b[^>]*>/g)].map((m) => {
    const name = decodeXml(m[0].match(/name="([^"]*)"/)?.[1] ?? 'Sheet');
    const target = rels[m[0].match(/r:id="([^"]+)"/)?.[1]] ?? '';
    return { name, path: target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}` };
  });
  return sheets.map(({ name, path }) => {
    const xml = read(path);
    const rows = [];
    for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      if (rows.length >= maxRows) break;
      const cells = [];
      for (const c of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1], body = c[2] ?? '';
        const ref = attrs.match(/r="([A-Z]+)\d+"/)?.[1];
        const type = attrs.match(/t="([^"]+)"/)?.[1];
        let v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        if (type === 's') v = shared[Number(v)];
        else if (type === 'inlineStr') v = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('');
        if (v === undefined) continue;
        cells[ref ? colIndex(ref) : cells.length] = decodeXml(String(v));
      }
      rows.push(Array.from(cells, (x) => x ?? ''));
    }
    return { name, rows };
  });
}

export function odfText(buf) {
  const entries = listZip(buf);
  const xml = readZipEntry(buf, entries, 'content.xml')?.toString('utf8');
  if (!xml) throw new Error('no content.xml');
  const text = stripTags(xml
    .replace(/<text:tab\/>/g, '\t')
    .replace(/<text:line-break\/>/g, '\n')
    .replace(/<\/text:(p|h)>/g, '\n')
    .replace(/<\/table:table-cell>/g, '\t')
    .replace(/<\/table:table-row>/g, '\n'));
  return { text: tidy(text), meta: {} };
}
