/**
 * Shell command probes for the command rule: one bounded shell invocation with
 * a cache, so a rule consulted on every request does not pay the command's
 * latency each time.
 */

import { execFile } from 'node:child_process'

const MAX_OUTPUT_BYTES = 1024 * 1024

/**
 * Create the command evaluator shared by every rule.
 * @param {object} options - defaults and diagnostics.
 * @param {number | (() => number)} options.defaultTimeoutMs - timeout when a rule sets none.
 * @param {object} options.logger - Cordis logger.
 * @returns {(rule: object) => Promise<string | null>} trimmed stdout, or null when the command could not run.
 */
export function createCommandRunner({ defaultTimeoutMs, logger }) {
  /** @type {Map<string, {at: number, value: string | null}>} */
  const cache = new Map()
  /** @type {Map<string, Promise<string | null>>} */
  const inflight = new Map()

  const cacheKey = rule => `${rule.id}\u0000${rule.command}\u0000${rule.cwd ?? ''}`

  const execute = (rule) => new Promise((resolve) => {
    const configured = typeof defaultTimeoutMs === 'function' ? defaultTimeoutMs() : defaultTimeoutMs
    const timeout = Number.isFinite(rule.timeoutMs) && rule.timeoutMs > 0 ? rule.timeoutMs : configured
    const child = execFile(
      '/bin/sh',
      ['-c', rule.command],
      {
        cwd: typeof rule.cwd === 'string' && rule.cwd.length > 0 ? rule.cwd : process.cwd(),
        timeout,
        maxBuffer: MAX_OUTPUT_BYTES,
        env: process.env,
      },
      (error, stdout) => {
        if (error !== null && error !== undefined) {
          logger?.debug?.(`auto-model: command rule "${rule.id}" exited with ${error.code ?? error.message}`)
        }
        const text = typeof stdout === 'string' ? stdout.trim() : ''
        resolve(text.length > 0 ? text : (error === null || error === undefined ? '' : null))
      },
    )
    child.on('error', (error) => {
      logger?.debug?.(`auto-model: command rule "${rule.id}" could not start: ${error.message}`)
      resolve(null)
    })
  })

  return async function runCommand(rule) {
    const ttlSeconds = Number.isFinite(rule.cacheSeconds) ? rule.cacheSeconds : 60
    const ttl = Math.max(0, ttlSeconds) * 1000
    const key = cacheKey(rule)
    if (ttl > 0) {
      const hit = cache.get(key)
      if (hit !== undefined && Date.now() - hit.at < ttl) return hit.value
      const pending = inflight.get(key)
      if (pending !== undefined) return pending
    }
    const operation = execute(rule).then((value) => {
      if (ttl > 0) {
        cache.set(key, { at: Date.now(), value })
        if (cache.size > 64) {
          // Bounded cache: drop the oldest entry, which is also the least recently written.
          const oldest = cache.keys().next()
          if (oldest.done !== true) cache.delete(oldest.value)
        }
      }
      return value
    }).finally(() => {
      inflight.delete(key)
    })
    if (ttl > 0) inflight.set(key, operation)
    return operation
  }
}
