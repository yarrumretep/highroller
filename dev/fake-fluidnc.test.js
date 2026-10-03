import { test } from 'node:test'
import assert from 'node:assert/strict'
import { start } from './fake-fluidnc.js'
import { FluidNC } from '../src/lib/fluidnc.js'
import { wifiPercent } from '../src/lib/status.js'
import { probeZ } from '../src/lib/probe.js'

const sleep = ms => new Promise(r => setTimeout(r, ms))

// Puts a file on the fake's SD card, the way the app uploads it.
async function upload(port, name, text) {
  const form = new FormData()
  form.append(`/${name}S`, String(Buffer.byteLength(text)))
  form.append('myfile', new Blob([text]), `/${name}`)
  assert.equal((await fetch(`http://localhost:${port}/upload`, { method: 'POST', body: form })).status, 200)
}

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
    const lines = []
    fnc.onLine = l => lines.push(l)
    await assert.rejects(probeZ(fnc, { fast: 3000, slow: 600, maxDown: 10 }), /No contact/)
    assert.ok(lines.includes('ALARM:5'), 'a miss alarms')
    await sleep(100)
    assert.equal(fnc.status.state, 'Idle') // the routine unlocked to restore G90
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

test('line commands sent during a job wait until its file has been read', async () => {
  const server = start(8101)
  const fnc = new FluidNC({ host: 'localhost:8101' })
  try {
    // 30 moves of 1 mm at 600 mm/min, 0.1 s each: with 16 read ahead, the whole file has been read after about 1.4 s
    const moves = Array.from({ length: 30 }, (_, i) => `G1 X${i + 1} F600`)
    await upload(8101, 'steps.nc', ['G21 G90', ...moves, ''].join('\n'))
    const opened = new Promise(r => { fnc.onConnection = c => c === 'open' && r() })
    fnc.connect()
    await opened
    assert.equal((await fnc.send('$X')).ok, true)
    assert.equal((await fnc.send('$RI=0')).ok, true) // no auto-reports: during the job, reports answer the client's ? polls
    assert.equal((await fnc.send('$SD/Run=/steps.nc')).ok, true)
    const polled = []
    fnc.onStatus = s => polled.push(s)
    const t0 = Date.now()
    assert.equal((await fnc.send('$X')).ok, true)
    const waited = Date.now() - t0
    const at = fnc.status
    assert.ok(waited > 1000, `answered after ${waited} ms`)
    assert.ok(polled.some(s => s.state === 'Run' && s.sd), 'real-time ? is still answered during the job')
    assert.equal(at.sd, null, 'answered only once the whole file had been read')
    assert.equal(at.state, 'Run', 'which, as on FluidNC, is while the last moves still run')
    for (let i = 0; i < 60 && fnc.status.state !== 'Idle'; i++) await sleep(50)
    assert.equal(fnc.status.state, 'Idle')
    assert.ok(Math.abs(fnc.status.mpos[0] - 30) < 1e-6, `x=${fnc.status.mpos[0]}`)
  } finally {
    fnc.close()
    server.close()
  }
})

test('the SD card has folders: per-folder listings, deletedir, and uploads need the folder', async () => {
  const server = start(8089)
  try {
    const list = async dir => (await (await fetch(`http://localhost:8089/upload?path=${encodeURIComponent('/' + (dir ? dir + '/' : ''))}`)).json()).files.map(f => `${f.name}:${f.size}`)
    await fetch('http://localhost:8089/upload?path=%2F&action=createdir&filename=jobs')
    const up = async (path, text) => { const f = new FormData(); f.append(path + 'S', String(text.length)); f.append('myfile', new Blob([text]), path); return (await (await fetch('http://localhost:8089/upload', { method: 'POST', body: f })).json()).status }
    assert.equal(await up('/jobs/a.nc', 'G0 X1'), 'Ok')
    assert.equal(await up('/nope/b.nc', 'G0 X1'), 'Upload failed')
    assert.deepEqual(await list(''), ['jobs:-1'])
    assert.deepEqual(await list('jobs'), ['a.nc:5'])
    await fetch('http://localhost:8089/upload?path=%2F&action=deletedir&filename=jobs')
    assert.deepEqual(await list(''), [])
  } finally {
    server.close()
  }
})

test('SD: disappears once the file has been read, while the last moves still run', async () => {
  const server = start(8102)
  const fnc = new FluidNC({ host: 'localhost:8102' })
  try {
    await upload(8102, 'long-end.nc', 'G21 G90\nG1 X1 F3000\nG1 X50 F3000\n') // the last move takes about 1 s
    const opened = new Promise(r => { fnc.onConnection = c => c === 'open' && r() })
    fnc.connect()
    await opened
    assert.equal((await fnc.send('$X')).ok, true)
    const reports = []
    fnc.onStatus = s => reports.push(s)
    assert.equal((await fnc.send('$SD/Run=/long-end.nc')).ok, true)
    for (let i = 0; i < 60 && fnc.status.state !== 'Idle'; i++) await sleep(50)
    const from = reports.findIndex(s => s.state === 'Run')
    const to = reports.findIndex((s, i) => i > from && s.state === 'Idle')
    assert.ok(from >= 0 && to > from, 'the job ran and ended')
    const job = reports.slice(from, to)
    assert.ok(job.some(s => s.sd), 'SD: while the file was being read')
    assert.ok(job.some(s => !s.sd && s.mpos[0] < 45), 'Run without SD: while the last move was still cutting')
    assert.ok(Math.abs(fnc.status.mpos[0] - 50) < 1e-6, `x=${fnc.status.mpos[0]}`)
  } finally {
    fnc.close()
    server.close()
  }
})
