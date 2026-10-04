import test from 'node:test';
import assert from 'node:assert/strict';
import { askWithUsage, DEFAULT_MODEL, PRICE_PER_M_INPUT } from '../src/jev.mjs';

test('calls the TypeSafe System One API and derives cost from input tokens', async () => {
  const previousKey = process.env.TYPESAFE_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.TYPESAFE_API_KEY = 'test-key';
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return {
      status: 200,
      text: async () => JSON.stringify({
        model: 'jev-1.13.0',
        answers: { checked: { type: 'noul', noul: 1 } },
        usage: { input_tokens: 250, output_tokens: 12 },
      }),
    };
  };

  try {
    assert.equal(DEFAULT_MODEL, 'jev-latest');
    const result = await askWithUsage('state', { checked: { type: 'noul', instructions: 'Check it' } });
    assert.equal(request.url, 'https://api.typesafe.ai/v1/systemone');
    assert.equal(request.options.method, 'POST');
    assert.equal(request.options.headers.Authorization, 'Bearer test-key');
    assert.deepEqual(JSON.parse(request.options.body), {
      model: 'jev-latest',
      state: 'state',
      questions: { checked: { type: 'noul', instructions: 'Check it' } },
    });
    assert.equal(result.answers.checked.noul, 1);
    assert.equal(result.inputTokens, 250);
    assert.equal(result.cost, (250 / 1_000_000) * PRICE_PER_M_INPUT);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = previousKey;
  }
});
