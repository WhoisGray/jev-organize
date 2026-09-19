// One Jev call per file. The state is the file's (redacted) text and path; the questions
// are the taxonomy from the config. Code decides everything Jev can't: dates and company
// names are picked from candidates, sensitive values set a floor, thresholds route
// uncertain files to review.
import { askWithUsage, choice, noul, ranked, JevError } from './jev.mjs';
import { dateCandidates, orgCandidates, asOptions } from './candidates.mjs';
import { scan, sensitivityFloor } from './detect.mjs';
import { describe } from './config.mjs';

const LEVELS = ['public', 'internal', 'confidential', 'restricted'];
const MAX_COLUMNS = 40;
// A table column of these makes the whole file restricted, whatever the rest of it says.
const RESTRICTED_COLUMNS = new Set(['national_id', 'bank_card', 'salary', 'health', 'credentials']);

const humanSize = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

function clip(text, max) {
  if (text.length <= max) return { text, truncated: false };
  const head = Math.floor(max * 0.75), tail = max - head;
  return { text: `${text.slice(0, head)}\n[... ${(text.length - max).toLocaleString('en-US')} characters skipped ...]\n${text.slice(-tail)}`, truncated: true };
}

/** Everything that doesn't need Jev: redaction, detector counts, candidates. */
export function prepare(item, cfg, { namesOnly = false, company = cfg.company, known = [] } = {}) {
  const ex = item.extract;
  const raw = ex.text ?? '';
  const detected = scan(raw, { redact: cfg.redact });
  const fullText = detected.text;
  const own = [company.name, ...(company.aliases ?? [])].filter(Boolean);
  const dates = namesOnly ? [] : dateCandidates(fullText, { order: cfg.date_order });
  const orgs = namesOnly ? [] : orgCandidates(fullText, { known: [...(cfg.known_entities ?? []), ...known], exclude: own });
  const columns = namesOnly || !ex.table ? [] : ex.table.columns.slice(0, MAX_COLUMNS).map((c) => ({
    name: c.name,
    samples: c.samples.map((s) => scan(s, { redact: cfg.redact }).text),
  }));
  return { detected, fullText, dates, orgs, columns };
}

export function buildRequest(item, cfg, prep, { namesOnly = false, maxChars = cfg.max_chars, company = cfg.company } = {}) {
  const ex = item.extract;
  const hasText = !namesOnly && prep.fullText.trim().length > 0;
  const { text, truncated } = clip(hasText ? prep.fullText : '', maxChars);
  const found = Object.fromEntries(Object.entries(prep.detected.counts).filter(([, n]) => n > 0));
  const state = {
    ...(company.name ? { our_company: { name: company.name, ...(company.aliases?.length ? { also_known_as: company.aliases } : {}), ...(company.about ? { about: company.about } : {}) } } : {}),
    file: {
      path: item.path,
      kind: ex.kind,
      size: humanSize(item.size),
      ...(ex.meta?.title ? { title: ex.meta.title } : {}),
      ...(ex.meta?.slides ? { slides: ex.meta.slides } : {}),
      ...(ex.table ? { rows: ex.table.rows, columns: ex.table.columns.length } : {}),
    },
    content: hasText ? text : namesOnly ? '(content not sent: classify from the file path only)' : `(no readable text in this ${ex.kind} file: classify from the file path only)`,
    ...(truncated ? { content_note: `Long file: shows the start and the end, ${maxChars.toLocaleString('en-US')} of ${prep.fullText.length.toLocaleString('en-US')} characters` } : {}),
    ...(Object.keys(found).length ? { sensitive_values_found: found, note: cfg.redact ? 'Sensitive values in `content` were replaced by placeholders such as [email at domain], [PHONE], [IBAN] or [SECRET] before sending.' : undefined } : {}),
  };
  const judge = 'Judge mainly by `content`. The file path and name are hints and can be wrong or misleading.';
  const questions = {
    department: choice({ task: 'Which business function owns the file described in `file` and `content`?', rules: cfg.department_rules, note: judge }, describe(cfg.departments)),
    type: choice({ task: 'What kind of document or file is it?', rules: cfg.type_rules, note: judge }, describe(cfg.types)),
    sensitivity: choice({ task: 'How sensitive is this file if it leaked outside the company?', rules: cfg.sensitivity_rules }, describe(cfg.sensitivity)),
    noise: noul('The file has no business value: it is empty, a placeholder, a test or scratch file, random characters, or a temporary or system file.'),
    'flag:personal_data': noul('`content` contains personal data about identifiable people: a name together with contact details, home address, salary, performance review, ID number, date of birth or health information.'),
    'flag:credentials': noul('`content` contains passwords, API keys, access tokens, private keys or other secrets that give access to systems (a [SECRET] placeholder counts).'),
    'flag:payment_details': noul('`content` contains bank account numbers, IBANs or card numbers (an [IBAN] or [CARD NUMBER] placeholder counts).'),
  };
  for (const [id, desc] of Object.entries(cfg.tags ?? {})) questions[`tag:${id}`] = noul(`Tag "${id}": ${desc}`);
  if (prep.dates.length) {
    questions.date = choice(
      'Which date is the date of the document itself: when it was written, issued, sent or signed? Not a due date, delivery date, start or end of a term, period covered, date of birth or a date mentioned in passing. For an email, the Date header. For minutes, agendas and decks made for a meeting, the meeting date. If the document has no date of its own, choose none.',
      asOptions(prep.dates, 'None of these is the date of the document itself'),
    );
  }
  if (prep.orgs.length) {
    const ours = company.name ? `${company.name} is our own company: never choose it. ` : 'Never choose the company that owns these files. ';
    questions.counterparty = choice(
      `Which outside organisation is this file mainly with or about: the supplier who sent an invoice, the customer who gets a quote or order, the other party to a contract, the firm that wrote a letter? ${ours}Choose none for internal documents such as minutes, plans, policies, reports, budgets and HR records, even when they mention suppliers or customers.`,
      asOptions(prep.orgs, 'None: internal document, or no main outside organisation'),
    );
  }
  prep.columns.forEach((c, i) => {
    questions[`col:${i}`] = choice(`What kind of data does the table column "${c.name}" hold? Sample values: ${JSON.stringify(c.samples)}`, describe(cfg.column_types));
  });
  return { state, questions };
}

