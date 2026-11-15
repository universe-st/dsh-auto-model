/**
 * Auto model (切模插件) Host plugin.
 *
 * It registers one real LLM provider route whose advertised models are virtual
 * models written by the user, and routes every request for that provider to a
 * real provider/model chosen by ordered switching rules. Requests are forwarded
 * at the `llm/stream` waterfall, before the runtime binds an adapter or strips
 * another adapter's replay state, so a forwarded call is exactly the call the
 * real model would have received.
 *
 * The current real model per Session is kept in this plugin's own memory and
 * mirrored into a Session projection for the user-only hint in the session
 * list. It never enters the model-visible log.
 */

import z from '@deepseek-ai/schemastery'
import { z as zod } from 'zod'
import {
  PROVIDER_ID,
  PROVIDER_NAME,
  PROJECTION_KEY,
  normalizeLive,
  pruneFailures,
} from './lib/state.js'
import { selectTarget } from './lib/rules.js'
import { routeRequest } from './lib/router.js'
import { createCommandRunner } from './lib/command.js'

/** Only the LLM registry is mandatory; the projection registry is optional. */
export const inject = ['llm']

/**
 * The routing document lives in one volatile field so the configuration page
 * can rewrite the whole document while the plugin keeps running.
 */
export const Config = z.object({
  live: z.object({
    virtualModels: z.array(z.any()).default([]),
    defaultCommandTimeoutMs: z.number().default(8000),
    retryBudgetMs: z.number().default(90000),
    maxSwitches: z.number().default(4),
    logRouting: z.boolean().default(false),
  }).volatile(),
})

/** A provider route that runs its own recovery, so the harness must not retry it twice. */
const ROUTE_RETRY_POLICY = Object.freeze({
  mode: 'normal',
  maxRetries: 0,
  retryableCodes: Object.freeze(['SERVER']),
  backoff: Object.freeze({ initialDelayMs: 500, maxDelayMs: 10000, jitterRatio: 0.1 }),
})

const MODEL_BADGE = Object.freeze({ text: Object.freeze({ en: 'Auto', zh: '自切' }), tone: 'info' })

const MAX_SESSION_STATES = 200

/** @param {number} milliseconds @param {AbortSignal | undefined} signal */
function delay(milliseconds, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted === true) {
      resolve()
      return
    }
    const timer = setTimeout(finish, milliseconds)
    function finish() {
      clearTimeout(timer)
      signal?.removeEventListener('abort', finish)
      resolve()
    }
    signal?.addEventListener('abort', finish, { once: true })
  })
}

const CAPABILITY_FIELDS = ['context', 'defaultMaxTokens', 'reasoning', 'systemPromptUpdate', 'toolUpdate', 'inputModalities']

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {object} config - validated plugin configuration.
 */
