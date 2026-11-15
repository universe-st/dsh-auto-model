/**
 * Shell command probes for the command rule: one bounded shell invocation with
 * a cache, so a rule consulted on every request does not pay the command's
 * latency each time.
 */

import { spawn } from 'node:child_process'

const MAX_OUTPUT_BYTES = 1024 * 1024
/** How long to wait for a killed process group to report its exit. */
const KILL_TIMEOUT_MS = 2000

/**
 * Run one shell command in its own process group.
 *
 * The group matters: a plain `timeout` option kills only the `sh` this plugin
 * started, so a command that spawns a long child (a probe script, a `sleep`)
 * keeps running after the probe was abandoned. Every path that gives up —
 * timeout, output overflow, a group that does not exit — resolves with
 * `gaveUp: true` and leaves no survivors behind.
 *
 * @param {string} command - shell text.
 * @param {{cwd: string, timeoutMs: number}} options - execution bounds.
 * @returns {Promise<{output: string | null, code: number | null, gaveUp: boolean, error?: Error}>}
 */
function runShell(command, { cwd, timeoutMs }) {
  return new Promise((resolve) => {
    let settled = false
    let stdout = ''
    let gaveUp = false
    let timeoutTimer = null
    let killTimer = null
    let child = null

    const settle = (result) => {
      if (settled) return
      settled = true
      if (timeoutTimer !== null) clearTimeout(timeoutTimer)
      if (killTimer !== null) clearTimeout(killTimer)
      resolve(result)
    }

    const abandon = () => {
      gaveUp = true
      if (child === null || child.pid === undefined) {
        settle({ output: null, code: null, gaveUp })
        return
      }
      try {
        // Negative pid addresses the whole group, including grandchildren.
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        try { child.kill('SIGKILL') } catch { /* already gone */ }
      }
      // A group stuck in an uninterruptible state must not hold the request open.
      killTimer = setTimeout(() => settle({ output: null, code: null, gaveUp }), KILL_TIMEOUT_MS)
      killTimer.unref?.()
    }

    try {
      child = spawn('/bin/sh', ['-c', command], {
        cwd,
        env: process.env,
        detached: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
    } catch (error) {
      settle({ output: null, code: null, gaveUp: false, error })
      return
    }

    if (Number.isFinite(timeoutMs) && timeoutMs > 0) timeoutTimer = setTimeout(abandon, timeoutMs)

    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk) => {
      if (gaveUp) return
      if (stdout.length + chunk.length > MAX_OUTPUT_BYTES) {
        abandon()
        return
      }
      stdout += chunk
    })
    child.on('error', (error) => {
      settle({ output: null, code: null, gaveUp: false, error })
    })
    child.on('close', (code) => {
      if (gaveUp) {
        settle({ output: null, code: null, gaveUp })
        return
      }
      const text = stdout.trim()
      settle({ output: text.length > 0 ? text : code === 0 ? '' : null, code, gaveUp: false })
    })
  })
}

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

  const execute = async (rule) => {
    const configured = typeof defaultTimeoutMs === 'function' ? defaultTimeoutMs() : defaultTimeoutMs
    const timeout = Number.isFinite(rule.timeoutMs) && rule.timeoutMs > 0 ? rule.timeoutMs : configured
    const cwd = typeof rule.cwd === 'string' && rule.cwd.length > 0 ? rule.cwd : process.cwd()
    const result = await runShell(rule.command, { cwd, timeoutMs: timeout })
    if (result.gaveUp) {
      logger?.debug?.(`auto-model: command rule "${rule.id}" was killed (timeout or output limit)`)
      return null
    }
    if (result.error !== undefined) {
      logger?.debug?.(`auto-model: command rule "${rule.id}" could not start: ${result.error.message}`)
      return null
    }
    if (result.code !== 0) {
      logger?.debug?.(`auto-model: command rule "${rule.id}" exited with ${result.code}`)
    }
    return result.output
  }

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
