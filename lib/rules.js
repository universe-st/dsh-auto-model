/**
 * Rule evaluation and target selection.
 *
 * Pure with respect to Cordis: every ambient fact (clock, history, failure
 * ledger, command runner) arrives through the context object, which makes the
 * whole selector testable with plain Node.
 */

/** Extract plain text from one message's content blocks. */
export function messageText(message) {
  const content = message?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter(block => block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('\n')
}

function userMessages(messages) {
  return messages.filter(message => message?.role === 'user')
}

function containsKeyword(text, keyword, caseSensitive) {
  if (keyword.length === 0) return false
  if (caseSensitive) return text.includes(keyword)
  return text.toLowerCase().includes(keyword.toLowerCase())
}

/** Wall-clock parts of one instant in an IANA time zone, or the host zone when omitted. */
export function clockParts(now, timeZone) {
  if (timeZone === undefined || timeZone === '') {
    const isoDay = now.getDay() === 0 ? 7 : now.getDay()
    return { minutes: now.getHours() * 60 + now.getMinutes(), weekday: isoDay }
  }
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts = formatter.formatToParts(now)
  const read = type => parts.find(part => part.type === type)?.value ?? ''
  const weekdays = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }
  const hour = Number(read('hour')) % 24
  const minute = Number(read('minute'))
  return { minutes: hour * 60 + minute, weekday: weekdays[read('weekday')] ?? 1 }
}

function parseClock(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value).trim())
  if (match === null) return null
  return Number(match[1]) * 60 + Number(match[2])
}

/**
 * Whether one wall-clock minute lies inside a possibly overnight range.
 *
 * Ranges are half-open: `[from, to)` for a same-day range and
 * `[from, 24:00) ∪ [00:00, to)` overnight. Two adjacent ranges therefore never
 * claim the same boundary minute, so `22:00-06:00` and `06:00-12:00` compose
 * instead of both matching at 06:00. An equal pair means "all day", because a
 * half-open range with `from === to` would otherwise be empty.
 */
function insideClockRange(minutes, from, to) {
  if (from === to) return true
  if (from < to) return minutes >= from && minutes < to
  // Overnight range, e.g. 22:30-06:00.
  return minutes >= from || minutes < to
}

function hasImageBlock(messages) {
  return messages.some(message => Array.isArray(message?.content)
    && message.content.some(block => block?.type === 'image'))
}

function callsTool(messages, names) {
  const wanted = new Set(names.map(name => name.toLowerCase()))
  return messages.some(message => Array.isArray(message?.content)
    && message.content.some(block => block?.type === 'tool-call'
      && typeof block.name === 'string'
      && wanted.has(block.name.toLowerCase())))
}

function compareCommandOutput(output, rule) {
  const expected = rule.expected
  const actual = output.trim()
  switch (rule.matchMode) {
    case 'equals':
      return actual === expected.trim()
    case 'not-equals':
      return actual !== expected.trim()
    case 'contains':
      return actual.includes(expected)
    case 'regex':
      try {
        return new RegExp(expected).test(actual)
      } catch {
        return false
      }
    default:
      return false
  }
}

/**
 * Evaluate one rule.
 * @param {object} rule - normalized rule.
 * @param {object} context - ambient facts for this request.
 * @returns {Promise<boolean>} whether the rule matches.
 */
export async function matchesRule(rule, context) {
  const { now, messages } = context
  switch (rule.type) {
    case 'time-of-day': {
      const from = parseClock(rule.from)
      const to = parseClock(rule.to)
      if (from === null || to === null) return false
      const parts = clockParts(now, rule.timeZone)
      if (Array.isArray(rule.days) && !rule.days.includes(parts.weekday)) return false
      return insideClockRange(parts.minutes, from, to)
    }
    case 'datetime-range': {
      const from = new Date(rule.from).getTime()
      const to = new Date(rule.to).getTime()
      if (!Number.isFinite(from) || !Number.isFinite(to)) return false
      const at = now.getTime()
      return at >= Math.min(from, to) && at <= Math.max(from, to)
    }
    case 'first-message-keyword': {
      const first = userMessages(messages)[0]
      if (first === undefined) return false
      const text = messageText(first)
      return rule.keywords.some(keyword => containsKeyword(text, keyword, rule.caseSensitive))
    }
    case 'recent-message-keyword': {
      const recent = userMessages(messages).slice(-rule.count)
      if (recent.length === 0) return false
      const text = recent.map(messageText).join('\n')
      return rule.keywords.some(keyword => containsKeyword(text, keyword, rule.caseSensitive))
    }
    case 'image-attempt':
      return hasImageBlock(messages) || callsTool(messages, rule.toolNames)
    case 'command': {
      if (typeof context.runCommand !== 'function') return false
      const output = await context.runCommand(rule)
      if (output === null || output === undefined) return false
      return compareCommandOutput(output, rule)
    }
    case 'recent-failure': {
      const current = context.currentTarget
      if (current === null || current === undefined) return false
      const since = now.getTime() - rule.hours * 60 * 60 * 1000
      const codes = Array.isArray(rule.codes) ? rule.codes : []
      return context.failures.some(failure => failure.at >= since
        && failure.provider === current.provider
        && failure.model === current.model
        && (codes.length === 0 || codes.includes(failure.code)))
    }
    default:
      return false
  }
}

/**
 * Pick the highest-priority matching rule's target, or the fallback.
 * Rule evaluation never throws into the request path: a broken rule (an
 * invalid regular expression, an unreachable command) simply does not match.
 * @param {object} model - normalized virtual model.
 * @param {object} context - ambient facts; `logger` is optional.
 * @returns {Promise<{target: {provider: string, model: string} | null, ruleId: string | null, ruleType: string | null}>}
 */
export async function selectTarget(model, context) {
  for (const rule of model.rules) {
    if (rule.enabled === false) continue
    let matched = false
    try {
      matched = await matchesRule(rule, context)
    } catch (error) {
      context.logger?.warn?.(`auto-model: rule "${rule.id}" (${rule.type}) failed: ${error instanceof Error ? error.message : String(error)}`)
      matched = false
    }
    if (matched) return { target: rule.target, ruleId: rule.id, ruleType: rule.type }
  }
  return { target: model.fallback, ruleId: null, ruleType: null }
}
