import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scan, sensitivityFloor } from '../src/detect.mjs';
import { dateCandidates, orgCandidates } from '../src/candidates.mjs';

test('redacts cards, IBANs, secrets, emails and phones; counts them', () => {
  const text = [
    'Card: 4111 1111 1111 1111, exp 09/28',
    'IBAN GB82 WEST 1234 5698 7654 32',
    'db_password = Kx7!pQ2rT9vL',
    'API_TOKEN=kbs_live_4f9a8c2e7d1b6a3f5e8c',
    'Contact jo.brown@northfell.co.uk or +44 117 496 0123',
    'Invoice INV-2026-0418 dated 2026-04-18, total 1,240.00',
  ].join('\n');
  const r = scan(text);
  assert.equal(r.counts.card, 1);
  assert.equal(r.counts.iban, 1);
  assert.equal(r.counts.secret, 2);
  assert.equal(r.counts.email, 1);
  assert.equal(r.counts.phone, 1);
  assert.deepEqual(r.domains, ['northfell.co.uk']);
  assert.doesNotMatch(r.text, /4111|WEST 1234|Kx7!|4f9a8c|jo\.brown|496 0123/);
  assert.match(r.text, /\[email at northfell\.co\.uk\]/);
  assert.match(r.text, /Invoice INV-2026-0418 dated 2026-04-18, total 1,240\.00/, 'ordinary numbers stay');
  assert.equal(sensitivityFloor(r.counts).level, 'restricted');
});

test('no false alarms on ordinary business numbers', () => {
  const r = scan('PO-1187 for 250 units at £12.40, order 2026-03-02, ref 00123456, VAT GB123456789, total 3,100.00, SKU 4006381333931');
  assert.deepEqual(Object.entries(r.counts).filter(([, n]) => n), []);
});

test('placeholders are not secrets; --no-redact keeps values', () => {
  assert.equal(scan('password: <your password here>\napi_key=${API_KEY}\ntoken: changeme123').counts.secret, 0);
  const kept = scan('password = Hunter2hunter2', { redact: false });
  assert.equal(kept.counts.secret, 1);
  assert.match(kept.text, /Hunter2hunter2/);
});

test('an IBAN alone makes a file confidential, not restricted', () => {
  assert.deepEqual(sensitivityFloor({ iban: 1 }), { level: 'confidential', reason: 'bank account numbers' });
  assert.equal(sensitivityFloor({ email: 5, phone: 2 }), null);
});

test('date candidates in many formats, day-first by default', () => {
  const text = 'Signed 2 March 2026. Starts April 1, 2026. Ends 31/03/2028. Rechnungsdatum: 14. März 2026. ISO 2026-05-06T10:00. Bad 45/13/2026.';
  const values = dateCandidates(text).map((d) => d.value);
  assert.deepEqual(values, ['2026-05-06', '2026-03-02', '2026-03-14', '2026-04-01', '2028-03-31']);
  assert.deepEqual(dateCandidates('Due 03/04/2026', { order: 'mdy' }).map((d) => d.value), ['2026-03-04']);
  assert.match(dateCandidates('Invoice date: 18 Apr 2026')[0].context, /Invoice date/);
});

test('organisation candidates skip our own company', () => {
  const text = 'This agreement is between Kestrel Bay Supplies Ltd and Northfell Textiles Ltd. Copy to Morrow Legal LLP and Tidewell Packaging GmbH. The Company shall pay.';
  const orgs = orgCandidates(text, { exclude: ['Kestrel Bay Supplies Ltd'], known: ['Cairn & Co Outfitters'] }).map((o) => o.value);
  assert.deepEqual(orgs, ['Northfell Textiles Ltd', 'Morrow Legal LLP', 'Tidewell Packaging GmbH']);
  assert.deepEqual(orgCandidates('Order from Cairn & Co Outfitters', { known: ['Cairn & Co Outfitters'] }).map((o) => o.value), ['Cairn & Co Outfitters']);
});

test('one candidate per organisation, in its normal casing', () => {
  const text = 'TIDEWELL PACKAGING GMBH\nRechnung Nr. 2026-045\n...\nTidewell Packaging GmbH - Geschäftsführerin: Anke Behrens';
  const orgs = orgCandidates(text, { known: ['Tidewell Packaging GmbH', 'Tidewell Packaging'] }).map((o) => o.value);
  assert.deepEqual(orgs, ['Tidewell Packaging GmbH']);
  assert.deepEqual(orgCandidates('Supplied by Cairn & Co Outfitters and Oakridge Logistics, see the Operations & People Manager.').map((o) => o.value), ['Cairn & Co Outfitters', 'Oakridge Logistics']);
});
