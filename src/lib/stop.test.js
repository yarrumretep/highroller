import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stopMachine } from './stop.js'

const flush = () => new Promise(r => setImmediate(r))
// MockTimers jumps the clock to the end of a tick, and promise callbacks only run when we yield: step and flush.
async function advance(t, ms) {
  for (let i = 0; i < ms; i += 50) {
    t.mock.timers.tick(50)
    await flush()
  }
}

function fakes(state, sub = null) {
  const calls = []
  const fnc = { status: { state, sub }, hold: () => calls.push('hold'), reset: () => calls.push('reset') }
  const jogger = { stop: () => calls.push('jog stop') }
  return { fnc, jogger, calls }
}

test('cancels jogging and holds before anything else', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const { fnc, jogger, calls } = fakes('Run')
  stopMachine(fnc, jogger)
  assert.deepEqual(calls, ['jog stop', 'hold'])
})

test('waits through Run and Hold:1, then resets once the hold completes', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const { fnc, jogger, calls } = fakes('Run')
  const done = stopMachine(fnc, jogger)
  await advance(t, 300)
  fnc.status = { state: 'Hold', sub: 1 }
  await advance(t, 300)
  assert.deepEqual(calls, ['jog stop', 'hold'])
  fnc.status = { state: 'Hold', sub: 0 }
  await advance(t, 100)
  assert.deepEqual(calls, ['jog stop', 'hold', 'reset'])
  await done
})

test('resets right after the settle time when nothing is moving', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const { fnc, jogger, calls } = fakes('Idle')
  const done = stopMachine(fnc, jogger)
  await advance(t, 100)
  assert.deepEqual(calls, ['jog stop', 'hold'])
  await advance(t, 100)
  assert.deepEqual(calls, ['jog stop', 'hold', 'reset'])
  await done
})

test('gives up waiting after 2 s and resets anyway', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const { fnc, jogger, calls } = fakes('Hold', 1)
  const done = stopMachine(fnc, jogger)
  await advance(t, 2000)
  assert.deepEqual(calls, ['jog stop', 'hold'])
  await advance(t, 300)
  assert.deepEqual(calls, ['jog stop', 'hold', 'reset'])
  await done
})
