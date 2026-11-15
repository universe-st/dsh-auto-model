import test from 'node:test'
import assert from 'node:assert/strict'

import { matchesRule, selectTarget, clockParts } from '../lib/rules.js'

const target = (model) => ({ provider: 'p', model })

function baseContext(overrides = {}) {
  return {
    now: new Date('2026-11-15T10:30:00+08:00'),
    messages: [],
    failures: [],
    currentTarget: null,
    runCommand: async () => '',
    ...overrides,
  }
}

const user = (text) => ({ role: 'user', content: [{ type: 'text', text }] })
const assistant = (text) => ({ role: 'assistant', content: [{ type: 'text', text }] })

test('time-of-day matches inside and outside a same-day range', () => {
  const rule = { type: 'time-of-day', from: '09:00', to: '18:00', target: target('a') }
  assert.equal(clockParts(new Date('2026-11-15T10:30:00+08:00'), undefined).minutes, 630)
  return Promise.all([
    matchesRule(rule, baseContext()).then((hit) => assert.equal(hit, true)),
    matchesRule(rule, baseContext({ now: new Date('2026-11-15T20:30:00+08:00') }))
      .then((hit) => assert.equal(hit, false)),
  ])
})

test('an overnight time range wraps past midnight', async () => {
  const rule = { type: 'time-of-day', from: '22:00', to: '06:00', target: target('a') }
  assert.equal(await matchesRule(rule, baseContext({ now: new Date('2026-11-15T23:30:00+08:00') })), true)
  assert.equal(await matchesRule(rule, baseContext({ now: new Date('2026-11-15T05:30:00+08:00') })), true)
  assert.equal(await matchesRule(rule, baseContext({ now: new Date('2026-11-15T12:00:00+08:00') })), false)
})

test('weekday filters restrict a time-of-day rule', async () => {
  // 2026-11-15 is a Sunday (ISO 7).
  const rule = { type: 'time-of-day', from: '00:00', to: '23:59', days: [1, 2, 3, 4, 5], target: target('a') }
  assert.equal(await matchesRule(rule, baseContext()), false)
})

test('datetime ranges are inclusive', async () => {
  const rule = {
    type: 'datetime-range',
    from: '2026-11-01T00:00:00+08:00',
    to: '2026-11-30T23:59:59+08:00',
    target: target('a'),
  }
  assert.equal(await matchesRule(rule, baseContext()), true)
  assert.equal(await matchesRule(rule, baseContext({ now: new Date('2026-12-01T00:00:00+08:00') })), false)
})

test('keyword rules read the first and the most recent user messages', async () => {
  const messages = [user('Please refactor the parser'), assistant('ok'), user('now add tests'), user('and docs')]
  const first = { type: 'first-message-keyword', keywords: ['parser'], caseSensitive: false, target: target('a') }
  assert.equal(await matchesRule(first, baseContext({ messages })), true)
  assert.equal(await matchesRule({ ...first, keywords: ['docs'] }, baseContext({ messages })), false)

  const recent = { type: 'recent-message-keyword', keywords: ['tests'], count: 2, caseSensitive: false, target: target('a') }
  assert.equal(await matchesRule(recent, baseContext({ messages })), true)
  assert.equal(await matchesRule({ ...recent, count: 1 }, baseContext({ messages })), false)
})

test('image attempt matches an attached image or an image tool call in history', async () => {
  const rule = { type: 'image-attempt', toolNames: ['read_image'], target: target('vision') }
  const withImage = [{ role: 'user', content: [{ type: 'image', attachment: {} }] }]
  assert.equal(await matchesRule(rule, baseContext({ messages: withImage })), true)
  const withTool = [{ role: 'assistant', content: [{ type: 'tool-call', id: 'c', name: 'read_image', arguments: '{}' }] }]
  assert.equal(await matchesRule(rule, baseContext({ messages: withTool })), true)
  assert.equal(await matchesRule(rule, baseContext({ messages: [user('plain')] })), false)
})

test('command rules compare against the configured value and cache through the runner', async () => {
  const rule = { type: 'command', command: 'cat mode', expected: 'cheap', matchMode: 'equals', target: target('a') }
  assert.equal(await matchesRule(rule, baseContext({ runCommand: async () => 'cheap' })), true)
  assert.equal(await matchesRule(rule, baseContext({ runCommand: async () => 'expensive' })), false)
  assert.equal(await matchesRule(rule, baseContext({ runCommand: async () => null })), false)
  assert.equal(await matchesRule({ ...rule, matchMode: 'contains', expected: 'hea' }, baseContext({ runCommand: async () => 'cheap' })), true)
  assert.equal(await matchesRule({ ...rule, matchMode: 'regex', expected: '^ch.ap$' }, baseContext({ runCommand: async () => 'cheap' })), true)
})

test('recent-failure matches only the current target inside the window and code set', async () => {
  const rule = { type: 'recent-failure', hours: 1, codes: ['RATE_LIMIT'], target: target('backup') }
  const now = new Date('2026-11-15T10:30:00+08:00')
  const failure = { at: now.getTime() - 10 * 60 * 1000, provider: 'p', model: 'primary', code: 'RATE_LIMIT' }
  const context = baseContext({ now, failures: [failure], currentTarget: target('primary') })
  assert.equal(await matchesRule(rule, context), true)
  assert.equal(await matchesRule(rule, { ...context, currentTarget: target('other') }), false)
  assert.equal(await matchesRule(rule, { ...context, failures: [{ ...failure, at: now.getTime() - 3 * 60 * 60 * 1000 }] }), false)
  assert.equal(await matchesRule(rule, { ...context, failures: [{ ...failure, code: 'AUTH' }] }), false)
  assert.equal(await matchesRule({ ...rule, codes: [] }, { ...context, failures: [{ ...failure, code: 'AUTH' }] }), true)
})

test('the first matching enabled rule wins and the fallback is the default', async () => {
  const model = {
    id: 'auto',
    fallback: target('fallback'),
    rules: [
      { id: 'off', type: 'first-message-keyword', enabled: false, keywords: ['x'], target: target('off') },
      { id: 'r1', type: 'first-message-keyword', keywords: ['hello'], target: target('one') },
      { id: 'r2', type: 'first-message-keyword', keywords: ['hello'], target: target('two') },
    ],
  }
  const hit = await selectTarget(model, baseContext({ messages: [user('hello there')] }))
  assert.equal(hit.target.model, 'one')
  assert.equal(hit.ruleId, 'r1')
  const miss = await selectTarget(model, baseContext({ messages: [user('nothing')] }))
  assert.equal(miss.target.model, 'fallback')
  assert.equal(miss.ruleId, null)
})

test('a rule that throws does not break selection', async () => {
  const model = {
    id: 'auto',
    fallback: target('fallback'),
    rules: [
      { id: 'broken', type: 'command', command: 'x', expected: 'y', matchMode: 'equals', target: target('never') },
      { id: 'ok', type: 'first-message-keyword', keywords: ['hi'], target: target('two') },
    ],
  }
  const warnings = []
  const hit = await selectTarget(model, baseContext({
    messages: [user('hi')],
    runCommand: async () => { throw new Error('boom') },
    logger: { warn: (message) => warnings.push(message) },
  }))
  assert.equal(hit.target.model, 'two')
  assert.equal(warnings.length, 1)
})
