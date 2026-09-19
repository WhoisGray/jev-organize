// Turn any file into { kind, text, title, table?, meta, method }. Never throws: a file that
// can't be read is still classified from its name and folder (method "name-only").
import { openSync, readSync, closeSync, readFileSync, statSync } from 'node:fs';
import { extname, basename } from 'node:path';
import { docxText, pptxText, xlsxSheets, odfText, decodeXml } from './office.mjs';
import { listZip } from './zip.mjs';
import { pdfText } from './pdf.mjs';

const EXT = {
  text: ['txt', 'md', 'markdown', 'rst', 'rtf', 'log', 'text', 'nfo', 'tex'],
  code: ['py', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'java', 'go', 'rb', 'php', 'sh', 'bash', 'zsh', 'ps1', 'sql', 'rs', 'c', 'h', 'cpp', 'hpp', 'cs', 'swift', 'kt', 'scala', 'r', 'm', 'pl', 'lua', 'dart', 'vue', 'svelte', 'css', 'scss'],
  config: ['json', 'jsonl', 'ndjson', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'env', 'properties', 'xml', 'plist'],
  table: ['csv', 'tsv', 'tab'],
  web: ['html', 'htm', 'xhtml'],
  email: ['eml'],
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'heif', 'tif', 'tiff', 'bmp', 'svg', 'ico', 'psd', 'ai', 'raw', 'cr2', 'nef'],
  media: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'mp4', 'mov', 'avi', 'mkv', 'webm', 'wmv'],
  archive: ['zip', 'jar'],
};
const kindOf = (ext) => Object.entries(EXT).find(([, list]) => list.includes(ext))?.[0];

const MAX_TEXT_BYTES = 4 * 1024 * 1024;    // read at most this much of a text file
const MAX_ZIP_BYTES = 150 * 1024 * 1024;   // Office files larger than this are name-only

export function extract(file, { tableRows = 25 } = {}) {
  const ext = extname(file).slice(1).toLowerCase();
  const size = statSync(file).size;
  const base = { ext, size, meta: {} };
  if (size === 0) return { ...base, kind: 'empty', text: '', title: '', method: 'empty' };
  try {
    const out = read(file, ext, size, tableRows);
    const text = out.text ?? '';
    return { ...base, ...out, text, title: out.title || firstLine(text) };
  } catch (err) {
    return { ...base, kind: kindOf(ext) ?? 'binary', text: '', title: '', method: 'name-only', error: String(err.message ?? err).slice(0, 200) };
  }
}

function read(file, ext, size, tableRows) {
  if (['docx', 'docm', 'dotx'].includes(ext)) return guardZip(size, () => ({ kind: 'document', method: 'docx', ...docxText(readFileSync(file)) }));
  if (['pptx', 'pptm', 'potx'].includes(ext)) return guardZip(size, () => ({ kind: 'presentation', method: 'pptx', ...pptxText(readFileSync(file)) }));
  if (['xlsx', 'xlsm', 'xltx'].includes(ext)) return guardZip(size, () => tableResult(xlsxSheets(readFileSync(file)), 'xlsx', tableRows));
  if (['odt', 'ods', 'odp'].includes(ext)) return guardZip(size, () => ({ kind: ext === 'ods' ? 'spreadsheet' : ext === 'odp' ? 'presentation' : 'document', method: 'odf', ...odfText(readFileSync(file)) }));
  if (ext === 'pdf') {
    const { text, method } = pdfText(readFileSync(file), file);
    return { kind: 'document', method: text ? method : 'name-only', text, meta: text ? {} : { note: 'no text layer (scanned?)' } };
  }
  const kind = kindOf(ext);
  if (kind === 'image' || kind === 'media') return { kind, method: 'name-only', text: '' };
  if (kind === 'archive') return guardZip(size, () => {
    const names = [...listZip(readFileSync(file)).keys()].filter((n) => !n.endsWith('/'));
    return { kind: 'archive', method: 'zip-listing', text: `Archive with ${names.length} files:\n${names.slice(0, 200).join('\n')}` };
  });
  const buf = readHead(file, Math.min(size, MAX_TEXT_BYTES));
  if (!kind && looksBinary(buf)) return { kind: 'binary', method: 'name-only', text: '' };
  const raw = decodeText(buf);
  if (kind === 'table') {
    const delim = ext === 'csv' ? sniffDelimiter(raw) : '\t';
    const rows = parseDelimited(raw, delim);
    return tableResult([{ name: basename(file), rows }], ext, tableRows, size > MAX_TEXT_BYTES);
  }
  if (kind === 'email') return { kind: 'email', method: 'eml', ...parseEmail(raw) };
  if (kind === 'web') {
    const title = decodeXml(raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').trim();
    return { kind: 'web', method: 'html', title, text: htmlToText(raw) };
  }
  if (ext === 'rtf') return { kind: 'document', method: 'rtf', text: rtfToText(raw) };
  return { kind: kind === 'code' || kind === 'config' ? 'code' : 'text', method: 'text', text: raw };
}

function guardZip(size, fn) {
  if (size > MAX_ZIP_BYTES) return { kind: 'binary', method: 'name-only', text: '', meta: { note: 'too large to open' } };
  return fn();
}

function readHead(file, n) {
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(n);
    const got = readSync(fd, buf, 0, n, 0);
    return buf.subarray(0, got);
  } finally { closeSync(fd); }
}

