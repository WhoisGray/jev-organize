// A stand-in for Jev in tests: picks the Choice option whose description shares the most
// words with the state, and answers Nouls from a few keywords. Records every request.
import { setTransport } from '../src/jev.mjs';

export const requests = [];

const words = (s) => new Set(String(s).toLowerCase().match(/[a-z]{4,}/g) ?? []);

export function installFakeJev({ fail } = {}) {
  requests.length = 0;
  setTransport(async (body) => {
    requests.push(body);
    if (fail?.(body)) return { status: 500, json: { error: { message: 'boom' } }, text: 'boom' };
    const stateText = JSON.stringify(body.state).toLowerCase();
    const stateWords = words(stateText);
    const answers = {};
    for (const [id, q] of Object.entries(body.questions)) {
      if (q.type === 'noul') {
        const p = id === 'noise' ? (stateText.includes('asdf') || stateText.includes('(no readable text') ? 0.95 : 0.02)
          : id === 'flag:credentials' ? (stateText.includes('[secret]') ? 0.97 : 0.01)
          : id === 'flag:personal_data' ? (/salary|review|\[email at/.test(stateText) ? 0.8 : 0.05)
          : 0.1;
        answers[id] = { type: 'noul', noul: p };
        continue;
      }
      const scored = Object.entries(q.criteria).map(([opt, desc]) => {
        let s = 0;
        for (const w of words(`${opt} ${desc ?? ''}`)) if (stateWords.has(w)) s++;
        if (opt === 'none' || opt === 'other') s -= 0.5;
        return [opt, s];
      });
      scored.sort((a, b) => b[1] - a[1]);
      const total = scored.reduce((n, [, s]) => n + Math.max(s, 0) + 1, 0);
      const probabilities = Object.fromEntries(scored.map(([o, s]) => [o, (Math.max(s, 0) + 1) / total]));
      const best = scored[0][0];
      answers[id] = { type: 'choice', choice: best, probabilities, confidence: Math.min(0.99, 0.5 + scored[0][1] / 10) };
    }
    return { status: 200, json: { model: 'fake/jev-test', answers, usage: { input_tokens: 100, cost: 0.000004 } } };
  });
}

export function uninstallFakeJev() { setTransport(null); }
