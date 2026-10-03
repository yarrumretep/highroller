import { test } from 'node:test'
import assert from 'node:assert/strict'
import { start } from './fake-fluidnc.js'
import { FluidNC } from '../src/lib/fluidnc.js'
import { wifiPercent } from '../src/lib/status.js'
import { probeZ } from '../src/lib/probe.js'

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

test('$System/Stats reports a Wi-Fi signal percentage', async () => {
  const server = start(8094)
  const fnc = new FluidNC({ host: 'localhost:8094' })
  try {
    const opened = new Promise(r => { fnc.onConnection = c => c === 'open' && r() })
    fnc.connect()
    await opened
    const r = await fnc.send('$System/Stats', { quiet: true })
    const pct = wifiPercent(r.lines)
    assert.ok(pct >= 55 && pct <= 85, `signal=${pct}`)
  } finally {
    fnc.close()
    server.close()
  }
})

test('probing finds the plate, the probe input can be touched, and a miss alarms', async () => {
  const server = start(8093)
  const fnc = new FluidNC({ host: 'localhost:8093' })
  try {
    const opened = new Promise(r => { fnc.onConnection = c => c === 'open' && r() })
    fnc.connect()
    await opened
    assert.equal((await fnc.send('$X')).ok, true)
    let sawPin = false
    fnc.onStatus = s => { if (s.pins.includes('P')) sawPin = true }
    await fetch('http://localhost:8093/fake/touch', { method: 'POST' })
    await sleep(300)
    assert.ok(sawPin, 'Pn:P after a touch')
    const r = await probeZ(fnc, { fast: 3000, slow: 600, maxDown: 50 })
    assert.ok(Math.abs(r.z - -40) < 1e-6, `z=${r.z}`)
    await fetch('http://localhost:8093/fake/plate?z=-200', { method: 'POST' })
    await assert.rejects(probeZ(fnc, { fast: 3000, slow: 600, maxDown: 10 }), /No contact/)
    await sleep(100)
    assert.equal(fnc.status.state, 'Alarm')
  } finally {
    fnc.close()
    server.close()
  }
})

test('G4 waits for motion, G53 uses machine coordinates, and $HZ homes only Z', async () => {
  const server = start(8092)
  const fnc = new FluidNC({ host: 'localhost:8092' })
  try {
    const opened = new Promise(r => { fnc.onConnection = c => c === 'open' && r() })
    fnc.connect()
    await opened
    await fnc.send('$X')
    await fnc.send('G10 L20 P0 X-5') // work X0 is now at machine X5
    await fnc.send('G53 G0 X20 F3000')
    const t0 = Date.now()
    assert.equal((await fnc.send('G4 P0')).ok, true)
    assert.ok(Date.now() - t0 > 100, 'G4 waited for the move')
    await sleep(150)
    assert.ok(Math.abs(fnc.status.mpos[0] - 20) < 1e-6, `mpos x=${fnc.status.mpos[0]}`)
    await fnc.send('G0 Z-30')
    await fnc.send('G4 P0')
    const p = fnc.send('$HZ')
    await sleep(1700)
    assert.equal((await p).ok, true)
    assert.ok(Math.abs(fnc.status.mpos[2]) < 1e-6 && Math.abs(fnc.status.mpos[0] - 20) < 1e-6)
  } finally {
    fnc.close()
    server.close()
  }
})

test('flash files: show, filename, upload, and $Bye restarts', async () => {
  const server = start(8091)
  const fnc = new FluidNC({ host: 'localhost:8091' })
  try {
    const opened = new Promise(r => { fnc.onConnection = c => c === 'open' && r() })
    fnc.connect()
    await opened
    assert.deepEqual((await fnc.send('$Config/Filename', { quiet: true })).lines, ['$Config/Filename=config.yaml'])
    const shown = await fnc.send('$LocalFS/Show=/config.yaml', { quiet: true })
    assert.ok(shown.lines.some(l => l.trim() === 'pulloff_mm: 4.000'))
    assert.equal((await fnc.send('$LocalFS/Show=/missing.json', { quiet: true })).ok, false)
    const form = new FormData()
    form.append('/highroller.json', '')
    form.append('/highroller.jsonS', '12')
    form.append('myfile', new Blob(['{"step":10}\n']), '/highroller.json')
    assert.equal((await fetch('http://localhost:8091/files', { method: 'POST', body: form })).status, 200)
    assert.deepEqual((await fnc.send('$LocalFS/Show=/highroller.json', { quiet: true })).lines, ['{"step":10}'])
    const closed = new Promise(r => { fnc.onConnection = c => c === 'closed' && r() })
    assert.equal((await fnc.send('$Bye')).ok, true)
    await closed
  } finally {
    fnc.close()
    server.close()
  }
})