/** Ask Jev, shrinking the request when it doesn't fit Jev's context. */
export async function askFor(item, cfg, prep, opts = {}) {
  let maxChars = opts.maxChars ?? cfg.max_chars;
  for (let attempt = 0; ; attempt++) {
    const { state, questions } = buildRequest(item, cfg, prep, { ...opts, maxChars });
    try {
      return await askWithUsage(state, questions);
    } catch (err) {
      if (err instanceof JevError && (err.code === 'too_large' || err.status === 400) && attempt < 3 && maxChars > 800) {
        maxChars = Math.floor(maxChars / 2);
        if (attempt >= 1) prep = { ...prep, columns: prep.columns.slice(0, 10), orgs: prep.orgs.slice(0, 8), dates: prep.dates.slice(0, 10) };
        continue;
      }
      throw err;
    }
  }
}

/** Turn Jev's answers (plus detector results) into the catalog record's classification. */
export function interpret(answers, prep, cfg) {
  const t = cfg.thresholds;
  const top = (a) => ({ id: a.choice, confidence: round(a.confidence ?? ranked(a)[0]?.[1] ?? 0), runner_up: ranked(a)[1]?.[0] ?? null });
  const department = top(answers.department);
  const type = top(answers.type);
  let sensitivity = top(answers.sensitivity);
  const flags = {
    personal_data: round(answers['flag:personal_data']?.noul ?? 0),
    credentials: round(answers['flag:credentials']?.noul ?? 0),
    payment_details: round(answers['flag:payment_details']?.noul ?? 0),
  };
  const reasons = [];
  const floor = sensitivityFloor(prep.detected.counts);
  const columns = prep.columns.map((c, i) => ({ name: c.name, data: answers[`col:${i}`]?.choice ?? 'none', confidence: round(answers[`col:${i}`]?.confidence ?? 0) }));
  const sensitiveColumns = columns.filter((c) => RESTRICTED_COLUMNS.has(c.data) && c.confidence >= 0.6);
  // Restricted needs evidence: a detector hit, a flag, or a confident answer. Otherwise it's
  // usually a file that only mentions a sensitive topic ("don't keep passwords in notes").
  const evidence = floor || sensitiveColumns.length || Math.max(flags.personal_data, flags.credentials, flags.payment_details) >= t.flag;
  if (sensitivity.id === 'restricted' && !evidence && sensitivity.confidence < 0.8) {
    const next = ranked(answers.sensitivity).find(([id]) => id !== 'restricted')?.[0];
    if (next) { sensitivity = { ...sensitivity, id: next, lowered_from: 'restricted' }; reasons.push('lowered from restricted: no personal data, credentials or payment details found'); }
  }
  // Sensitivity can only go up from here: detectors and flags set a floor.
  let raisedFrom = null;
  if (floor) raise(floor.level, `detected ${floor.reason}`);
  if (flags.credentials >= t.flag) raise('restricted', 'contains credentials');
  if (sensitiveColumns.length) raise('restricted', `columns with ${[...new Set(sensitiveColumns.map((c) => c.data.replace('_', ' ')))].join(', ')}`);
  function raise(level, why) {
    if (LEVELS.indexOf(level) > LEVELS.indexOf(sensitivity.id)) {
      raisedFrom ??= sensitivity.id;
      sensitivity = { ...sensitivity, id: level, raised_from: raisedFrom };
      reasons.push(why);
    }
  }
  const tags = Object.keys(cfg.tags ?? {}).filter((id) => (answers[`tag:${id}`]?.noul ?? 0) >= t.tag);
  const pick = (a, list) => (a && a.choice !== 'none' ? { value: list[Number(a.choice.slice(1))].value, confidence: round(a.confidence) } : null);
  const date = pick(answers.date, prep.dates);
  const counterparty = pick(answers.counterparty, prep.orgs);
  const noise = round(answers.noise?.noul ?? 0);
  return {
    department, type, sensitivity: { ...sensitivity, ...(reasons.length ? { reasons } : {}) },
    date: date?.value ?? null, date_confidence: date?.confidence ?? null,
    counterparty: counterparty?.value ?? null, counterparty_confidence: counterparty?.confidence ?? null,
    tags, flags, noise,
    ...(columns.length ? { pii_columns: columns.filter((c) => c.data !== 'none') } : {}),
  };
}

const round = (x) => Math.round(x * 1000) / 1000;
