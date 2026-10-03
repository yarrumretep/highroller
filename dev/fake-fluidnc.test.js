import { test } from 'node:test'
import assert from 'node:assert/strict'
import { start } from './fake-fluidnc.js'
import { FluidNC } from '../src/lib/fluidnc.js'

const sleep = ms => new Promise(r => setTimeout(r, ms))

test('the app client can unlock, jog and see the new position', async () => {
  const server = start(8099)
  const fnc = new FluidNC({ host: 'localhost:8099' })
  const opened = new Promise(r => { fnc.onConnection = c => c === 'open' && r() })
  fnc.connect()
  await opened
  assert.equal((await fnc.send('$X')).ok, true)
  const r = await fnc.send('$/axes/z/max_rate_mm_per_min')
  assert.deepEqual(r.lines, ['$/axes/z/max_rate_mm_per_min=900.000'])
  assert.equal((await fnc.send('$J=G91 G21 X5 F3000')).ok, true)
  await sleep(400)
  assert.equal(fnc.status.state, 'Idle')
  assert.ok(Math.abs(fnc.status.mpos[0] - 5) < 1e-6, `x=${fnc.status.mpos[0]}`)
  assert.equal((await fnc.send('G10 L20 P0 X0')).ok, true)
  await sleep(300)
  assert.ok(Math.abs(fnc.status.wpos[0]) < 1e-6)
  fnc.close()
  server.close()
})

test('two clients stay connected at once, like FluidNC 4.x', async () => {
  const server = start(8097)
  const conns = [[], []]
  const clients = conns.map(c => new FluidNC({ host: 'localhost:8097', onConnection: s => c.push(s) }))
  try {
    for (const fnc of clients) fnc.connect()
    await sleep(1500)
    assert.deepEqual(conns, [['connecting', 'open'], ['connecting', 'open']])
    assert.equal((await clients[0].send('$X')).ok, true)
    assert.equal((await clients[1].send('$J=G91 G21 X5 F3000')).ok, true)
    await sleep(400)
    for (const fnc of clients) assert.ok(Math.abs(fnc.status.mpos[0] - 5) < 1e-6, `x=${fnc.status.mpos[0]}`)
  } finally {
    for (const fnc of clients) fnc.close() // a reconnecting client would keep the test process alive
    server.close()
  }
})

test('an uploaded file runs with $SD/Run and reports its progress', async () => {
  const server = start(8096)
  const fnc = new FluidNC({ host: 'localhost:8096' })
  try {
    const form = new FormData()
    form.append('/job.ncS', '26')
    form.append('myfile', new Blob(['G21 G90\nG0 X5\nG1 X10 F600\n']), '/job.nc')
    assert.equal((await fetch('http://localhost:8096/upload', { method: 'POST', body: form })).status, 200)
    const opened = new Promise(r => { fnc.onConnection = c => c === 'open' && r() })
    fnc.connect()
    await opened
    assert.equal((await fnc.send('$X')).ok, true)
    const seen = []
    fnc.onStatus = s => s.sd && seen.push(s.sd)
    assert.equal((await fnc.send('$SD/Run=/job.nc')).ok, true)
    await sleep(1500)
    assert.ok(seen.length > 0)
    assert.equal(seen[0].file, '/sd/job.nc')
    assert.equal(fnc.status.state, 'Idle')
    assert.equal(fnc.status.sd, null)
    assert.ok(Math.abs(fnc.status.mpos[0] - 10) < 1e-6, `x=${fnc.status.mpos[0]}`)
  } finally {
    fnc.close()
    server.close()
  }
})

test('feed override bytes change the reported override', async () => {
  const server = start(8098)
  const fnc = new FluidNC({ host: 'localhost:8098' })
  const opened = new Promise(r => { fnc.onConnection = c => c === 'open' && r() })
  fnc.connect()
  await opened
  fnc.realtime(0x91) // +10 %
  fnc.realtime(0x93) // +1 %
  fnc.realtime(0x3f)
  await sleep(200)
  assert.deepEqual(fnc.status.ov, [111, 100, 100])
  fnc.close()
  server.close()
})
