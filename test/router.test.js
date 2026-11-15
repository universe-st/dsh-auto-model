import test from 'node:test'
import assert from 'node:assert/strict'

import { routeRequest, backoffDelay, policyAllowsRetry } from '../lib/router.js'
import { selectTarget } from '../lib/rules.js'

const okFinish = { type: 'finish', reason: { kind: 'stop' } }
const text = { type: 'text-delta', index: 0, text: 'hello' }
const failure = (code = 'RATE_LIMIT') => ({ type: 'finish', reason: { kind: 'error', failure: { message: code, code } } })

function harness({ model, scripts, policies = {}, live = {} }) {
  const calls = []
  const failures = []
  let current = null
  let clock = 0
  const deps = {
    logger: { debug() {}, info() {}, warn() {} },
    live: () => ({
      virtualModels: [model],
      maxSwitches: 4,
      retryBudgetMs: 0,
      defaultCommandTimeoutMs: 1000,
      logRouting: false,
      duplicates: [],
      ...live,
    }),
    now: () => new Date(Date.parse('2026-11-15T10:30:00+08:00') + clock),
    select: selectTarget,
    modelFor: id => (id === model.id ? model : null),
    failuresFor: () => failures,
    recordFailure: (key, target) => {
      failures.push({
        at: Date.parse('2026-11-15T10:30:00+08:00'),
        provider: target.provider,
        model: target.model,
        code: 'RATE_LIMIT',
      })
    },
    currentTargetFor: () => current,
    setCurrentTarget: (key, target) => { current = target },
    forwardOptions: async (options, target) => ({ ...options, provider: target.provider, model: target.model }),
    streamReal: (options) => {
      calls.push(`${options.provider}/${options.model}`)
      const script = scripts[`${options.provider}/${options.model}`]
      const index = calls.filter(call => call === `${options.provider}/${options.model}`).length - 1
      const chunks = (script?.[Math.min(index, script.length - 1)] ?? [okFinish])
      return (async function* () { for (const chunk of chunks) yield chunk })()
    },
    retryPolicyFor: (provider) => policies[provider] ?? { mode: 'normal', maxRetries: 0, retryableCodes: [], initialDelayMs: 1, maxDelayMs: 2, jitterRatio: 0 },
    runCommand: async () => '',
    sleep: async (ms) => { clock += ms },
  }
  return { deps, calls }
}

async function collect(options, deps) {
  const chunks = []
  for await (const chunk of routeRequest(options, deps)) chunks.push(chunk)
  return chunks
}

const baseModel = {
  id: 'auto',
  name: 'Auto',
  fallback: { provider: 'p1', model: 'primary' },
  capability: null,
  rules: [],
}

test('a successful attempt is passed through untouched', async () => {
  const { deps, calls } = harness({ model: baseModel, scripts: { 'p1/primary': [[text, okFinish]] } })
  const chunks = await collect({ provider: 'auto-model', model: 'auto', messages: [] }, deps)
  assert.deepEqual(chunks, [text, okFinish])
  assert.deepEqual(calls, ['p1/primary'])
})

test('a failure before any visible output is retried invisibly', async () => {
  const { deps, calls } = harness({
    model: baseModel,
    scripts: { 'p1/primary': [[failure()], [okFinish]] },
    policies: { p1: { mode: 'normal', maxRetries: 2, retryableCodes: ['RATE_LIMIT'], initialDelayMs: 1, maxDelayMs: 2, jitterRatio: 0 } },
  })
  const chunks = await collect({ provider: 'auto-model', model: 'auto', messages: [] }, deps)
  assert.deepEqual(chunks, [okFinish])
  assert.deepEqual(calls, ['p1/primary', 'p1/primary'])
})

test('the retry budget scopes retries of one target', async () => {
  const { deps, calls } = harness({
    model: baseModel,
    live: { retryBudgetMs: 1 },
    scripts: { 'p1/primary': [[failure()], [failure()], [okFinish]] },
    policies: { p1: { mode: 'normal', maxRetries: 5, retryableCodes: ['RATE_LIMIT'], initialDelayMs: 5000, maxDelayMs: 5000, jitterRatio: 0 } },
  })
  // The next wait is already larger than the whole budget, so the target is
  // abandoned without sleeping it away.
  const chunks = await collect({ provider: 'auto-model', model: 'auto', messages: [] }, deps)
  assert.equal(chunks.at(-1).reason.kind, 'error')
  assert.deepEqual(calls, ['p1/primary'])
})

