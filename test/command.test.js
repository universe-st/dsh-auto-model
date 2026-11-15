import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createCommandRunner } from '../lib/command.js'

const quiet = { debug() {}, info() {}, warn() {} }

test('a command probe returns trimmed stdout', async () => {
  const run = createCommandRunner({ defaultTimeoutMs: 5000, logger: quiet })
  assert.equal(await run({ id: 'r1', command: 'printf "  cheap \\n"', cacheSeconds: 0 }), 'cheap')
})

test('a non-zero exit without output resolves null', async () => {
  const run = createCommandRunner({ defaultTimeoutMs: 5000, logger: quiet })
  assert.equal(await run({ id: 'r2', command: 'exit 3', cacheSeconds: 0 }), null)
})

test('a cached probe runs once, and concurrent callers share one run', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'auto-model-cmd-'))
  const counter = join(dir, 'runs')
  const run = createCommandRunner({ defaultTimeoutMs: 5000, logger: quiet })
  const cached = { id: 'r3', command: `printf x >> ${counter}; printf ok`, cacheSeconds: 60 }
  assert.equal(await run(cached), 'ok')
  assert.equal(await run(cached), 'ok')
  assert.equal(await readFile(counter, 'utf8'), 'x')

  const slow = { id: 'r4', command: `printf y >> ${counter}; sleep 0.1; printf ok`, cacheSeconds: 60 }
  const [first, second] = await Promise.all([run(slow), run(slow)])
  assert.equal(first, 'ok')
  assert.equal(second, 'ok')
  assert.equal(await readFile(counter, 'utf8'), 'xy')
})

test('a timeout kills the whole process group and resolves null', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'auto-model-cmd-'))
  const marker = join(dir, 'survivor')
  const run = createCommandRunner({ defaultTimeoutMs: 80, logger: quiet })
  const started = Date.now()
  // The background child would outlive a kill aimed at `sh` alone; the marker
  // proves whether the group really died.
  const value = await run({
    id: 'r5',
    command: `(sleep 0.6; printf survived > ${marker}) & sleep 5; printf done`,
    cacheSeconds: 0,
  })
  const elapsed = Date.now() - started
  assert.equal(value, null)
  assert.ok(elapsed < 3000, `resolved in ${elapsed}ms`)
  await new Promise(resolve => setTimeout(resolve, 900))
  await assert.rejects(readFile(marker, 'utf8'))
})
