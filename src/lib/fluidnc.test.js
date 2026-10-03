import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FluidNC } from './fluidnc.js'

class FakeWS {
  static all = []
  constructor(url, protocols) {
    this.url = url
    this.protocols = protocols
    this.sent = []
    this.readyState = 0
    FakeWS.all.push(this)
  }
  send(data) { this.sent.push(data) }
  close() { this.readyState = 3 }
  // test helpers
  open() { this.readyState = 1; this.onopen?.() }
  rx(text) { this.onmessage?.({ data: new TextEncoder().encode(text).buffer }) }
  drop() { this.readyState = 3; this.onclose?.() }
}

// MockTimers jumps Date to the end of a tick (timers scheduled during it don't run),
// so walk the clock forward in small steps.
const advance = (t, ms) => { for (let i = 0; i < ms; i += 50) t.mock.timers.tick(50) }

function setup(t, host = 'cnc.local') {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'] })
  FakeWS.all = []
  const events = { status: [], lines: [], conn: [] }
  const fnc = new FluidNC({
    host,
    WebSocket: FakeWS,
    onStatus: s => events.status.push(s),
    onLine: l => events.lines.push(l),
    onConnection: c => events.conn.push(c),
  })
  fnc.connect()
  return { fnc, events, ws: () => FakeWS.all.at(-1) }
}

test('connects to port 80 first and turns on auto-reporting', t => {
  const { ws, events } = setup(t)
  assert.equal(ws().url, 'ws://cnc.local/')
  assert.equal(ws().binaryType, 'arraybuffer')
  ws().open()
  assert.deepEqual(events.conn, ['connecting', 'open'])
  assert.deepEqual(ws().sent, ['$RI=100\n'])
})

test('connect() while already connected does not open a second socket', t => {
  const { fnc, ws } = setup(t)
  ws().open()
  fnc.connect()
  assert.equal(FakeWS.all.length, 1)
})

test('falls back to the FluidNC 3.x port 81 when port 80 never opens', t => {
  const { ws } = setup(t)
  ws().drop()
  advance(t, 500)
  assert.equal(ws().url, 'ws://cnc.local:81/')
  assert.deepEqual(ws().protocols, ['arduino'])
})

test('a host with an explicit port only uses that address', t => {
  const { ws } = setup(t, 'localhost:8081')
  ws().drop()
  advance(t, 500)
  assert.equal(ws().url, 'ws://localhost:8081/')
})

test('reassembles lines split across frames and routes status reports', t => {
  const { ws, events } = setup(t)
  ws().open()
  ws().rx('<Idle|MPos:1,2,3|FS:0,0|WC')
  ws().rx('O:0,0,0>\r\n[MSG:INFO: hi]\r\n')
  assert.equal(events.status.length, 1)
  assert.deepEqual(events.status[0].wpos, [1, 2, 3])
  assert.deepEqual(events.lines, ['[MSG:INFO: hi]'])
})

test('ignores text control frames', t => {
  const { ws, events } = setup(t)
  ws().open()
  ws().onmessage({ data: 'currentID:3' })
  assert.deepEqual(events.lines, [])
})

test('sends one command at a time and resolves with its output', async t => {
  const { fnc, ws } = setup(t)
  ws().open()
  ws().rx('ok\n') // answers $RI=100
  const a = fnc.send('$Config/Filename')
  const b = fnc.send('G0 X1')
  assert.deepEqual(ws().sent.slice(1), ['$Config/Filename\n'])
  ws().rx('<Idle|MPos:0,0,0|FS:0,0>\n$Config/Filename=config.yaml\nok\n')
  assert.deepEqual(await a, { ok: true, error: null, lines: ['$Config/Filename=config.yaml'] })
  assert.deepEqual(ws().sent.slice(1), ['$Config/Filename\n', 'G0 X1\n'])
  ws().rx('error:20\n')
  assert.deepEqual(await b, { ok: false, error: 20, lines: [] })
})

test('real-time bytes go out immediately, even with a command in flight', t => {
  const { fnc, ws } = setup(t)
  ws().open() // $RI=100 is in flight, unanswered
  fnc.realtime(0x21)
  fnc.realtime(0x85)
  assert.deepEqual(ws().sent, ['$RI=100\n', '!', '\x85'])
})

