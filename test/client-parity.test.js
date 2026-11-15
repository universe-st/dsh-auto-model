import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { normalizeLive } from '../lib/state.js'

/**
 * The Client bundle is a classic script: it registers a factory on
 * `window.__ModuleLoader__` and can only require `react`. This harness runs the
 * same file under a stub loader so the page's validation can be compared with
 * the Host normalizer that silently drops unusable entries.
 */

const react = { createElement: () => null, Fragment: Symbol('fragment') }

async function loadClient({ seam = true } = {}) {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  let loaded = null
  const previousWindow = globalThis.window
  const previousFlag = globalThis.__DSH_AUTO_MODEL_TEST__
  globalThis.window = { __ModuleLoader__: { load: (entry) => { loaded = entry } } }
  if (seam) globalThis.__DSH_AUTO_MODEL_TEST__ = true
  else delete globalThis.__DSH_AUTO_MODEL_TEST__
  try {
    new Function(source)()
    assert.ok(loaded !== null, 'client.js did not register a module')
    return loaded.factory((id) => {
      if (id === 'react') return react
      throw new Error(`unexpected require(${id})`)
    })
  } finally {
    globalThis.window = previousWindow
    if (previousFlag === undefined) delete globalThis.__DSH_AUTO_MODEL_TEST__
    else globalThis.__DSH_AUTO_MODEL_TEST__ = previousFlag
  }
}

/** Problems are compared by code; parameters are covered by the page's own rendering. */
const t = code => code

const target = (provider, model) => ({ provider, model })

const autoModel = (overrides = {}) => ({
  id: 'auto',
  name: 'Auto',
  description: '',
  fallback: target('p1', 'primary'),
  capability: null,
  rules: [],
  ...overrides,
})

const rule = (overrides) => ({ enabled: true, target: target('p1', 'primary'), ...overrides })

const draftOf = (rules = [], overrides = {}) => ({
  virtualModels: [autoModel({ rules, ...overrides })],
  defaultCommandTimeoutMs: 8000,
  retryBudgetMs: 90000,
  maxSwitches: 4,
  logRouting: false,
})

const allKinds = draftOf([
  rule({ id: 'r1', type: 'time-of-day', from: '22:00', to: '06:00', days: [1, 2], timeZone: 'Asia/Shanghai', target: target('p2', 'cheap') }),
  rule({ id: 'r2', type: 'datetime-range', from: '2026-11-01T00:00', to: '2026-11-30T23:59', target: target('p2', 'promo') }),
  rule({ id: 'r3', type: 'first-message-keyword', keywords: ['debug'], caseSensitive: false, target: target('p3', 'coder') }),
  rule({ id: 'r4', type: 'recent-message-keyword', keywords: ['设计'], count: 3, target: target('p3', 'designer') }),
  rule({ id: 'r5', type: 'image-attempt', toolNames: ['read_image'], target: target('p4', 'vision') }),
  rule({ id: 'r6', type: 'command', command: 'git branch --show-current', expected: 'main', matchMode: 'equals', cacheSeconds: 30, target: target('p5', 'cheap') }),
  rule({ id: 'r7', type: 'recent-failure', hours: 2, codes: [], target: target('p6', 'backup') }),
])

test('a document the page accepts is kept whole by the Host', async () => {
  const client = await loadClient()
  assert.deepEqual(client.problemsOf(allKinds, t), [])
  const live = normalizeLive(allKinds)
  assert.equal(live.virtualModels.length, 1)
  assert.deepEqual(live.virtualModels[0].rules.map(entry => entry.id), ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7'])
  assert.deepEqual(live.virtualModels[0].fallback, { provider: 'p1', model: 'primary' })
})

test('everything the page rejects is also dropped by the Host', async () => {
  const client = await loadClient()
  const cases = [
    ['model id with a slash', draftOf([], { id: 'a/b' }), 'problem.modelId'],
    ['model id with a space', draftOf([], { id: 'a b' }), 'problem.modelId'],
    ['empty model id', draftOf([], { id: '  ' }), 'problem.modelId'],
    ['missing fallback', draftOf([], { fallback: null }), 'problem.fallback'],
    ['blank fallback provider', draftOf([], { fallback: { provider: '  ', model: 'x' } }), 'problem.fallback'],
    ['fallback into the virtual provider', draftOf([], { fallback: target('auto-model', 'x') }), 'problem.targetSelf'],
    ['rule target into the virtual provider', draftOf([rule({ id: 'r', type: 'image-attempt', target: target('auto-model', 'x') })]), 'problem.targetSelf'],
    ['missing rule target', draftOf([rule({ id: 'r', type: 'image-attempt', target: null })]), 'problem.ruleTarget'],
    ['impossible hour', draftOf([rule({ id: 'r', type: 'time-of-day', from: '24:00', to: '06:00' })]), 'problem.ruleClock'],
    ['impossible minute', draftOf([rule({ id: 'r', type: 'time-of-day', from: '09:00', to: '12:60' })]), 'problem.ruleClock'],
    ['unknown time zone', draftOf([rule({ id: 'r', type: 'time-of-day', from: '09:00', to: '12:00', timeZone: 'Mars/Olympus' })]), 'problem.ruleZone'],
    ['blank command', draftOf([rule({ id: 'r', type: 'command', command: '  ' })]), 'problem.ruleCommand'],
    ['blank keywords', draftOf([rule({ id: 'r', type: 'first-message-keyword', keywords: ['  '] })]), 'problem.ruleKeywords'],
    ['no keywords', draftOf([rule({ id: 'r', type: 'recent-message-keyword', keywords: [] })]), 'problem.ruleKeywords'],
    ['invalid date', draftOf([rule({ id: 'r', type: 'datetime-range', from: 'not-a-date', to: '2026-11-30T23:59' })]), 'problem.ruleDates'],
  ]
  for (const [name, draft, code] of cases) {
    const problems = client.problemsOf(draft, t)
    assert.ok(problems.includes(code), `${name}: expected ${code}, got ${JSON.stringify(problems)}`)
    const live = normalizeLive(draft)
    const lostModel = live.virtualModels.length !== draft.virtualModels.length
    const lostRule = live.virtualModels.some((model, index) => model.rules.length !== draft.virtualModels[index].rules.length)
    // A model the Host keeps but cannot route (no usable fallback) is just as unusable.
    const unusable = live.virtualModels.some(model => model.fallback === null)
    assert.ok(lostModel || lostRule || unusable, `${name}: the Host kept a document the page rejects`)
  }
})

test('the accepted boundary cases agree with the Host', async () => {
  const client = await loadClient()
  const accepted = [
    draftOf(),
    draftOf([rule({ id: 'r', type: 'time-of-day', from: '09:00', to: '09:00' })]),
    draftOf([rule({ id: 'r', type: 'time-of-day', from: '22:00', to: '06:00', timeZone: 'UTC' })]),
    draftOf([rule({ id: 'r', type: 'recent-failure', hours: 2, codes: [] })]),
    draftOf([rule({ id: 'r', type: 'image-attempt', toolNames: [] })]),
  ]
  for (const draft of accepted) {
    assert.deepEqual(client.problemsOf(draft, t), [])
    assert.equal(normalizeLive(draft).virtualModels[0].rules.length, draft.virtualModels[0].rules.length)
  }
})

test('the test seam stays closed outside the test flag', async () => {
  const client = await loadClient({ seam: false })
  assert.equal(client.problemsOf, undefined)
})
