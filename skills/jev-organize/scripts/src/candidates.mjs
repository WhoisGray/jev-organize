// "Pick, don't extract". Jev never writes text, so it can't copy a date or a company name
// out of a document. Code finds every plausible value, and Jev chooses the right one.
// Each candidate keeps the words around it, because "Invoice date" vs "Due date" is what
// tells them apart.

// Month names by their first three letters: English, German, Dutch, French, Spanish, Italian.
const MONTHS = {
  jan: 1, gen: 1, ene: 1, jän: 1, janv: 1,
  feb: 2, fév: 2, fev: 2,
  mar: 3, mär: 3, mrt: 3, maa: 3,
  apr: 4, avr: 4, abr: 4,
  may: 5, mai: 5, mei: 5, mag: 5,
  jun: 6, jui: 6, giu: 6,
  jul: 7, lug: 7,
  aug: 8, aoû: 8, aou: 8, ago: 8,
  sep: 9, set: 9,
  oct: 10, okt: 10, ott: 10,
  nov: 11,
  dec: 12, dez: 12, déc: 12, dic: 12,
};
const monthOf = (word) => {
  const w = word.toLowerCase().normalize('NFC');
  if (w.startsWith('juil')) return 7; // French juillet vs juin
  if (w.startsWith('juin')) return 6;
  return MONTHS[w.slice(0, 4)] ?? MONTHS[w.slice(0, 3)];
};

const iso = (y, m, d) => {
  y = Number(y); m = Number(m); d = Number(d);
  if (y < 1980 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

function collect(text, finders, max) {
  const found = new Map(); // normalised value -> context of its first appearance
  for (const [re, normalise] of finders) {
    for (const m of text.matchAll(re)) {
      const value = normalise(m);
      if (!value || found.has(value)) continue;
      found.set(value, text.slice(Math.max(0, m.index - 50), m.index + m[0].length + 25).replace(/\s+/g, ' ').trim());
      if (found.size >= max) break;
    }
  }
  return [...found].map(([value, context]) => ({ value, context }));
}

const WORD = '([A-Za-zÀ-ÿ]{3,10})';

/** Dates as ISO strings. `order` decides how 03/04/2026 is read: 'dmy' (default) or 'mdy'. */
export function dateCandidates(text, { order = 'dmy', max = 25 } = {}) {
  return collect(text, [
    [/\b(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2})?/g, (m) => iso(m[1], m[2], m[3])],
    [new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\.?\\s+(?:of\\s+)?${WORD}\\.?,?\\s+(\\d{4})\\b`, 'g'), (m) => monthOf(m[2]) && iso(m[3], monthOf(m[2]), m[1])],
    [new RegExp(`\\b${WORD}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, 'g'), (m) => monthOf(m[1]) && iso(m[3], monthOf(m[1]), m[2])],
    [/\b(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b/g, (m) => (order === 'mdy' ? iso(m[3], m[1], m[2]) : iso(m[3], m[2], m[1]))],
    [/\b(\d{4})[/.](\d{1,2})[/.](\d{1,2})\b/g, (m) => iso(m[1], m[2], m[3])],
  ], max);
}

// Legal-form suffixes that mark a company name.
const SUFFIX = String.raw`(?:Ltd\.?|Limited|LLP|LLC|L\.L\.C\.|Inc\.?|Incorporated|Corp\.?|Corporation|Co\.|Company|GmbH|AG|KG|B\.?V\.?|N\.?V\.?|S\.A\.S\.?|SAS|S\.A\.?|SA|SARL|S\.?r\.?l\.?|S\.?p\.?A\.?|PLC|plc|Pty(?:\.? Ltd\.?)?|Oy|AB|ApS|AS|A/S|Group|Holdings|Partners|LLP)`;
const NAME_WORD = String.raw`(?:[A-Z][\w'’.-]*|&|and|of|de|van|der|den|la|le|du)`;
// Words of one name sit on one line, one or two spaces apart. Wider gaps are PDF columns.
const ORG_RE = new RegExp(String.raw`\b([A-Z][\w'’.-]*(?: {1,2}${NAME_WORD}){0,5}?) {1,2}(${SUFFIX})(?![\w])`, 'g');
const LEAD_NOISE = /^(?:The|From|To|Between|And|Dear|Attn|Re|Invoice|Bill|Ship|Sold|Supplier|Customer|Client|Vendor|Buyer|Seller|Party|Parties|Page|Our|Your|This|For|Order|Quote|Purchase|Payment|Agreement|Contract|Statement|Receipt)\s+/i;

// "Cairn & Co Outfitters", "Smith & Sons", "Baker & Partners Design".
const AMP_RE = /(?<!& {0,2})\b([A-Z][A-Za-z'’-]+(?: {1,2}[A-Z][A-Za-z'’-]+){0,3} {1,2}& {1,2}(?:Co\b\.?|Sons\b|Partners\b|Associates\b|[A-Z][A-Za-z'’-]+)(?: {1,2}[A-Z][A-Za-z'’-]+){0,2})/g;
// Names that end in a business noun: "Harbourside Print Studio", "Oakridge Logistics".
const NOUNS = 'Outfitters|Retail|Retailers|Logistics|Services|Textiles|Packaging|Supplies|Solutions|Systems|Consulting|Consultants|Trading|Studio|Studios|Events|Print|Printing|Media|Digital|Technologies|Technology|Labs|Bank|Insurance|Properties|Property|Associates|Accountants|Recruitment|Agency|Foods|Freight|Couriers|Cleaning|Stores|Outdoors|Manufacturing|Industries|Distribution|Wholesale|Networks|Software|Analytics|Ventures|Capital|Investments|Advisory|Architects|Engineering|Construction|Energy|Healthcare|Pharma|Travel|Hotels|Motors|Interiors|Clinic|Laboratories|Transport|Haulage|Fulfilment|Fulfillment|Couriers';
const NOUN_RE = new RegExp(String.raw`(?<!& {0,2})\b((?:[A-Z][A-Za-z'’-]+ {1,2}){1,4}(?:${NOUNS}))\b`, 'g');
// Words that start headings and phrases, not company names ("Customer Services", "Our Solutions").
const GENERIC = new Set('the our your their this that a an and for from to of in on at by with customer customers client clients business professional financial support it technical cloud digital data online field product sales marketing account accounts shared managed internal external general other all new key core total monthly annual additional logistics delivery shipping payment security legal hr people team staff employee employees company head main regional local national global web website email office facilities warehouse retail wholesale print event events media travel energy health property properties insurance software systems services solutions supplies trading distribution transport'.split(' '));

