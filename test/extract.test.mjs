import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extract, parseEmail, parseDelimited } from '../src/extract/index.mjs';
import { listZip, readZipEntry, writeZip } from '../src/extract/zip.mjs';
import { makePdf, builtinPdfText } from '../src/extract/pdf.mjs';
import { makeDocx, makeXlsx, makePptx } from '../scripts/office-writer.mjs';

const dir = mkdtempSync(join(tmpdir(), 'jev-organize-extract-'));
const put = (name, data) => { const f = join(dir, name); writeFileSync(f, data); return f; };

test('zip round trip', () => {
  const buf = writeZip({ 'a.txt': 'hello', 'dir/b.xml': '<x>é</x>' });
  const entries = listZip(buf);
  assert.deepEqual([...entries.keys()], ['a.txt', 'dir/b.xml']);
  assert.equal(readZipEntry(buf, entries, 'dir/b.xml').toString(), '<x>é</x>');
});

test('docx text and title', () => {
  const r = extract(put('memo.docx', makeDocx('# Supplier agreement\nSigned on 2 March 2026 & dated.\n\nSecond paragraph <ok>', { title: 'Agreement' })));
  assert.equal(r.kind, 'document');
  assert.match(r.text, /Supplier agreement\nSigned on 2 March 2026 & dated\./);
  assert.match(r.text, /Second paragraph <ok>/);
  assert.equal(r.meta.title, 'Agreement');
});

test('xlsx sheets become a table with column samples', () => {
  const rows = [['Name', 'Email', 'Salary'], ['Ann Lee', 'ann@example.com', '52000'], ['Bo Kim', 'bo@example.com', '61000']];
  const r = extract(put('staff.xlsx', makeXlsx(rows, { sheet: 'Staff' })));
  assert.equal(r.kind, 'spreadsheet');
  assert.match(r.text, /Sheet "Staff": 2 rows x 3 columns/);
  assert.match(r.text, /Ann Lee \| ann@example.com \| 52000/);
  assert.deepEqual(r.table.columns.map((c) => c.name), ['Name', 'Email', 'Salary']);
  assert.deepEqual(r.table.columns[2].samples, ['52000', '61000']);
});

test('pptx slides in order', () => {
  const r = extract(put('deck.pptx', makePptx([{ title: 'Q2 board update', bullets: ['Revenue up 12%'] }, { title: 'Hiring', bullets: ['3 roles open'] }])));
  assert.equal(r.kind, 'presentation');
  assert.match(r.text, /Slide 1:\nQ2 board update\n• Revenue up 12%[\s\S]*Slide 2:\nHiring/);
});

test('pdf: built-in reader gets text back from a generated PDF', () => {
  const pdf = makePdf(['Invoice INV-2026-0418', 'Total due: GBP 1,240.00 (incl. VAT)', 'Café Straße']);
  const text = builtinPdfText(pdf);
  assert.match(text, /Invoice INV-2026-0418\nTotal due: GBP 1,240\.00 \(incl\. VAT\)/);
  assert.match(text, /Café Straße/);
  const r = extract(put('scan.pdf', pdf));
  assert.match(r.text, /INV-2026-0418/);
});

test('csv with semicolons and quotes', () => {
  assert.deepEqual(parseDelimited('a;b\n"x;1";"say ""hi"""\n', ';'), [['a', 'b'], ['x;1', 'say "hi"']]);
  const r = extract(put('leads.csv', 'company;contact\nAcme BV;jan@acme.nl\n'));
  assert.equal(r.kind, 'table');
  assert.equal(r.table.columns[1].name, 'contact');
});

test('email: headers, multipart, quoted-printable, attachments', () => {
  const raw = [
    'From: Jo <jo@northfell.co.uk>', 'To: ap@kestrel.example', 'Subject: =?UTF-8?B?SW52b2ljZSBkdWU=?=', 'Date: Tue, 14 Apr 2026 09:12:00 +0100',
    'Content-Type: multipart/mixed; boundary="XYZ"', '', '--XYZ', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: quoted-printable', '',
    'Please pay =C2=A31,240 by 30 April.', '--XYZ', 'Content-Type: application/pdf', 'Content-Disposition: attachment; filename="INV-0418.pdf"', '', 'JVBERi0=', '--XYZ--',
  ].join('\r\n');
  const r = parseEmail(raw);
  assert.equal(r.title, 'Invoice due');
  assert.match(r.text, /From: Jo <jo@northfell.co.uk>/);
  assert.match(r.text, /Please pay £1,240 by 30 April\./);
  assert.match(r.text, /Attachments: INV-0418\.pdf/);
});

test('binary, empty and image files do not throw', () => {
  assert.equal(extract(put('blob.bin', Buffer.from([0, 1, 2, 3, 0, 0]))).method, 'name-only');
  assert.equal(extract(put('empty.txt', '')).kind, 'empty');
  assert.equal(extract(put('photo.jpg', Buffer.from([0xff, 0xd8, 0xff]))).kind, 'image');
  assert.equal(extract(put('broken.docx', 'not a zip')).method, 'name-only');
});

test('html and utf-16 text', () => {
  const r = extract(put('page.html', '<html><head><title>Trail tents</title><style>p{}</style></head><body><h1>Our tents</h1><p>Light &amp; strong</p></body></html>'));
  assert.equal(r.title, 'Trail tents');
  assert.match(r.text, /Our tents\nLight & strong/);
  const u16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Hello UTF-16', 'utf16le')]);
  assert.equal(extract(put('u16.txt', u16)).text, 'Hello UTF-16');
});
