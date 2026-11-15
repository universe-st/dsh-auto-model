import test from 'node:test'
import assert from 'node:assert/strict'

import {
  normalizeLive,
  normalizeRule,
  normalizeVirtualModel,
  normalizeTarget,
  emptyLive,
  PROVIDER_ID,
} from '../lib/state.js'

test('empty document is valid', () => {
  const live = normalizeLive(emptyLive())
  assert.deepEqual(live.virtualModels, [])
  assert.equal(live.maxSwitches, 4)
  assert.equal(live.retryBudgetMs, 90000)
})

test('targets pointing at the virtual provider are refused', () => {
  assert.equal(normalizeTarget({ provider: PROVIDER_ID, model: 'x' }), null)
  assert.deepEqual(normalizeTarget({ provider: 'p', model: ' m ' }), { provider: 'p', model: 'm' })
})

test('virtual models need an id and tolerate unfinished rules', () => {
  const model = normalizeVirtualModel({
    id: 'auto',
    rules: [
      { type: 'time-of-day', from: '09:00', to: '18:00', target: { provider: 'p', model: 'business' } },
      { type: 'time-of-day', from: 'oops', to: '18:00', target: { provider: 'p', model: 'broken' } },
      { type: 'unknown', target: { provider: 'p', model: 'unknown' } },
      { type: 'command', command: '', target: { provider: 'p', model: 'no-command' } },
    ],
  }, 0)
  assert.equal(model.rules.length, 1)
  assert.equal(model.rules[0].target.model, 'business')
  assert.equal(normalizeVirtualModel({ id: 'with space' }, 0), null)
  assert.equal(normalizeVirtualModel({ id: 'x' }, 0).fallback, null)
})

test('duplicate model ids keep the first entry and are reported', () => {
  const live = normalizeLive({
    virtualModels: [
      { id: 'auto', fallback: { provider: 'p', model: 'a' } },
      { id: 'auto', fallback: { provider: 'p', model: 'b' } },
    ],
  })
  assert.equal(live.virtualModels.length, 1)
  assert.deepEqual(live.duplicates, ['auto'])
})

test('rule normalization keeps defaults per kind', () => {
  const image = normalizeRule({ type: 'image-attempt', target: { provider: 'p', model: 'vision' } }, 0)
  assert.ok(image.toolNames.includes('read_image'))
  const recent = normalizeRule({ type: 'recent-message-keyword', keywords: ['log'], target: { provider: 'p', model: 'long' } }, 0)
  assert.equal(recent.count, 3)
  assert.equal(recent.caseSensitive, false)
  const failure = normalizeRule({ type: 'recent-failure', hours: 2, codes: ['RATE_LIMIT'], target: { provider: 'p', model: 'backup' } }, 0)
  assert.equal(failure.hours, 2)
  assert.deepEqual(failure.codes, ['RATE_LIMIT'])
})