test('a provider Retry-After longer than the local maximum is honored inside the budget', async () => {
  const { deps, calls } = harness({
    model: baseModel,
    live: { retryBudgetMs: 60000 },
    scripts: {
      'p1/primary': [
        [{ type: 'finish', reason: { kind: 'error', failure: { code: 'RATE_LIMIT', providerRetryAfterMs: 3000 } } }],
        [text, okFinish],
      ],
    },
    policies: { p1: { mode: 'normal', maxRetries: 2, retryableCodes: ['RATE_LIMIT'], initialDelayMs: 10, maxDelayMs: 1000, jitterRatio: 0 } },
  })
  const chunks = await collect({ provider: 'auto-model', model: 'auto', messages: [] }, deps)
  assert.deepEqual(chunks, [text, okFinish])
  assert.equal(calls.length, 2)
})

test('a retry wait longer than the remaining budget switches instead of waiting', async () => {
  const model = {
    ...baseModel,
    rules: [
      { id: 'time', type: 'time-of-day', enabled: true, from: '00:00', to: '23:59', target: { provider: 'p2', model: 'day' } },
    ],
  }
  const { deps, calls } = harness({
    model,
    live: { retryBudgetMs: 5000 },
    scripts: {
      'p2/day': [[{ type: 'finish', reason: { kind: 'error', failure: { code: 'RATE_LIMIT', providerRetryAfterMs: 30000 } } }]],
      'p1/primary': [[text, okFinish]],
    },
    policies: { p2: { mode: 'normal', maxRetries: 3, retryableCodes: ['RATE_LIMIT'], initialDelayMs: 10, maxDelayMs: 1000, jitterRatio: 0 } },
  })
  const chunks = await collect({ provider: 'auto-model', model: 'auto', messages: [] }, deps)
  assert.deepEqual(chunks, [text, okFinish])
  assert.deepEqual(calls, ['p2/day', 'p1/primary'])
})

test('an exhausted target switches to the target of the failure rule', async () => {
  const model = {
    ...baseModel,
    rules: [
      { id: 'failover', type: 'recent-failure', enabled: true, hours: 1, codes: [], target: { provider: 'p2', model: 'backup' } },
    ],
  }
  const { deps, calls } = harness({
    model,
    scripts: { 'p1/primary': [[failure()]], 'p2/backup': [[text, okFinish]] },
  })
  const chunks = await collect({ provider: 'auto-model', model: 'auto', messages: [] }, deps)
  assert.deepEqual(chunks, [text, okFinish])
  assert.deepEqual(calls, ['p1/primary', 'p2/backup'])
})

test('the fallback is the last resort after a failed rule target', async () => {
  const model = {
    ...baseModel,
    rules: [
      { id: 'time', type: 'time-of-day', enabled: true, from: '00:00', to: '23:59', target: { provider: 'p2', model: 'day' } },
    ],
  }
  const { deps, calls } = harness({
    model,
    scripts: { 'p2/day': [[failure()]], 'p1/primary': [[text, okFinish]] },
  })
  const chunks = await collect({ provider: 'auto-model', model: 'auto', messages: [] }, deps)
  assert.deepEqual(chunks, [text, okFinish])
  assert.deepEqual(calls, ['p2/day', 'p1/primary'])
})

test('a failure after visible output is reported, never retried', async () => {
  const { deps, calls } = harness({
    model: baseModel,
    scripts: { 'p1/primary': [[text, failure()]] },
    policies: { p1: { mode: 'always', initialDelayMs: 1, maxDelayMs: 2, jitterRatio: 0 } },
  })
  const chunks = await collect({ provider: 'auto-model', model: 'auto', messages: [] }, deps)
  assert.equal(chunks[0].text, 'hello')
  assert.equal(chunks.at(-1).reason.kind, 'error')
  assert.deepEqual(calls, ['p1/primary'])
})

test('no target left reports the last failure upward', async () => {
  const { deps, calls } = harness({
    model: baseModel,
    scripts: { 'p1/primary': [[failure('AUTH')]] },
    policies: { p1: { mode: 'normal', maxRetries: 5, retryableCodes: ['AUTH'], initialDelayMs: 1, maxDelayMs: 2, jitterRatio: 0 } },
  })
  const chunks = await collect({ provider: 'auto-model', model: 'auto', messages: [] }, deps)
  assert.equal(chunks.length, 1)
  assert.equal(chunks[0].reason.failure.code, 'AUTH')
  assert.equal(calls.length, 6)
})

test('an exhausted switch budget reports the failure without logging a switch', async () => {
  const model = {
    ...baseModel,
    rules: [
      { id: 'time', type: 'time-of-day', enabled: true, from: '00:00', to: '23:59', target: { provider: 'p2', model: 'day' } },
    ],
  }
  const { deps } = harness({ model, live: { maxSwitches: 0 }, scripts: { 'p2/day': [[failure('AUTH')]] } })
  const infos = []
  deps.logger = { debug() {}, info: (message) => infos.push(message), warn() {} }
  const chunks = await collect({ provider: 'auto-model', model: 'auto', messages: [] }, deps)
  assert.equal(chunks.at(-1).reason.failure.code, 'AUTH')
  assert.deepEqual(infos, [])
})