// Job titles look like names: "Operations & People Manager".
const TITLES = /\b(Manager|Director|Officer|Lead|Head|Assistant|Coordinator|Executive|Engineer|Analyst|Specialist|Administrator|Controller|Partner|Buyer|Planner|Supervisor|Associate|Intern|CEO|CFO|CTO|COO|FD)$/;
const legalSuffix = new RegExp(String.raw`[ \t]+(${SUFFIX})$`, 'i');
/** A key that treats "Northfell Textiles Ltd", "Northfell Textiles Ltd." and "Northfell Textiles" as one. */
export const orgKey = (name) => name.replace(legalSuffix, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
/** The name without "Ltd", "GmbH" and the like, when something is left. */
export const withoutSuffix = (name) => { const s = name.replace(legalSuffix, '').trim(); return s.split(' ').length >= 2 || s.length >= 6 ? s : name; };

/** Organisation names found in the text, plus known names (config or seen elsewhere in the corpus) that appear in it. */
export function orgCandidates(text, { known = [], exclude = [], max = 20 } = {}) {
  const lowerText = text.toLowerCase();
  const excludedKeys = exclude.filter(Boolean).map(orgKey);
  const excluded = (name) => { const k = orgKey(name); return !k || excludedKeys.some((x) => x && (k === x || k.includes(x) || x.includes(k))); };
  const found = new Map(); // key -> { value, context, index }
  const add = (name, index, len) => {
    name = name.replace(/\s+/g, ' ').trim().replace(/[.,;:]$/, '');
    while (LEAD_NOISE.test(name)) name = name.replace(LEAD_NOISE, '');
    const words = name.split(' ');
    if (words.length < 2 || name.length > 70 || excluded(name)) return;
    if (words.every((w) => GENERIC.has(w.toLowerCase().replace(/[^a-z]/g, '')) || w === '&')) return;
    if (TITLES.test(name)) return;
    const key = orgKey(name);
    const prev = found.get(key);
    const context = text.slice(Math.max(0, index - 40), index + len + 25).replace(/\s+/g, ' ').trim();
    if (!prev) found.set(key, { value: name, context, index });
    else if (name.length > prev.value.length || (name.length === prev.value.length && prev.value === prev.value.toUpperCase() && name !== name.toUpperCase())) {
      prev.value = name; // keep the fullest form, and "Tidewell Packaging GmbH" over "TIDEWELL PACKAGING GMBH"
    }
  };
  for (const name of known) {
    const i = lowerText.indexOf(name.toLowerCase());
    if (i >= 0) add(text.slice(i, i + name.length), i, name.length);
  }
  for (const m of text.matchAll(ORG_RE)) add(`${m[1]} ${m[2]}`, m.index, m[0].length);
  for (const m of text.matchAll(AMP_RE)) add(m[1], m.index, m[0].length);
  for (const m of text.matchAll(NOUN_RE)) add(m[1], m.index, m[0].length);
  // Drop fragments of a longer name found in the same text ("Co Outfitters" in "Cairn & Co Outfitters").
  const all = [...found];
  const kept = all.filter(([k]) => !all.some(([other]) => other !== k && ` ${other} `.includes(` ${k} `)));
  return kept.map(([, v]) => v).sort((a, b) => a.index - b.index).slice(0, max).map(({ value, context }) => ({ value, context }));
}

/** Choice criteria built from candidates, plus a way out. Ids are c0, c1, ... */
export const asOptions = (candidates, none) => ({
  ...Object.fromEntries(candidates.map((c, i) => [`c${i}`, `${c.value}   (in: "...${c.context}...")`])),
  none,
});