export async function apply(ctx, config) {
  const logger = ctx.logger
  const liveSource = config?.live
  /** Read the current document; a volatile reference is re-read on every request. */
  const readLive = () => normalizeLive(
    liveSource !== null && typeof liveSource === 'object' && typeof liveSource.get === 'function'
      ? liveSource.get()
      : liveSource,
  )

  /** @type {Map<string, {current: object | null, failures: object[], record: object | null, touched: number}>} */
  const sessions = new Map()
  /** @type {Map<string, object | null>} */
  const records = new Map()

  const sessionState = (key) => {
    let state = sessions.get(key)
    if (state === undefined) {
      if (sessions.size >= MAX_SESSION_STATES) {
        let oldestKey
        let oldest = Infinity
        for (const [candidate, entry] of sessions) {
          if (entry.touched < oldest) {
            oldest = entry.touched
            oldestKey = candidate
          }
        }
        if (oldestKey !== undefined) {
          sessions.delete(oldestKey)
          records.delete(oldestKey)
        }
      }
      state = { current: null, failures: [], record: null, touched: Date.now() }
      sessions.set(key, state)
    }
    state.touched = Date.now()
    return state
  }

  const providerNames = () => {
    const names = new Map()
    for (const provider of ctx.llm.listProviders()) names.set(provider.id, provider.name)
    return names
  }

  const publishRecord = (sessionKey, modelId, target, info) => {
    if (typeof sessionKey !== 'string' || sessionKey.length === 0 || sessionKey === '@no-session') return
    const model = readLive().virtualModels.find(candidate => candidate.id === modelId)
    const next = Object.freeze({
      virtualModel: modelId,
      virtualName: model?.name ?? modelId,
      provider: target.provider,
      providerName: providerNames().get(target.provider) ?? target.provider,
      model: target.model,
      modelName: typeof info?.name === 'string' && info.name.length > 0 ? info.name : target.model,
      at: Date.now(),
    })
    const previous = records.get(sessionKey)
    if (previous !== undefined && previous !== null
      && previous.virtualModel === next.virtualModel
      && previous.provider === next.provider
      && previous.model === next.model
      && previous.modelName === next.modelName) {
      return
    }
    records.set(sessionKey, next)
    const state = sessionState(sessionKey)
    state.record = next
  }

  const clearRecord = (sessionKey) => {
    if (!records.has(sessionKey)) return
    records.set(sessionKey, null)
    const state = sessions.get(sessionKey)
    if (state !== undefined) state.record = null
  }

  // A Session that moves away from the virtual provider no longer has a real
  // model to report, so the hint disappears instead of going stale.
  ctx.effect(() => ctx.on('session/event', (session, event) => {
    if (event?.type !== 'request/context') return
    if (event.data?.provider === PROVIDER_ID) return
    clearRecord(String(session?.id ?? ''))
  }), 'auto-model: clear real-model hint on provider change')

  const runCommand = createCommandRunner({
    defaultTimeoutMs: () => readLive().defaultCommandTimeoutMs,
    logger,
  })

  const deps = {
    logger,
    live: readLive,
    now: () => new Date(),
    select: (model, context) => {
      const pending = selectTarget(model, context)
      if (!readLive().logRouting) return pending
      return pending.then((selection) => {
        logger.info('auto-model: %s -> %s/%s%s', model.id,
          selection.target?.provider ?? '-', selection.target?.model ?? '-',
          selection.ruleId === null ? ' (fallback)' : ` (rule ${selection.ruleId})`)
        return selection
      })
    },
    modelFor: (id) => readLive().virtualModels.find(model => model.id === id) ?? null,
    failuresFor: (key) => sessionState(key).failures,
    recordFailure: (key, target, failure) => {
      const state = sessionState(key)
      state.failures = pruneFailures([
        ...state.failures,
        {
          at: Date.now(),
          provider: target.provider,
          model: target.model,
          code: typeof failure?.code === 'string' && failure.code.length > 0 ? failure.code : 'UNKNOWN',
        },
      ]).slice(-64)
      logger.debug(`auto-model: ${target.provider}/${target.model} failed with ${failure?.code ?? 'UNKNOWN'}`)
    },
    currentTargetFor: (key) => sessionState(key).current,
    setCurrentTarget: (key, target) => {
      sessionState(key).current = target
    },
    /**
     * Attach the request to the exact target route. The target's capability
     * metadata decides what the forwarded call may carry; an effort the target
     * does not advertise is dropped rather than failing the request.
     */
    forwardOptions: async (options, target) => {
      const info = await ctx.llm.resolveModelInfo(target.provider, target.model, options.signal)
      publishRecord(String(options.sessionId ?? ''), options.model, target, info)
      const forwarded = { ...options, provider: target.provider, model: target.model }
      const effort = options.reasoningEffort
      if (effort !== undefined) {
        const supported = info.reasoning?.efforts?.some(candidate => candidate.id === effort) === true
        if (supported) forwarded.reasoningEffort = effort
        else delete forwarded.reasoningEffort
      }
      return forwarded
    },
    streamReal: (forwarded) => ctx.llm.stream(forwarded),
    retryPolicyFor: (provider) => {
      try {
        return ctx.llm.providerRetryPolicy(provider)
      } catch (error) {
        logger.debug(`auto-model: no retry policy for ${provider}: ${error instanceof Error ? error.message : String(error)}`)
        return undefined
      }
    },
    runCommand: (rule) => runCommand(rule),
    sleep: delay,
  }

  /** @type {{providerInfo: Function, providerRetryPolicy: Function, listModels: Function, resolveModel: Function, stream: Function}} */
  const adapter = {
    providerInfo: provider => ({ id: provider, name: PROVIDER_NAME }),
    // Recovery belongs to this router: the harness sees a finished outcome.
    providerRetryPolicy: () => ROUTE_RETRY_POLICY,
    listModels: async (provider) => readLive().virtualModels.map(model => ({
      provider,
      id: model.id,
      name: model.name,
      ...model.description.length > 0 ? { description: model.description } : {},
      badge: MODEL_BADGE,
    })),
    resolveModel: async (provider, modelId, signal) => {
      const model = readLive().virtualModels.find(candidate => candidate.id === modelId)
      const base = {
        provider,
        id: modelId,
        name: model?.name ?? modelId,
        ...model !== undefined && model.description.length > 0 ? { description: model.description } : {},
      }
      if (model === undefined) return base
      const capability = model.capability ?? model.fallback
      if (capability === null) return base
      try {
        const info = await ctx.llm.resolveModelInfo(capability.provider, capability.model, signal)
        const picked = {}
        for (const field of CAPABILITY_FIELDS) {
          if (info[field] !== undefined) picked[field] = info[field]
        }
        return { ...base, ...picked }
      } catch (error) {
        logger.debug(`auto-model: capability model ${capability.provider}/${capability.model} is unavailable: ${error instanceof Error ? error.message : String(error)}`)
        return base
      }
    },
    // Bind the exact model metadata the runtime will validate the call against.
    prepareCall: async (provider, modelId, signal) => {
      const model = await adapter.resolveModel(provider, modelId, signal)
      return { model, stream: options => adapter.stream(options) }
    },
    // Reached only if a caller dispatches the adapter directly; the waterfall
    // normally answers first, with the request still whole.
    stream: (options) => routeRequest(options, deps),
    // The virtual route forwards to a real one, so it declares no pricing and
    // keeps image dimensions untouched.
    imageRequestPricing: () => undefined,
    imageRequestTarget: (provider, modelId, image) => ({
      width: image.width,
      height: image.height,
      maxBytes: image.bytes,
    }),
  }

  ctx.effect(() => ctx.llm.registerAdapter([PROVIDER_ID], adapter), 'auto-model: provider route')

  // Intercept before the runtime binds the virtual adapter: the forwarded call
  // is then dispatched with the real route's own adapter, replay state and
  // image/tool projections intact.
  ctx.effect(() => ctx.on('llm/stream', (options, next) => {
    if (options?.provider !== PROVIDER_ID) return next()
    return routeRequest(options, deps)
  }), 'auto-model: request router')

  // A saved document changes the advertised model catalog.
  ctx.effect(() => ctx.on('loader/volatile-update', (paths) => {
    if (!Array.isArray(paths)) return
    if (paths.some(path => !Array.isArray(path) || path.length === 0 || path[0] === 'live')) {
      ctx.emit('llm/models-updated', PROVIDER_ID)
    }
  }), 'auto-model: catalog invalidation')

  const projections = ctx.get('sessionProjections')
  if (projections !== undefined) {
    // Projection schemas are zod schemas, unlike the schemastery Config above.
    const routeSchema = zod.object({
      virtualModel: zod.string(),
      virtualName: zod.string(),
      provider: zod.string(),
      providerName: zod.string(),
      model: zod.string(),
      modelName: zod.string(),
      at: zod.number(),
    })
    const definition = {
      key: PROJECTION_KEY,
      stateSchema: zod.object({
        sessionId: zod.string(),
        // The user-only real-model hint; null once the Session leaves the virtual provider.
        route: routeSchema.nullable(),
        at: zod.number(),
      }),
      stateVersion: 1,
      init: header => ({ sessionId: String(header?.id ?? ''), route: null, at: 0 }),
      // This record is plugin-owned, not folded from the log: it is a derived
      // display cache, and `records.has` distinguishes "not observed in this
      // process" from an explicit clear.
      apply: (state, event) => {
        if (!records.has(state.sessionId)) return state
        const next = records.get(state.sessionId) ?? null
        if (next === state.route) return state
        return { sessionId: state.sessionId, route: next, at: typeof event?.seq === 'number' ? event.seq : state.at }
      },
      wire: {
        viewSchema: routeSchema.nullable(),
        view: state => state.route,
      },
    }
    await projections.register(definition)
    logger.debug('auto-model: session projection registered')
  } else {
    logger.debug('auto-model: session projections unavailable; the session-list hint stays off')
  }

  logger.info('auto-model: provider %s registered with %d virtual model(s)', PROVIDER_ID, readLive().virtualModels.length)
}
