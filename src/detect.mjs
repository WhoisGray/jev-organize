// Deterministic detectors for sensitive values. They do two jobs:
//  1. Redaction: by default these values are masked before any text leaves your machine.
//  2. A sensitivity floor: a file with a card number or a password is "restricted" no matter
//     what the text claims about itself, so a prompt injection can't talk it down.
// Values are never stored, only counts.

const luhn = (digits) => {
  let sum = 0, dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (dbl) { d *= 2; if (d > 9) d -= 9; }
    sum += d; dbl = !dbl;
  }
  return sum % 10 === 0;
};

const ibanOk = (raw) => {
  const s = raw.replace(/\s+/g, '').toUpperCase();
  if (s.length < 15 || s.length > 34) return false;
  const moved = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rem = 0;
  for (const ch of moved) rem = (rem * 10 + Number(ch)) % 97;
  return rem === 1;
};

const SECRET_WORDS = 'password|passwd|pwd|pass|secret|api[_-]?key|apikey|access[_-]?key|secret[_-]?key|client[_-]?secret|auth[_-]?token|access[_-]?token|token|private[_-]?key|credentials?';
const PLACEHOLDER = /^(?:\$|<|\{|%|\*{3,}|x{3,}|\.{3,}|changeme|password|secret|your[_-]|example|none|null|true|false|redacted)/i;

// Each detector: [type, regex, validate(match) -> bool, mask(match) -> string]
const DETECTORS = [
  ['secret', /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, () => true, () => '[PRIVATE KEY]'],
  ['secret', /\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}|sk_live_[A-Za-z0-9]{16,}|rk_live_[A-Za-z0-9]{16,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/g, () => true, () => '[SECRET]'],
  ['secret', new RegExp(`(?<![A-Za-z0-9])(${SECRET_WORDS})(["']?\\s*[:=]\\s*["']?)([^\\s"',;]{6,})`, 'gi'), (m) => !PLACEHOLDER.test(m[3]) && /[\d]/.test(m[3]) && /[A-Za-z]/.test(m[3]), (m) => `${m[1]}${m[2]}[SECRET]`],
  ['iban', /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?\b/g, (m) => ibanOk(m[0]), () => '[IBAN]'],
  ['card', /\b(?:\d[ -]?){12,18}\d\b/g, (m) => { const d = m[0].replace(/\D/g, ''); return d.length >= 13 && d.length <= 19 && /^[3-6]/.test(d) && !/^(\d)\1+$/.test(d) && luhn(d); }, () => '[CARD NUMBER]'],
  ['national_id', /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g, () => true, () => '[NATIONAL ID]'],
  ['national_id', /\b(?!BG|GB|NK|KN|TN|NT|ZZ)[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z] ?\d{2} ?\d{2} ?\d{2} ?[A-D]\b/g, () => true, () => '[NATIONAL ID]'],
  ['email', /\b[A-Z0-9._%+-]+@((?:[A-Z0-9-]+\.)+[A-Z]{2,})\b/gi, () => true, (m) => `[email at ${m[1].toLowerCase()}]`],
  ['phone', /(?<![\w+])(?:\+\d{1,3}[ .-]?|\(0\d{1,4}\)[ .-]?|0)\d{1,4}(?:[ .-]?\d{2,4}){2,4}(?![\w])/g, (m) => { const n = m[0].replace(/\D/g, '').length; return n >= 9 && n <= 15; }, () => '[PHONE]'],
];

export const DETECTOR_TYPES = ['secret', 'card', 'iban', 'national_id', 'email', 'phone'];

/** Count sensitive values and optionally mask them. Returns { counts, domains, text }. */
export function scan(text, { redact = true } = {}) {
  const counts = Object.fromEntries(DETECTOR_TYPES.map((t) => [t, 0]));
  const domains = new Set();
  let out = text;
  for (const [type, re, valid, mask] of DETECTORS) {
    out = out.replace(re, (...args) => {
      const m = args.slice(0, -2); // [full, ...groups]; replace also passes offset and string
      if (!valid(m)) return m[0];
      counts[type]++;
      if (type === 'email') domains.add(m[1].toLowerCase());
      return redact ? mask(m) : m[0];
    });
  }
  return { counts, domains: [...domains], text: out };
}

/** The lowest sensitivity a file may get, from what the detectors found. */
export function sensitivityFloor(counts) {
  if (counts.secret || counts.card || counts.national_id) return { level: 'restricted', reason: [counts.secret && 'secrets', counts.card && 'card numbers', counts.national_id && 'national ID numbers'].filter(Boolean).join(', ') };
  if (counts.iban) return { level: 'confidential', reason: 'bank account numbers' };
  return null;
}
