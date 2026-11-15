/**
 * The request router: select a target, stream it, retry it, and switch when a
 * target cannot answer.
 *
 * Transparency rules this loop enforces:
 * - Nothing is forwarded to the caller until the attempt produces its first
 *   visible chunk, so a retried or switched attempt is invisible above.
 * - A failure after visible output cannot be retried without duplicating
 *   content, so it is reported as the stream's terminal failure.
 * - Retries follow the real route's own policy; switching happens only after
 *   that policy is exhausted, and re-selection happens with the recorded
 *   failure in scope so a "recent failure" rule can take over.
 */

const DEFAULT_BACKOFF = Object.freeze({ initialDelayMs: 500, maxDelayMs: 10_000, jitterRatio: 0.1 })

function targetKey(target) {
  return `${target.provider}\u0000${target.model}`
}

function isVisibleChunk(chunk) {
  return chunk.type === 'block-start'
    || chunk.type === 'text-delta'
    || chunk.type === 'reasoning-delta'
    || chunk.type === 'tool-call-delta'
    || chunk.type === 'block-end'
}

function terminalChunk(failure, aborted) {
  return {
    type: 'finish',
    reason: aborted
      ? { kind: 'aborted', failure }
      : { kind: 'error', failure },
  }
}

function booleanFailure(message, code) {
  return { message, code }
}

/** Symmetric-jitter exponential backoff, honoring a provider Retry-After inside the bounds. */
export function backoffDelay(policy, attempt, failure) {
  const after = failure?.providerRetryAfterMs
  const maxDelay = Number.isFinite(policy?.maxDelayMs) ? policy.maxDelayMs : DEFAULT_BACKOFF.maxDelayMs
  if (Number.isFinite(after) && after > 0 && after <= maxDelay) return Math.round(after)
  const initial = Number.isFinite(policy?.initialDelayMs) ? policy.initialDelayMs : DEFAULT_BACKOFF.initialDelayMs
  const jitter = Number.isFinite(policy?.jitterRatio) ? policy.jitterRatio : DEFAULT_BACKOFF.jitterRatio
  const raw = Math.min(initial * 2 ** Math.max(0, attempt - 1), maxDelay)
  const factor = 1 + (Math.random() * 2 - 1) * jitter
  return Math.max(1, Math.round(raw * factor))
}

/** Whether the resolved policy still allows another attempt for this failure. */
export function policyAllowsRetry(policy, failure, retriesSoFar) {
  if (policy === undefined || policy === null) return false
  if (policy.mode === 'always') return true
  const codes = Array.isArray(policy.retryableCodes) ? policy.retryableCodes : []
  if (!codes.includes(failure.code)) return false
  return retriesSoFar < (Number.isFinite(policy.maxRetries) ? policy.maxRetries : 0)
}

/**
 * Route one request.
 * @param {object} options - the `GenerateOptions` the caller built.
 * @param {object} deps - injected runtime facts and effects; see index.js.
 * @returns {AsyncGenerator<object>} the caller-visible stream chunks.
 */