test('a call without a Session keeps its ledger per virtual model', async () => {
  const keys = []
  const { deps } = harness({ model: baseModel, scripts: { 'p1/primary': [[failure('AUTH')]] } })
  deps.recordFailure = (key) => keys.push(key)
  deps.setCurrentTarget = (key) => keys.push(key)
  deps.failuresFor = (key) => { keys.push(`read:${key}`); return [] }
  deps.currentTargetFor = (key) => { keys.push(`current:${key}`); return null }

  await collect({ provider: 'auto-model', model: 'auto', messages: [] }, deps)

  assert.ok(keys.length > 0)
  for (const key of keys) assert.ok(key.includes('@no-session\u0000auto'), key)
})

test('an auxiliary producer reads a Session route without writing it', async () => {
  const reads = []
  const writes = []
  const { deps } = harness({ model: baseModel, scripts: { 'p1/primary': [[okFinish]] } })
  deps.failuresFor = (key) => { reads.push(`failures:${key}`); return [] }
  deps.currentTargetFor = (key) => { reads.push(`current:${key}`); return null }
  deps.recordFailure = (key) => writes.push(key)
  deps.setCurrentTarget = (key) => writes.push(key)

  await collect({ provider: 'auto-model', model: 'auto', messages: [], sessionId: 's1', purpose: 'title' }, deps)

  assert.deepEqual(writes, [])
  assert.deepEqual(reads, ['failures:s1', 'current:s1'])
})

test('a stream without a terminal chunk is retried as an empty response', async () => {
  const { deps, calls } = harness({
    model: baseModel,
    scripts: { 'p1/primary': [[], [text, okFinish]] },
    policies: { p1: { mode: 'normal', maxRetries: 1, retryableCodes: ['EMPTY_RESPONSE'], initialDelayMs: 1, maxDelayMs: 2, jitterRatio: 0 } },
  })
  const chunks = await collect({ provider: 'auto-model', model: 'auto', messages: [] }, deps)
  assert.deepEqual(chunks, [text, okFinish])
  assert.deepEqual(calls, ['p1/primary', 'p1/primary'])
})

test('an unknown virtual model fails with a routing error', async () => {
  const { deps } = harness({ model: baseModel, scripts: {} })
  const chunks = await collect({ provider: 'auto-model', model: 'missing', messages: [] }, deps)
  assert.equal(chunks[0].reason.failure.code, 'INVALID_REQUEST')
})

test('a virtual model without a fallback cannot route', async () => {
  const model = { ...baseModel, fallback: null }
  const { deps } = harness({ model, scripts: {} })
  const chunks = await collect({ provider: 'auto-model', model: 'auto', messages: [] }, deps)
  assert.equal(chunks[0].reason.failure.code, 'INVALID_CONFIG')
})

test('cancellation before the first token reports an aborted finish', async () => {
  const controller = new AbortController()
  controller.abort()
  const { deps, calls } = harness({ model: baseModel, scripts: {} })
  const chunks = await collect({ provider: 'auto-model', model: 'auto', messages: [], signal: controller.signal }, deps)
  assert.equal(chunks[0].reason.kind, 'aborted')
  assert.deepEqual(calls, [])
})

test('backoff honors any provider Retry-After and jitters local delays', () => {
  const policy = { mode: 'normal', maxRetries: 3, retryableCodes: ['RATE_LIMIT'], initialDelayMs: 100, maxDelayMs: 1000, jitterRatio: 0 }
  assert.equal(backoffDelay(policy, 1, { providerRetryAfterMs: 250 }), 250)
  assert.equal(backoffDelay(policy, 1, { providerRetryAfterMs: 5000 }), 5000)
  assert.equal(backoffDelay(policy, 3, {}), 400)
  assert.equal(backoffDelay(policy, 9, {}), 1000)
  assert.equal(policyAllowsRetry(policy, { code: 'RATE_LIMIT' }, 2), true)
  assert.equal(policyAllowsRetry(policy, { code: 'RATE_LIMIT' }, 3), false)
  assert.equal(policyAllowsRetry(policy, { code: 'AUTH' }, 0), false)
  assert.equal(policyAllowsRetry({ mode: 'always', initialDelayMs: 100, maxDelayMs: 1000, jitterRatio: 0 }, { code: 'AUTH' }, 99), true)
})