test('refuses commands while disconnected instead of queueing motion', async t => {
  const { fnc } = setup(t)
  assert.deepEqual(await fnc.send('G0 X1'), { ok: false, error: 'disconnected', lines: [] })
})

test('a dropped link fails pending commands and reconnects to the same address', async t => {
  const { fnc, ws } = setup(t)
  ws().open()
  const p = fnc.send('G0 X1')
  ws().drop()
  assert.equal((await p).error, 'disconnected')
  advance(t, 500)
  assert.equal(FakeWS.all.length, 2)
  assert.equal(ws().url, 'ws://cnc.local/')
})

test('polls with ? when quiet and drops a link that stays silent', t => {
  const { ws } = setup(t)
  ws().open()
  const first = ws()
  advance(t, 500)
  assert.ok(first.sent.includes('?'))
  advance(t, 3500)
  assert.equal(first.readyState, 3)
  assert.equal(FakeWS.all.length, 2)
})

test('reset sends Ctrl-X and fails everything pending', async t => {
  const { fnc, ws } = setup(t)
  ws().open()
  const p = fnc.send('G0 X100')
  fnc.reset()
  assert.equal(ws().sent.at(-1), '\x18')
  assert.equal((await p).error, 'reset')
})

test('dropQueued cancels matching commands that have not been sent', async t => {
  const { fnc, ws } = setup(t)
  ws().open() // $RI=100 in flight
  const j1 = fnc.send('$J=G91 X1 F100')
  const g = fnc.send('G0 X1')
  const j2 = fnc.send('$J=G91 X1 F100')
  fnc.dropQueued(l => l.startsWith('$J='))
  assert.equal((await j1).error, 'cancelled')
  assert.equal((await j2).error, 'cancelled')
  ws().rx('ok\n')
  assert.equal(ws().sent.at(-1), 'G0 X1\n')
  ws().rx('ok\n')
  assert.equal((await g).ok, true)
})

test('quiet commands keep their output out of onLine, except alarms and messages', async t => {
  const { fnc, ws, events } = setup(t)
  ws().open()
  ws().rx('ok\n') // answers $RI=100, which is not quiet
  const p = fnc.send('$/axes/z/max_rate_mm_per_min', { quiet: true })
  ws().rx('$/axes/z/max_rate_mm_per_min=900.000\nALARM:1\n[MSG:ERR: Bad GCode]\nok\n')
  assert.deepEqual((await p).lines, ['$/axes/z/max_rate_mm_per_min=900.000', 'ALARM:1', '[MSG:ERR: Bad GCode]'])
  assert.deepEqual(events.lines, ['ok', 'ALARM:1', '[MSG:ERR: Bad GCode]'])
})

test('a restart banner fails the in-flight command, reaches onLine despite quiet, and later commands work', async t => {
  const { fnc, ws, events } = setup(t)
  ws().open()
  ws().rx('ok\n') // answers $RI=100
  const p = fnc.send('$/axes/z/max_rate_mm_per_min', { quiet: true })
  const banner = "Grbl 3.9 [FluidNC v3.9.9 (wifi) '$' for help]"
  ws().rx(`${banner}\n`) // FluidNC restarted elsewhere and never answers the line in flight
  assert.deepEqual(await p, { ok: false, error: 'controller restarted', lines: [] })
  assert.deepEqual(events.lines, ['ok', banner])
  const q = fnc.send('G0 X1')
  ws().rx('ok\n')
  assert.equal((await q).ok, true)
})

test("the app's own reset is unaffected when the banner then arrives", async t => {
  const { fnc, ws } = setup(t)
  ws().open()
  const p = fnc.send('G0 X100')
  fnc.reset() // already fails the queue before the banner arrives
  assert.equal((await p).error, 'reset')
  ws().rx("Grbl 3.9 [FluidNC v3.9.9 (wifi) '$' for help]\n") // finds nothing in flight
  const q = fnc.send('G0 X1')
  ws().rx('ok\n')
  assert.equal((await q).ok, true)
})

test('hold, resume and jogCancel send their real-time bytes', t => {
  const { fnc, ws } = setup(t)
  ws().open()
  fnc.hold()
  fnc.resume()
  fnc.jogCancel()
  assert.deepEqual(ws().sent.slice(1), ['!', '~', '\x85'])
})