export async function* routeRequest(options, deps) {
  const logger = deps.logger
  const signal = options.signal
  const sessionKey = typeof options.sessionId === 'string' && options.sessionId.length > 0
    ? options.sessionId
    : '@no-session'
  // Auxiliary producers (session titles, compaction summaries) share the Session
  // but not its conversation route: they read the current target and never
  // publish their own, so a title call cannot steal the conversation's failover
  // state while the main request is retrying.
  const tracksConversation = options.purpose === undefined

  const abortedFinish = () => terminalChunk(booleanFailure('the model request was cancelled', 'ABORTED'), true)

  if (signal?.aborted === true) {
    yield abortedFinish()
    return
  }

  const model = deps.modelFor(options.model)
  if (model === null) {
    yield terminalChunk(booleanFailure(`no auto model is configured with id "${options.model}"`, 'INVALID_REQUEST'), false)
    return
  }
  if (model.fallback === null) {
    yield terminalChunk(booleanFailure(`auto model "${model.id}" has no fallback model configured`, 'INVALID_CONFIG'), false)
    return
  }

  const tried = new Set()
  let lastFailure = null
  const live = deps.live()
  /** Set by a failover decision so the next iteration does not re-select the spent target. */
  let pendingSelection = null

  for (let switchCount = 0; switchCount <= live.maxSwitches; switchCount += 1) {
    let selection = pendingSelection
    pendingSelection = null
    if (selection === null) {
      const context = {
        now: deps.now(),
        messages: options.messages,
        failures: deps.failuresFor(sessionKey),
        currentTarget: deps.currentTargetFor(sessionKey),
        runCommand: deps.runCommand,
        logger,
      }
      selection = await deps.select(model, context)
    }
    if (signal?.aborted === true) {
      yield abortedFinish()
      return
    }
    if (selection.target === null) {
      const message = selection.ruleId === null
        ? `auto model "${model.id}" has no usable fallback model`
        : `rule "${selection.ruleId}" of auto model "${model.id}" has no usable target`
      yield terminalChunk(booleanFailure(message, 'INVALID_CONFIG'), false)
      return
    }

    tried.add(targetKey(selection.target))
    if (tracksConversation) deps.setCurrentTarget(sessionKey, selection.target)

    const retriesForTarget = []
    const startedAt = deps.now().getTime()
    let attempted = false

    for (let attempt = 1; ; attempt += 1) {
      if (signal?.aborted === true) {
        yield abortedFinish()
        return
      }
      let forwarded
      try {
        forwarded = await deps.forwardOptions(options, selection.target)
      } catch (error) {
        lastFailure = booleanFailure(
          `cannot forward to ${selection.target.provider}/${selection.target.model}: ${error instanceof Error ? error.message : String(error)}`,
          'NO_ADAPTER',
        )
        if (tracksConversation) deps.recordFailure(sessionKey, selection.target, lastFailure)
        break
      }

      let committed = false
      let pending = []
      let finishChunk = null
      let attemptFailure = null
      attempted = true

      try {
        const stream = deps.streamReal(forwarded)
        for await (const chunk of stream) {
          if (chunk.type === 'finish') {
            finishChunk = chunk
            break
          }
          if (!committed) {
            if (!isVisibleChunk(chunk)) {
              // Usage alone is not observable content: hold it until the attempt commits.
              pending.push(chunk)
              continue
            }
            committed = true
            for (const held of pending) yield held
            pending = []
          }
          yield chunk
        }
      } catch (error) {
        attemptFailure = {
          message: error instanceof Error ? error.message : String(error),
          code: typeof error?.code === 'string' ? error.code : 'UNKNOWN',
        }
        lastFailure = attemptFailure
        if (tracksConversation) deps.recordFailure(sessionKey, selection.target, attemptFailure)
        break
      }

      if (finishChunk !== null) {
        const reason = finishChunk.reason
        if (reason.kind !== 'error' && reason.kind !== 'aborted') {
          for (const held of pending) yield held
          yield finishChunk
          return
        }
        attemptFailure = reason.failure
        lastFailure = attemptFailure
        if (tracksConversation) deps.recordFailure(sessionKey, selection.target, attemptFailure)
        if (committed || reason.kind === 'aborted' || signal?.aborted === true) {
          // Visible output (or cancellation) makes a transparent retry dishonest.
          yield terminalChunk(attemptFailure, reason.kind === 'aborted' || signal?.aborted === true)
          return
        }
      } else if (attemptFailure === null) {
        // A stream that ends without a terminal finish chunk breaks the adapter
        // contract; treat it as an empty answer instead of reading a null failure.
        attemptFailure = { message: 'the provider stream ended without a result', code: 'EMPTY_RESPONSE' }
        lastFailure = attemptFailure
        if (tracksConversation) deps.recordFailure(sessionKey, selection.target, attemptFailure)
      }

      const policy = deps.retryPolicyFor(selection.target.provider)
      const elapsed = deps.now().getTime() - startedAt
      const withinBudget = live.retryBudgetMs <= 0 || elapsed < live.retryBudgetMs
      const retryCount = retriesForTarget.length
      if (!withinBudget || !policyAllowsRetry(policy, attemptFailure, retryCount)) break
      const delay = backoffDelay(policy, retryCount + 1, attemptFailure)
      retriesForTarget.push({ at: deps.now().getTime(), code: attemptFailure.code, delay })
      logger?.debug?.(`auto-model: ${selection.target.provider}/${selection.target.model} failed (${attemptFailure.code}); retry ${retryCount + 1} in ${delay}ms`)
      await deps.sleep(delay, signal)
      if (signal?.aborted === true) {
        yield abortedFinish()
        return
      }
    }

    if (signal?.aborted === true) {
      yield abortedFinish()
      return
    }
    if (!attempted) {
      // Forwarding never started; treat as an exhausted target and try to switch.
      logger?.debug?.('auto-model: target was never attempted')
    }

    // The target is exhausted: re-select with the freshly recorded failure in scope.
    const next = await deps.select(model, {
      now: deps.now(),
      messages: options.messages,
      failures: deps.failuresFor(sessionKey),
      currentTarget: deps.currentTargetFor(sessionKey),
      runCommand: deps.runCommand,
      logger,
    })
    let nextTarget = next.target
    if (nextTarget === null || tried.has(targetKey(nextTarget))) {
      // A configured fallback is the last resort once the matched target is spent.
      nextTarget = model.fallback !== null && !tried.has(targetKey(model.fallback)) ? model.fallback : null
    }
    if (nextTarget === null) {
      yield terminalChunk(lastFailure ?? booleanFailure('every configured target failed', 'UNKNOWN'), false)
      return
    }
    pendingSelection = { target: nextTarget, ruleId: next.ruleId, ruleType: next.ruleType }
    deps.logger?.info?.(`auto-model: switching ${selection.target.provider}/${selection.target.model} -> ${nextTarget.provider}/${nextTarget.model}${next.ruleId === null ? '' : ` (rule ${next.ruleId})`}`)
    logger?.debug?.(`auto-model: request ${options.sessionId ?? '-'} switched to ${nextTarget.provider}/${nextTarget.model}`)
  }

  yield terminalChunk(lastFailure ?? booleanFailure('no auto model target could answer the request', 'UNKNOWN'), false)
}
