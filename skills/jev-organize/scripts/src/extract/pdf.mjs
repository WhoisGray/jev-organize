// Text out of PDFs. Uses `pdftotext` (poppler) when it is installed, because it handles
// every font encoding. Otherwise a small built-in reader pulls text from simple PDFs:
// it inflates content streams and reads the Tj/TJ text operators. Scanned PDFs have no
// text at all; those are classified from their name and folder only.
import { execFileSync } from 'node:child_process';
import { inflateSync } from 'node:zlib';

let hasPdftotext;
function pdftotextAvailable() {
  if (hasPdftotext === undefined) {
    try { execFileSync('pdftotext', ['-v'], { stdio: 'ignore' }); hasPdftotext = true; } catch { hasPdftotext = false; }
  }
  return hasPdftotext;
}

export function pdfText(buf, file, { usePoppler = true } = {}) {
  if (usePoppler && file && pdftotextAvailable()) {
    try {
      const text = execFileSync('pdftotext', ['-layout', '-enc', 'UTF-8', '-l', '20', file, '-'], { maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8');
      return { text: tidy(text), method: 'pdftotext' };
    } catch { /* fall through to the built-in reader */ }
  }
  return { text: tidy(builtinPdfText(buf)), method: 'builtin' };
}

const tidy = (s) => s.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();

export function builtinPdfText(buf) {
  const src = buf.toString('latin1');
  const out = [];
  const re = /<<([\s\S]*?)>>\s*stream\r?\n/g;
  let m;
  while ((m = re.exec(src))) {
    const dict = m[1];
    const start = m.index + m[0].length;
    const end = src.indexOf('endstream', start);
    if (end < 0) break;
    if (/\/Subtype\s*\/Image/.test(dict)) { re.lastIndex = end; continue; }
    let data = buf.subarray(start, end);
    if (/\/FlateDecode/.test(dict)) {
      try { data = inflateSync(data); } catch { re.lastIndex = end; continue; }
    } else if (/\/Filter/.test(dict)) { re.lastIndex = end; continue; } // other filters: skip
    const text = textOperators(data.toString('latin1'));
    if (text.trim()) out.push(text);
    re.lastIndex = end;
    if (out.join('').length > 200_000) break;
  }
  return out.join('\n');
}

// Reads (string) Tj, [(a) 12 (b)] TJ, ' and " operators; Td/TD/T*/ET start new lines.
function textOperators(content) {
  if (!/\bBT\b/.test(content)) return '';
  let text = '';
  const re = /\((?:\\.|[^\\)])*\)\s*(?:Tj|'|")|\[((?:\\.|[^\]])*)\]\s*TJ|-?[\d.]+\s+-?[\d.]+\s+T[dD]|T\*|\bET\b/g;
  for (const m of content.matchAll(re)) {
    const tok = m[0];
    if (tok.endsWith('TJ')) {
      for (const s of m[1].matchAll(/\((?:\\.|[^\\)])*\)|-?\d+(?:\.\d+)?/g)) {
        if (s[0].startsWith('(')) text += unescape(s[0].slice(1, -1));
        else if (Number(s[0]) < -200) text += ' '; // a wide kerning gap is a space
      }
    } else if (tok.startsWith('(')) {
      const str = tok.match(/^\(((?:\\.|[^\\)])*)\)/)[1];
      if (/['"]$/.test(tok)) text += '\n';
      text += unescape(str);
    } else {
      const moveY = tok.match(/^-?[\d.]+\s+(-?[\d.]+)/);
      if (tok === 'T*' || (moveY && Number(moveY[1]) !== 0)) text += '\n';
      else if (tok === 'ET') text += '\n';
      else text += ' ';
    }
  }
  return text;
}

function unescape(s) {
  return s.replace(/\\([nrtbf()\\]|[0-7]{1,3}|\r?\n)/g, (_, c) => {
    if (/^[0-7]+$/.test(c)) return String.fromCharCode(parseInt(c, 8));
    return { n: '\n', r: '\r', t: '\t', b: '', f: '', '(': '(', ')': ')', '\\': '\\' }[c] ?? '';
  });
}

/** A one-page PDF with the given lines, Helvetica 10pt. For the example builder and tests. */
export function makePdf(lines, { title } = {}) {
  const esc = (s) => s.replace(/[\\()]/g, (c) => `\\${c}`).replace(/[^\x20-\x7e]/g, (c) => {
    const code = c.charCodeAt(0);
    return code < 256 ? `\\${code.toString(8).padStart(3, '0')}` : '?';
  });
  const pages = [];
  for (let i = 0; i < lines.length; i += 62) pages.push(lines.slice(i, i + 62));
  if (!pages.length) pages.push([]);
  const objs = [];
  const add = (body) => { objs.push(body); return objs.length; };
  const catalog = add(null), pagesObj = add(null), font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const kids = [];
  for (const page of pages) {
    const ops = ['BT', '/F1 10 Tf', '12 TL', '50 800 Td', ...page.map((l, i) => `${i ? 'T* ' : ''}(${esc(l)}) Tj`), 'ET'].join('\n');
    const content = add(`<< /Length ${Buffer.byteLength(ops, 'latin1')} >>\nstream\n${ops}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  const info = title ? add(`<< /Title (${esc(title)}) >>`) : null;
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((body, i) => { offsets.push(Buffer.byteLength(pdf, 'latin1')); pdf += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R${info ? ` /Info ${info} 0 R` : ''} >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}