function looksBinary(buf) {
  const head = buf.subarray(0, 8000);
  if (head[0] === 0xff && head[1] === 0xfe) return false; // UTF-16 text
  if (head[0] === 0xfe && head[1] === 0xff) return false;
  let nul = 0, ctrl = 0;
  for (const b of head) { if (b === 0) nul++; else if (b < 9 || (b > 13 && b < 32)) ctrl++; }
  return nul > 0 || ctrl > head.length * 0.1;
}

export function decodeText(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  if (buf[0] === 0xfe && buf[1] === 0xff) { const b = Buffer.from(buf.subarray(2)); b.swap16(); return b.toString('utf16le'); }
  const utf8 = buf.toString('utf8').replace(/^﻿/, '');
  const bad = (utf8.match(/�/g) ?? []).length;
  return bad > 3 && bad > utf8.length / 200 ? buf.toString('latin1') : utf8;
}

const firstLine = (text) => (text.split('\n').map((l) => l.replace(/^[#>*\-\s]+/, '').trim()).find((l) => l.length > 2) ?? '').slice(0, 120);

// ---------- tables ----------

function sniffDelimiter(text) {
  const head = text.split('\n').slice(0, 5).join('\n');
  const count = (c) => (head.match(new RegExp(c === '|' ? '\\|' : c, 'g')) ?? []).length;
  return [',', ';', '\t', '|'].sort((a, b) => count(b) - count(a))[0];
}

/** RFC 4180-ish: quoted fields, doubled quotes, CRLF. */
export function parseDelimited(text, delim = ',') {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

// A table becomes: the header, the first rows, and per-column samples for PII questions.
function tableResult(sheets, method, tableRows, truncated = false) {
  const parts = [];
  let table = null;
  for (const { name, rows } of sheets) {
    if (!rows.length) continue;
    const header = rows[0].map((h, i) => String(h).trim() || `column ${i + 1}`);
    const body = rows.slice(1);
    const width = Math.max(header.length, ...body.slice(0, 50).map((r) => r.length));
    parts.push(`Sheet "${name}": ${body.length}${truncated ? '+' : ''} rows x ${width} columns`);
    parts.push([header, ...body.slice(0, tableRows)].map((r) => r.map((x) => String(x).replace(/\s+/g, ' ').slice(0, 80)).join(' | ')).join('\n'));
    if (body.length > tableRows) {
      // The last rows often hold totals or notes, so show a few of them too.
      parts.push(`[... ${body.length - tableRows - 3 > 0 ? body.length - tableRows - 3 : 0} rows skipped ...]`);
      parts.push(body.slice(Math.max(tableRows, body.length - 3)).map((r) => r.map((x) => String(x).replace(/\s+/g, ' ').slice(0, 80)).join(' | ')).join('\n'));
    }
    if (!table) {
      table = {
        sheet: name,
        rows: body.length,
        columns: header.slice(0, 60).map((h, i) => ({
          name: h,
          samples: [...new Set(body.map((r) => String(r[i] ?? '').trim()).filter(Boolean))].slice(0, 5).map((s) => s.slice(0, 60)),
        })),
      };
    }
  }
  // Title: a named sheet ("budget 2026"), otherwise the first column names.
  const named = method === 'xlsx' && table && !/^sheet\s*\d*$/i.test(table.sheet) ? table.sheet : null;
  const title = named ?? (table ? `Table of ${table.rows} rows: ${table.columns.slice(0, 5).map((c) => c.name).join(', ')}${table.columns.length > 5 ? ', …' : ''}` : '');
  return { kind: method === 'xlsx' ? 'spreadsheet' : 'table', method, title, text: parts.join('\n'), table, meta: { sheets: sheets.map((s) => s.name) } };
}

// ---------- email ----------

export function parseEmail(raw) {
  const split = raw.search(/\r?\n\r?\n/);
  const headText = split < 0 ? raw : raw.slice(0, split);
  const headers = {};
  for (const line of headText.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const m = line.match(/^([\w-]+):\s*(.*)$/);
    if (m) headers[m[1].toLowerCase()] = decodeHeader(m[2]);
  }
  const body = emailBody(headers, split < 0 ? '' : raw.slice(split).trimStart());
  const keep = ['from', 'to', 'cc', 'date', 'subject'].filter((h) => headers[h]).map((h) => `${h[0].toUpperCase()}${h.slice(1)}: ${headers[h]}`);
  return { title: headers.subject ?? '', text: `${keep.join('\n')}\n\n${body}`.trim(), meta: { from: headers.from, date: headers.date } };
}

function emailBody(headers, body) {
  const type = headers['content-type'] ?? 'text/plain';
  const boundary = type.match(/boundary="?([^";]+)"?/i)?.[1];
  if (boundary) {
    const parts = body.split(`--${boundary}`).slice(1).filter((p) => !p.startsWith('--'));
    const parsed = parts.map((p) => {
      const cut = p.search(/\r?\n\r?\n/);
      const h = {};
      for (const line of p.slice(0, cut).replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
        const m = line.match(/^([\w-]+):\s*(.*)$/);
        if (m) h[m[1].toLowerCase()] = m[2];
      }
      return { h, body: cut < 0 ? '' : p.slice(cut).trim() };
    });
    const plain = parsed.find((p) => /text\/plain/i.test(p.h['content-type'] ?? ''));
    const html = parsed.find((p) => /text\/html/i.test(p.h['content-type'] ?? ''));
    const nested = parsed.find((p) => /multipart\//i.test(p.h['content-type'] ?? ''));
    const attachments = parsed.map((p) => (p.h['content-disposition'] ?? '').match(/filename="?([^";]+)"?/i)?.[1]).filter(Boolean);
    const main = plain ? decodeTransfer(plain.h, plain.body)
      : html ? htmlToText(decodeTransfer(html.h, html.body))
      : nested ? emailBody(nested.h, nested.body) : '';
    return attachments.length ? `${main}\n\nAttachments: ${attachments.join(', ')}` : main;
  }
  const text = decodeTransfer(headers, body);
  return /text\/html/i.test(type) ? htmlToText(text) : text;
}

function decodeTransfer(h, body) {
  const enc = (h['content-transfer-encoding'] ?? '').toLowerCase();
  if (enc === 'base64') return Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8');
  if (enc === 'quoted-printable') {
    const bytes = body.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, x) => String.fromCharCode(parseInt(x, 16)));
    return Buffer.from(bytes, 'latin1').toString('utf8');
  }
  return body;
}

function decodeHeader(v) {
  return v.replace(/=\?([^?]+)\?([BQ])\?([^?]*)\?=/gi, (_, _charset, enc, data) => enc.toUpperCase() === 'B'
    ? Buffer.from(data, 'base64').toString('utf8')
    : Buffer.from(data.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (__, x) => String.fromCharCode(parseInt(x, 16))), 'latin1').toString('utf8'));
}

// ---------- html / rtf ----------

export function htmlToText(html) {
  return decodeXml(html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/title)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' '))
    .replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function rtfToText(rtf) {
  return rtf
    .replace(/\\par[d]?/g, '\n')
    .replace(/\\'([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\{\\\*[^{}]*\}/g, '')
    .replace(/\\[a-z]+-?\d* ?/gi, '')
    .replace(/[{}]/g, '')
    .replace(/\n{3,}/g, '\n\n').trim();
}
