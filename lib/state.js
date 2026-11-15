/**
 * Normalization of the user-written routing document.
 *
 * The configuration is stored as one volatile JSON blob (`live`), so this
 * module is deliberately tolerant: an entry the user cannot finish editing
 * yet (an empty provider field, for example) is dropped from the effective
 * state instead of failing activation. Nothing here touches Cordis.
 */

/** Provider route owned by this plugin; also the value the GUI shows as a provider id. */
export const PROVIDER_ID = 'auto-model'
/** Provider name shown by model selectors and session logs. */
export const PROVIDER_NAME = '切模插件'
/** Session projection key that carries the user-visible real-model hint. */
export const PROJECTION_KEY = 'autoModelRoute'

/** Rule kinds the router understands. */
export const RULE_TYPES = Object.freeze([
  'time-of-day',
  'datetime-range',
  'first-message-keyword',
  'recent-message-keyword',
  'image-attempt',
  'command',
  'recent-failure',
])

/** Tool-call names treated as an image-viewing attempt by the default rule. */
export const DEFAULT_IMAGE_TOOLS = Object.freeze([
  'read_image',
  'view_image',
  'inspect_image',
  'screenshot',
  'browser_take_screenshot',
  'computer_screenshot',
])

/** Defaults for the settings blob; every field is user-editable from the page. */
export const DEFAULT_LIVE = Object.freeze({
  virtualModels: [],
  defaultCommandTimeoutMs: 8000,
  /** Hard stop for one target's internal retries in milliseconds; 0 disables the stop. */
  retryBudgetMs: 90_000,
  /** Maximum model switches within one request. */
  maxSwitches: 4,
  /** Log one line per routing decision at info level. */
  logRouting: false,
})

const MAX_FAILURE_AGE_MS = 24 * 60 * 60 * 1000

/** An empty but valid routing document. */
export function emptyLive() {
  return {
    virtualModels: [],
    defaultCommandTimeoutMs: DEFAULT_LIVE.defaultCommandTimeoutMs,
    retryBudgetMs: DEFAULT_LIVE.retryBudgetMs,
    maxSwitches: DEFAULT_LIVE.maxSwitches,
    logRouting: DEFAULT_LIVE.logRouting,
  }
}

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function finiteNumber(value, fallback, min = 0) {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) && number >= min ? number : fallback
}

function positiveInteger(value, fallback, max) {
  const number = Math.round(finiteNumber(value, fallback, 1))
  return max === undefined ? number : Math.min(number, max)
}

/**
 * Normalize one `{ provider, model }` target.
 * @param {unknown} raw - candidate value.
 * @returns {{provider: string, model: string} | null} the target, or null when unusable.
 */
export function normalizeTarget(raw) {
  if (raw === null || typeof raw !== 'object') return null
  const provider = cleanString(raw.provider)
  const model = cleanString(raw.model)
  if (provider.length === 0 || model.length === 0) return null
  // A virtual model may not forward to the virtual provider: that would recurse.
  if (provider === PROVIDER_ID) return null
  return { provider, model }
}

function normalizeStringList(raw) {
  if (!Array.isArray(raw)) return []
  return raw.map(cleanString).filter(value => value.length > 0)
}

function normalizeTimestamp(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : null
}

/** Whether a string is an IANA time zone this runtime can resolve. */
export function isValidTimeZone(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value.trim() })
    return true
  } catch {
    return false
  }
}

function normalizeClock(value) {
  const text = cleanString(value)
  const match = /^(\d{1,2}):(\d{2})$/.exec(text)
  if (match === null) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return null
  return hour * 60 + minute
}

function normalizeWeekdays(raw) {
  if (!Array.isArray(raw)) return null
  const days = raw
    .map(day => Math.round(Number(day)))
    .filter(day => Number.isInteger(day) && day >= 1 && day <= 7)
  return days.length === 0 ? null : [...new Set(days)].sort((left, right) => left - right)
}

/**
 * Normalize one rule; returns null for a rule that cannot be evaluated.
 * @param {unknown} raw - rule as written by the page.
 * @param {number} index - position, used for a synthetic id.
 */
