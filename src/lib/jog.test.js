import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createJogger } from './jog.js'

function fakeFnc() {
  const f = { sent: [], rt: [], pending: [], drops: [] }
  f.send = line => new Promise(resolve => { f.sent.push(line); f.pending.push(resolve) })
  f.realtime = code => f.rt.push(code)
  f.dropQueued = match => f.drops.push(match)
  return f
}

const flush = () => new Promise(r => setImmediate(r))

test('a tap sends one jog move of the step size', () => {
  const f = fakeFnc()
  createJogger(f).step('X', -10, 3000)
  assert.deepEqual(f.sent, ['$J=G91 G21 X-10 F3000'])
})

test('holding keeps 0.1 s moves queued at least 0.25 s ahead', t => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] })
  const f = fakeFnc()
  const j = createJogger(f)
  j.start('Y', 1, 3000) // 3000 mm/min = 5 mm per 0.1 s
  assert.deepEqual(f.sent, Array(3).fill('$J=G91 G21 Y5 F3000'))
  t.mock.timers.tick(50)
  assert.equal(f.sent.length, 3) // still 250 ms ahead
  t.mock.timers.tick(50)
  assert.equal(f.sent.length, 4) // down to 200 ms: topped up
  j.stop()
})

test('release drops queued jog moves, cancels the jog and stops sending', t => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] })
  const f = fakeFnc()
  const j = createJogger(f)
  j.start('Z', -1, 600)
  assert.equal(f.sent[0], '$J=G91 G21 Z-1 F600')
  j.stop()
  assert.deepEqual(f.rt, [0x85])
  assert.equal(f.drops.length, 1)
  assert.equal(f.drops[0]('$J=G91 G21 Z-1 F600'), true)
  assert.equal(f.drops[0]('G0 X1'), false)
  const n = f.sent.length
  t.mock.timers.tick(500)
  assert.equal(f.sent.length, n)
})

test('a move accepted after release gets a second cancel', async t => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] })
  const f = fakeFnc()
  const j = createJogger(f)
  j.start('X', 1, 3000)
  j.stop()
  f.pending[0]({ ok: true, error: null, lines: [] }) // it was already in flight
  await flush()
  assert.deepEqual(f.rt, [0x85, 0x85])
})

test('moves accepted while still holding do not cancel', async t => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] })
  const f = fakeFnc()
  const j = createJogger(f)
  j.start('X', 1, 3000)
  f.pending[0]({ ok: true, error: null, lines: [] })
  await flush()
  assert.deepEqual(f.rt, [])
  j.stop()
})

test('stop without a hold does nothing', () => {
  const f = fakeFnc()
  createJogger(f).stop()
  assert.deepEqual(f.rt, [])
})
