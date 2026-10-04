// A small client for TypeSafe's Jev decision model.
//
// Jev is not a chat model. You send a `state` (the data) and named `questions`
// (Choice, Noul or Score), and it returns typed answers with probabilities.
// TypeSafe serves it at /v1/systemone.

// Use TypeSafe's alias by default, or pin a version with JEV_MODEL.
export const DEFAULT_MODEL = 'jev-latest';
const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const RETRY = new Set([408, 429, 500, 502, 503, 524, 529]);
// TypeSafe's price for Jev 1.13: $0.042 per million input tokens, output free.
// Used for the estimate and to calculate each call's cost from returned input tokens.
export const PRICE_PER_M_INPUT = 0.042;

/** Running totals for everything this process asked Jev. */
export const usage = { calls: 0, inputTokens: 0, cost: 0, models: new Set(), ms: [] };

// Tests swap the network for a fake with setTransport(fn). fn(body) -> { status, json }.
let transport = null;
export function setTransport(fn) { transport = fn; }

async function post(body, key) {
  if (transport) return transport(body);
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON, keep text for the error */ }
  return { status: res.status, json, text };
}

export class JevError extends Error {
  constructor(message, status, code) { super(message); this.status = status; this.code = code; }
}

/** Ask Jev. Returns the `answers` map, keyed by your question ids. */
export async function ask(state, questions, opts = {}) {
  return (await askWithUsage(state, questions, opts)).answers;
}

/** Ask Jev. Returns { answers, model, cost, inputTokens } for this one call. */
export async function askWithUsage(state, questions, { model = process.env.JEV_MODEL || DEFAULT_MODEL, retries = 4 } = {}) {
  const key = process.env.TYPESAFE_API_KEY;
  if (!key && !transport) throw new JevError('TYPESAFE_API_KEY is not set. Create a key at https://console.typesafe.ai/keys and put it in .env or your shell.', 0, 'no_key');
  for (let attempt = 0; ; attempt++) {
    const t0 = Date.now();
    let res;
    try {
      res = await post({ model, state, questions }, key);
    } catch (err) { // connection dropped before a response: safe to retry, nothing was charged
      if (attempt < retries) { await sleep(400 * 2 ** attempt); continue; }
      throw err;
    }
    if (RETRY.has(res.status) && attempt < retries) { await sleep(500 * 2 ** attempt); continue; }
    if (res.status < 200 || res.status >= 300) {
      const detail = res.json?.error?.message ?? res.json?.error ?? res.text ?? '';
      const text = typeof detail === 'string' ? detail : JSON.stringify(detail);
      const code = /max_tokens_exceeded|context|too (long|large)/i.test(text) ? 'too_large' : `http_${res.status}`;
      throw new JevError(`Jev HTTP ${res.status}: ${text.slice(0, 300)}`, res.status, code);
    }
    const json = res.json;
    const inputTokens = json.usage?.input_tokens ?? 0;
    const cost = json.usage?.cost ?? (inputTokens / 1_000_000) * PRICE_PER_M_INPUT;
    usage.calls++;
    usage.inputTokens += inputTokens;
    usage.cost += cost;
    if (json.model) usage.models.add(json.model);
    usage.ms.push(Date.now() - t0);
    return { answers: json.answers, model: json.model ?? null, cost, inputTokens };
  }
}

// Question builders. `instructions` and `criteria` may be strings or JSON.
export const choice = (instructions, criteria) => ({ type: 'choice', instructions, criteria });
export const noul = (instructions, criteria) => ({ type: 'noul', instructions, ...(criteria ? { criteria } : {}) });

/** Options of a Choice answer, best first: [[option, probability], ...]. */
export const ranked = (answer) => Object.entries(answer?.probabilities ?? {}).sort((a, b) => b[1] - a[1]);

/** Run `fn` over `items` with at most `limit` in flight. Keeps input order. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function usageLine() {
  const ms = [...usage.ms].sort((a, b) => a - b);
  const median = ms.length ? ms[Math.floor(ms.length / 2)] : 0;
  return `${usage.calls} Jev calls, ${usage.inputTokens.toLocaleString('en-US')} input tokens, $${usage.cost.toFixed(4)}, median ${median} ms per call${usage.models.size ? ` (${[...usage.models].join(', ')})` : ''}`;
}