export function normalizeRule(raw, index) {
  if (raw === null || typeof raw !== 'object') return null
  const type = cleanString(raw.type)
  if (!RULE_TYPES.includes(type)) return null
  const target = normalizeTarget(raw.target)
  if (target === null) return null
  const rule = {
    id: cleanString(raw.id) || `rule-${index}`,
    type,
    enabled: raw.enabled !== false,
    target,
  }
  switch (type) {
    case 'time-of-day': {
      const from = normalizeClock(raw.from)
      const to = normalizeClock(raw.to)
      if (from === null || to === null) return null
      rule.from = raw.from
      rule.to = raw.to
      const days = normalizeWeekdays(raw.days)
      if (days !== null) rule.days = days
      const zone = cleanString(raw.timeZone)
      if (zone.length > 0) {
        // An unresolvable zone throws on every request, so such a rule is
        // dropped here instead of becoming a rule that can never match.
        if (!isValidTimeZone(zone)) return null
        rule.timeZone = zone
      }
      return rule
    }
    case 'datetime-range': {
      const from = normalizeTimestamp(raw.from)
      const to = normalizeTimestamp(raw.to)
      if (from === null || to === null) return null
      rule.from = raw.from
      rule.to = raw.to
      return rule
    }
    case 'first-message-keyword':
    case 'recent-message-keyword': {
      const keywords = normalizeStringList(raw.keywords)
      if (keywords.length === 0) return null
      rule.keywords = keywords
      rule.caseSensitive = raw.caseSensitive === true
      if (type === 'recent-message-keyword') {
        rule.count = positiveInteger(raw.count, 3, 200)
      }
      return rule
    }
    case 'image-attempt': {
      const tools = normalizeStringList(raw.toolNames)
      rule.toolNames = tools.length > 0 ? tools : [...DEFAULT_IMAGE_TOOLS]
      return rule
    }
    case 'command': {
      const command = cleanString(raw.command)
      if (command.length === 0) return null
      rule.command = command
      rule.expected = typeof raw.expected === 'string' ? raw.expected : ''
      const mode = cleanString(raw.matchMode)
      rule.matchMode = ['equals', 'contains', 'regex', 'not-equals'].includes(mode) ? mode : 'equals'
      rule.cacheSeconds = finiteNumber(raw.cacheSeconds, 60, 0)
      const timeout = finiteNumber(raw.timeoutMs, 0, 0)
      if (timeout > 0) rule.timeoutMs = timeout
      const cwd = cleanString(raw.cwd)
      if (cwd.length > 0) rule.cwd = cwd
      return rule
    }
    case 'recent-failure': {
      rule.hours = finiteNumber(raw.hours, 1, 0.01)
      rule.codes = normalizeStringList(raw.codes)
      return rule
    }
    default:
      return null
  }
}

/**
 * Normalize one virtual model; returns null when it has no usable id or fallback.
 * @param {unknown} raw - model as written by the page.
 * @param {number} index - position, used for diagnostics.
 */
export function normalizeVirtualModel(raw, index) {
  if (raw === null || typeof raw !== 'object') return null
  const id = cleanString(raw.id)
  if (id.length === 0 || id.includes('/') || /\s/.test(id)) return null
  const fallback = normalizeTarget(raw.fallback)
  const model = {
    id,
    name: cleanString(raw.name) || id,
    description: cleanString(raw.description),
    fallback,
    capability: normalizeTarget(raw.capability),
    rules: [],
  }
  if (Array.isArray(raw.rules)) {
    const seen = new Set()
    const rules = []
    for (let position = 0; position < raw.rules.length; position += 1) {
      const rule = normalizeRule(raw.rules[position], position)
      if (rule === null) continue
      let key = rule.id
      // Two rules sharing an id make drag ordering and command caching ambiguous.
      while (seen.has(key)) key = `${key}-${position}`
      seen.add(key)
      rule.id = key
      rules.push(rule)
    }
    model.rules = rules
  }
  return model
}

/**
 * Normalize the whole routing document.
 * @param {unknown} raw - `config.live.get()`.
 * @returns {{virtualModels: object[], defaultCommandTimeoutMs: number, retryBudgetMs: number, maxSwitches: number, logRouting: boolean, duplicates: string[]}}
 */
export function normalizeLive(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  const models = []
  const duplicates = []
  const seen = new Set()
  if (Array.isArray(source.virtualModels)) {
    for (let index = 0; index < source.virtualModels.length; index += 1) {
      const model = normalizeVirtualModel(source.virtualModels[index], index)
      if (model === null) continue
      if (seen.has(model.id)) {
        duplicates.push(model.id)
        continue
      }
      seen.add(model.id)
      models.push(model)
    }
  }
  return {
    virtualModels: models,
    defaultCommandTimeoutMs: positiveInteger(source.defaultCommandTimeoutMs, DEFAULT_LIVE.defaultCommandTimeoutMs, 600_000),
    retryBudgetMs: finiteNumber(source.retryBudgetMs, DEFAULT_LIVE.retryBudgetMs, 0),
    maxSwitches: positiveInteger(source.maxSwitches, DEFAULT_LIVE.maxSwitches, 20),
    logRouting: source.logRouting === true,
    duplicates,
  }
}

/** Trim a failure ledger to the window it can still influence. */
export function pruneFailures(failures, now = Date.now()) {
  return failures.filter(failure => now - failure.at <= MAX_FAILURE_AGE_MS)
}
