import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createJogger } from './jog.js'

function fakeFnc() {
  const f = { sent: [], rt: [], pending: [], drops: [], status: { mpos: [0, 0, 0] } }
  f.send = line => new Promise(resolve => { f.sent.push(line); f.pending.push(resolve) })
  f.realtime = code => f.rt.push(code)
  f.jogCancel = () => f.rt.push(0x85)
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

test('a machine slower than commanded never gets more than 0.6 s of jog distance queued', t => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] })
  const f = fakeFnc() // mpos never changes: the machine is not keeping up at all
  const j = createJogger(f)
  j.start('Z', 1, 1500) // 2.5 mm per 0.1 s move; 0.6 s at 1500 mm/min = 15 mm
  for (let i = 0; i < 40; i++) t.mock.timers.tick(50) // hold 2 s
  assert.equal(f.sent.length, 6)
  f.status.mpos = [0, 0, 5] // it has now travelled 5 mm
  t.mock.timers.tick(50)
  assert.equal(f.sent.length, 8)
  j.stop()
})

test('a late timer tick does not send a burst of catch-up moves', t => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] })
  const f = fakeFnc()
  const j = createJogger(f)
  j.start('X', 1, 3000) // 3 moves queued
  f.status.mpos = [1000, 0, 0] // far travelled, so only the clock limits sending
  t.mock.timers.tick(2000) // every interval callback sees the clock at 2 s
  assert.equal(f.sent.length, 6) // one 0.3 s top-up, not 2 s worth
  j.stop()
})
