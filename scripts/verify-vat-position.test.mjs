import test from 'node:test'
import assert from 'node:assert/strict'
import { verifyVatPosition } from './verify-local-vat-position.mjs'

test('VAT totals wait for the RPC POST when its CORS preflight arrives first', async t => {
  // Observe the actual verifier's listener before the remaining browser flow.
  // All fixture writes and network calls are in-memory boundaries in this test.
  t.mock.method(globalThis, 'fetch', async () => new Response('', {
    headers: { 'content-security-policy': 'connect-src http://127.0.0.1:58321' },
  }))
  t.mock.method(console, 'error', () => {})
  const response = (method, path = 'read_my_vat_position', status = 200) => ({
    url: () => 'http://127.0.0.1:58321/rest/v1/rpc/' + path,
    request: () => ({ method: () => method }),
    status: () => status,
  })
  const preflight = response('OPTIONS'), unrelated = response('POST', 'another_rpc')
  const totals = response('POST'), rejected = response('POST', 'read_my_vat_position', 503)
  const stop = new Error('Listener captured; remaining browser flow is outside this unit test')
  let selected, rejectedReadObserved
  const page = {
    viewportSize: () => null,
    goto: async () => {},
    screenshot: async () => {},
    unroute: async () => {},
    waitForResponse(predicate) {
      selected = [preflight, unrelated, totals].find(predicate)
      rejectedReadObserved = predicate(rejected)
      throw stop
    },
  }
  const admin = { from: () => ({
    insert: async () => ({ error: null }),
    delete: () => ({ eq: () => ({ in: async () => ({ error: null }) }) }),
  }) }
  await assert.rejects(verifyVatPosition(page, admin, 'synthetic-tenant', 'http://localhost:3108'), error => error.message === 'VAT position verification failed: complete VAT browser/API totals')
  assert.equal(selected, totals, 'Preflight has no totals body; observe the actual RPC response')
  assert.equal(rejectedReadObserved, true, 'A failed RPC must remain visible to the financial assertions')
})
