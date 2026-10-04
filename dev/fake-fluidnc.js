// A pretend FluidNC for UI work without the machine. It speaks just enough of the protocol:
// binary output frames, status reports, jogging, G0/G1 moves, work offsets, overrides, alarms,
// SD files over HTTP (/upload, /sd/<name>) and running them with $SD/Run, the way 3.9.9 does:
// lines from clients wait while a job's file is being read, and SD: goes once the file has been read.
// Flash files are served at /<name> while Idle or Alarm; [MSG:], [PRB:] and ALARM: lines go to every client.
// ponytail: grows only as features need it; job arcs run as straight lines, G20 and M2/M30 are ignored.
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { pathToFileURL } from 'node:url'
import { WebSocketServer } from 'ws'

const RAPID = 5000 // mm/min
const TICK = 20 // ms
const HOLD_MS = 200 // how long the fake reports Hold:1 (decelerating) before Hold:0
const AXES = 'XYZ'
const MAX_RATE = { X: 9000, Y: 9000, Z: 900 } // mm/min, stock LowRider Jackpot config
const HOME_MS = 1500
const PLANNER_BLOCKS = 16 // moves a job's file is read ahead of the motion (FluidNC's default planner_blocks)
const REFRESH = 10 // like FluidNC, WCO and Ov come in every 10th report (and in the next one after a change)
// Just enough of the stock LowRider config for the app's readers and editors (axes, probe, outputs).
const CONFIG_YAML = `board: Jackpot TMC2209
name: LowRider
planner_blocks: 16

axes:
  x:
    steps_per_mm: 50.000
    max_rate_mm_per_min: 9000.000
    acceleration_mm_per_sec2: 200.000
    max_travel_mm: 1220
    soft_limits: false
    homing:
      cycle: 2
      positive_direction: false
      mpos_mm: 3
    motor0:
      limit_neg_pin: gpio.25:high
      pulloff_mm: 4.000

  y:
    steps_per_mm: 50.000
    max_rate_mm_per_min: 9000.000
    acceleration_mm_per_sec2: 200.000
    max_travel_mm: 2440
    soft_limits: false
    homing:
      cycle: 2
      positive_direction: false
      mpos_mm: 3
    motor0:
      limit_neg_pin: gpio.33:high
      pulloff_mm: 4.000
     #B
    motor1:
      limit_neg_pin: gpio.35:high
      pulloff_mm: 4.000

  z:
    steps_per_mm: 200.000
    max_rate_mm_per_min: 900.000
    acceleration_mm_per_sec2: 80.000
    max_travel_mm: 300.000
    soft_limits: false
    homing:
      cycle: 1
      positive_direction: true
      mpos_mm: 3
    motor0:
      limit_pos_pin: gpio.32:high
      pulloff_mm: 4.000
    motor1:
      limit_pos_pin: gpio.34:high
      pulloff_mm: 4.000

probe:
  pin: gpio.36:low
  check_mode_start: true

coolant:
  flood_pin: gpio.2
  mist_pin: gpio.16

user_outputs:
  digital0_pin: gpio.26
  digital1_pin: gpio.27
`

export function start(port = 8081) {
  const m = { state: 'Alarm', mpos: [0, 0, 0], wco: [0, 0, 0], ov: [100, 100, 100], moves: [], absolute: true, feed: 1000, speed: 0, spindle: 0 }
  const sd = new Map() // the fake SD card: name -> Buffer
  const dirs = new Set() // folders on the fake SD card, as paths without slashes at either end
  const flash = new Map([['config.yaml', Buffer.from(CONFIG_YAML)]]) // the board's flash: config and settings
  let plateZ = -40 // machine Z of the touch plate's top
  let touchUntil = 0 // the probe input reads closed until then (the user tapping the plate to the bit)
  const waiters = [] // G4 replies waiting for motion to finish
  let job = null // { lines, i, pos, size, name } while an SD file is being read
  let pendingLines = [] // [text, ws]: lines from clients, which FluidNC only reads once the job's file has been read
  // Like FluidNC 4.x, any number of clients: replies go to the asker, state changes and alarms to everyone.
  const clients = new Set()
  let ri = 0 // ponytail: one shared report interval; FluidNC keeps one per client
  let lastReport = 0
  let wcoIn = 0, ovIn = 0 // reports until WCO / Ov are included again (0: the next one), shared like FluidNC's counters
  let wifi = 70 // simulated signal %, wanders a little

  const send = (ws, text) => ws.send(Buffer.from(text + '\r\n'), { binary: true })
  const broadcast = text => { for (const ws of clients) send(ws, text) }
  const fmt = v => v.map(n => n.toFixed(3)).join(',')
  const status = ws => {
    const moving = m.state === 'Run' || m.state === 'Jog'
    const feed = moving && m.moves.length ? m.moves[0].feed : 0
    let report = `<${m.state}|MPos:${fmt(m.mpos)}|FS:${feed},${m.spindle}`
    if (Date.now() < touchUntil) report += '|Pn:P'
    if (wcoIn-- <= 0) {
      wcoIn = REFRESH - 1
      report += `|WCO:${fmt(m.wco)}`
    }
    if (ovIn-- <= 0) {
      ovIn = REFRESH - 1
      report += `|Ov:${m.ov.join(',')}`
      if (m.spindle) report += '|A:S'
    }
    if (job) report += `|SD:${Math.min(100, (job.pos / job.size) * 100).toFixed(2)},/sd/${job.name}`
    report += '>'
    if (ws) return send(ws, report)
    lastReport = Date.now()
    broadcast(report)
  }
  const words = text => [...text.matchAll(/([A-Z])\s*(-?\d*\.?\d+)/g)].map(([, w, v]) => [w, Number(v)])
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

  function motion(text, jog, ok) {
    let abs = jog ? true : m.absolute
    let feed = jog ? null : m.feed
    let rapid = false
    let machineCoords = false
    const from = m.moves.at(-1)?.to ?? m.mpos
    const target = [...from]
    for (const [w, v] of words(text)) {
      if (w === 'G' && v === 90) abs = true
      else if (w === 'G' && v === 91) abs = false
      else if (w === 'G' && v === 0) rapid = true
      else if (w === 'G' && v === 53) machineCoords = true
      else if (w === 'F') feed = v
      else if (AXES.includes(w)) {
        const i = AXES.indexOf(w)
        target[i] = abs ? v + (machineCoords ? 0 : m.wco[i]) : target[i] + v
      }
    }
    if (!jog) {
      m.absolute = abs
      if (feed) m.feed = feed
    }
    m.moves.push({
      to: target,
      feed: Math.min(rapid ? RAPID : feed ?? m.feed, Math.min(...[...AXES].filter((_, k) => target[k] !== from[k]).map(a => MAX_RATE[a]))),
      jog,
      rapid,
    })
    if (m.state === 'Idle') m.state = jog ? 'Jog' : 'Run'
    ok()
  }

  // One line of a running SD job: moves (arcs as straight lines) and the spindle; everything else is skipped.
  function jobLine(text) {
    const l = text.replace(/\([^)]*\)|;.*$/g, '').trim().toUpperCase()
    const w = words(l)
    for (const [k, v] of w) {
      if (k === 'S') m.speed = v
      else if (k === 'M' && (v === 3 || v === 4)) m.spindle = m.speed || 1000
      else if (k === 'M' && v === 5) m.spindle = 0
    }
    const skip = w.some(([k, v]) => k === 'G' && [10, 28, 30, 53, 92].includes(v))
    if (!skip && w.some(([k]) => AXES.includes(k))) motion(l, false, () => {})
  }

  function line(text, ws) {
    const reply = t => send(ws, t)
    const ok = () => reply('ok')
    const up = text.trim().toUpperCase()
    if (up === '$CONFIG/FILENAME') { reply('$Config/Filename=config.yaml'); return ok() }
    const show = /^\$LOCALFS\/SHOW=\/?(.+)$/i.exec(text.trim())
    if (show) {
      if (!['Idle', 'Alarm'].includes(m.state)) return reply('error:8')
      const buf = flash.get(show[1])
      if (!buf) return reply('error:62')
      for (const l of buf.toString().replace(/\n$/, '').split('\n')) reply(l)
      return ok()
    }
    if (up === '$BYE') {
      ok()
      setTimeout(() => {
        for (const c of clients) c.close()
        m.state = 'Idle'; m.mpos = [0, 0, 0]; m.moves = []; m.spindle = 0; job = null
      }, 100)
      return
    }
    const home = /^\$H([XYZ])$/.exec(up)
    if (home) {
      m.state = 'Home'
      status()
      setTimeout(() => { m.mpos[AXES.indexOf(home[1])] = 0; m.state = 'Idle'; status(); broadcast(`[MSG:Homed:${home[1]}]`); ok() }, HOME_MS)
      return
    }
    const run = /^\s*\$SD\/RUN=\/?(.+?)\s*$/i.exec(text) // file names keep their case
    if (run) {
      if (m.state === 'Alarm') return reply('error:8') // FluidNC refuses a run only in alarm
      const buf = sd.get(run[1])
      if (!buf) return reply('error:62') // could not open the file
      job = { lines: buf.toString().split('\n'), i: 0, pos: 0, size: buf.length, name: run[1] }
      if (m.state === 'Idle') m.state = 'Run' // otherwise its moves just join those still queued
      status()
      return ok()
    }
    const l = text.trim().toUpperCase()
    if (!l) return
    if (l === '$SYSTEM/STATS=JSON=YES') { // ESP420 as JSON: over the websocket 3.9.9 sends it as bare lines of up to 100 characters, split anywhere
      wifi = clamp(wifi + Math.random() * 10 - 5, 55, 85)
      const json = `{"cmd":"420","status":"ok","data":[{"id":"Chip ID","value":"36942"},{"id":"Signal","value":"${Math.round(wifi)}%"},{"id":"FW version","value":"FluidNC v3.9.9"}]}`
      for (let i = 0; i < json.length; i += 100) reply(json.slice(i, i + 100))
      return ok()
    }
    if (l === '$SYSTEM/STATS') { // the plain form, as 3.9.9 prints it: no signal line
      reply('Chip ID: 36942')
      reply('[MSG:Mode=STA:SSID=shop:Status=Connected:IP=192.168.1.2:MAC=4C-C3-82-2F-4E-90]')
      reply('FW version: FluidNC v3.9.9')
      return ok()
    }
    if (l.startsWith('$RI=')) { // a full report follows $RI
      ri = Number(l.slice(4))
      wcoIn = ovIn = 0
      status(ws)
      broadcast(`[MSG:INFO: auto report interval set to ${ri}]`)
      return ok()
    }
    if (l === '$X') { // unlocks only an alarm; otherwise just ok, as FluidNC does
      if (m.state === 'Alarm') { m.state = 'Idle'; status(); reply('[MSG:INFO: Caution: Unlocked]') }
      return ok()
    }
    if (l === '$H') {
      m.state = 'Home'
      status()
      setTimeout(() => { m.mpos = [0, 0, 0]; m.state = 'Idle'; status(); broadcast('[MSG:Homed:Z]'); broadcast('[MSG:Homed:XY]'); ok() }, HOME_MS) // one line per homing cycle: Z, then XY
      return
    }
    const q = /^\$\/AXES\/([XYZ])\/MAX_RATE_MM_PER_MIN$/.exec(l)
    if (q) { reply(`$/axes/${q[1].toLowerCase()}/max_rate_mm_per_min=${MAX_RATE[q[1]].toFixed(3)}`); return ok() }
    if (m.state === 'Alarm') return reply('error:9') // G-code locked out during alarm
    if (l === 'G90' || l === 'G91') { m.absolute = l === 'G90'; return ok() } // bare mode switches (the probe routine uses them)
    if (/^G4\b/.test(l)) { waiters.push(ok); return } // answered once motion has finished
    const probe = /G38\.2/.test(l)
    if (probe) {
      const z = words(l).find(([w]) => w === 'Z')?.[1] ?? 0
      const from = m.moves.at(-1)?.to ?? m.mpos
      const target = [...from]
      target[2] = m.absolute ? z + m.wco[2] : from[2] + z
      const feed = words(l).find(([w]) => w === 'F')?.[1] ?? m.feed
      m.moves.push({ to: target, feed: Math.min(feed, MAX_RATE.Z), probe: ok })
      if (m.state === 'Idle') m.state = 'Run'
      return
    }
    for (const [w, v] of words(l)) { // live spindle commands
      if (w === 'S') m.speed = v
      else if (w === 'M' && (v === 3 || v === 4)) m.spindle = m.speed || 1000
      else if (w === 'M' && v === 5) m.spindle = 0
    }
    if (l.startsWith('$J=')) return motion(l.slice(3), true, ok)
    if (/^G10\s*L20\s*P[01]/.test(l)) {
      for (const [w, v] of words(l.replace(/^G10\s*L20\s*P[01]/, ''))) {
        if (AXES.includes(w)) m.wco[AXES.indexOf(w)] = m.mpos[AXES.indexOf(w)] - v
      }
      wcoIn = 0 // the new offset goes out in the next report
      status()
      return ok()
    }
    if (/^G10\s*L2\s*P[01]/.test(l)) { // the work origin given directly in machine coordinates
      for (const [w, v] of words(l.replace(/^G10\s*L2\s*P[01]/, ''))) {
        if (AXES.includes(w)) m.wco[AXES.indexOf(w)] = v
      }
      wcoIn = 0
      status()
      return ok()
    }
    if (/^(G53\s*)?(G9[01]\s*)?G[01]\b/.test(l)) return motion(l, false, ok)
    ok()
  }

  function realtime(c, ws) {
    const code = c.codePointAt(0)
    if (c === '?') return status(ws)
    if (c === '!') {
      if (m.state === 'Jog') { m.moves = []; m.state = 'Idle' } // a hold during a jog cancels it
      else if (m.state === 'Run') {
        m.state = 'Hold:1'
        setTimeout(() => { if (m.state === 'Hold:1') { m.state = 'Hold:0'; status() } }, HOLD_MS)
      }
      return status()
    }
    if (c === '~') { if (m.state === 'Hold:0') m.state = 'Run'; return status() } // ignored until the hold is complete
    if (code === 0x18) {
      const wasMoving = m.state === 'Run' || m.state === 'Jog' || m.state === 'Hold:1'
      m.moves = []
      job = null
      pendingLines = [] // a reset flushes what clients sent, as FluidNC does
      m.spindle = 0
      if (m.state !== 'Alarm') m.state = wasMoving ? 'Alarm' : 'Idle'
      broadcast("Grbl 3.9 [FluidNC fake, '$' for help]")
      if (wasMoving) broadcast('ALARM:3')
      return status()
    }
    if (code === 0x85) { if (m.state === 'Jog') { m.moves = []; m.state = 'Idle' } return status() }
    const [f, r, s] = m.ov
    const ov = {
      0x90: [100, r, s], 0x91: [f + 10, r, s], 0x92: [f - 10, r, s], 0x93: [f + 1, r, s], 0x94: [f - 1, r, s],
      0x95: [f, 100, s], 0x96: [f, 50, s], 0x97: [f, 25, s],
      0x99: [f, r, 100], 0x9a: [f, r, s + 10], 0x9b: [f, r, s - 10], 0x9c: [f, r, s + 1], 0x9d: [f, r, s - 1],
    }[code]
    if (ov) {
      m.ov = [clamp(ov[0], 10, 200), ov[1], clamp(ov[2], 10, 200)]
      ovIn = 0 // the change goes out in the next report
    }
  }

  const timer = setInterval(() => {
    // Read a running SD job up to planner_blocks moves ahead, like FluidNC filling its planner from the file
    while (job && m.state === 'Run' && m.moves.length < PLANNER_BLOCKS && job.i < job.lines.length) {
      const text = job.lines[job.i++]
      job.pos += Buffer.byteLength(text) + 1
      jobLine(text)
    }
    if (job && job.i >= job.lines.length) {
      job = null // the whole file has been read: SD: goes now, while the last moves are still being cut
      if (!m.moves.length) m.state = 'Idle' // a file without moves
      status()
    }
    while (!job && pendingLines.length) line(...pendingLines.shift()) // in order, until one starts another job
    const mv = m.moves[0]
    if (mv && (m.state === 'Run' || m.state === 'Jog')) {
      const pct = mv.jog ? 100 : mv.rapid ? m.ov[1] : m.ov[0]
      const stepMm = ((mv.feed * pct) / 100 / 60000) * TICK
      const d = mv.to.map((t, i) => t - m.mpos[i])
      const dist = Math.hypot(...d)
      if (dist <= stepMm) {
        m.mpos = [...mv.to]
        m.moves.shift()
        if (mv.probe) { // reached the end without touching
          broadcast(`[PRB:${fmt(m.mpos)}:0]`)
          broadcast('ALARM:5')
          m.state = 'Alarm'
          m.moves = []
          mv.probe()
          return status()
        }
      } else {
        m.mpos = m.mpos.map((p, i) => p + (d[i] / dist) * stepMm)
        if (mv.probe && m.mpos[2] <= plateZ) { // touched the plate
          m.mpos[2] = plateZ
          m.moves.shift()
          broadcast(`[PRB:${fmt(m.mpos)}:1]`)
          mv.probe()
        }
      }
      if (!m.moves.length && !job) { m.state = 'Idle'; status() }
    }
    if (!m.moves.length) while (waiters.length) waiters.shift()()
    if (ri && (m.state === 'Run' || m.state === 'Jog' || m.state === 'Home') && Date.now() - lastReport >= ri) status()
  }, TICK)

  const json = (res, body) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body))
  }
  const listingOf = map => ({
    files: [...map].map(([name, buf]) => ({ name, shortname: name, size: buf.length, datetime: '' })),
    path: '/',
    total: '1.00 GB',
    used: '0.01 GB',
    occupation: 1,
    status: 'Ok',
  })
  const norm = p => (p ?? '/').replace(/^\/+|\/+$/g, '') // '/jobs/' → 'jobs', '/' → ''
  const parent = p => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
  const entriesOf = dir => [
    ...[...dirs].filter(d => parent(d) === dir).map(d => ({ name: d.slice(dir ? dir.length + 1 : 0), shortname: d, size: -1, datetime: '' })),
    ...[...sd].filter(([p]) => parent(p) === dir).map(([p, buf]) => ({ name: p.slice(dir ? dir.length + 1 : 0), shortname: p, size: buf.length, datetime: '' })),
  ]
  const dirListing = (dir, status = 'Ok') => ({
    files: entriesOf(dir),
    path: '/',
    total: '1.00 GB',
    used: '0.01 GB',
    occupation: 1,
    status,
  })
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://fake')
    if (url.pathname === '/') { // the built app, so it can be tried without Vite (no HMR reloads mid-wizard)
      try { const html = await readFile(new URL('../dist/index.html', import.meta.url)); res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(html) } catch { res.writeHead(404); return res.end('run npm run build first') }
    }
    if (url.pathname === '/fake/touch') { touchUntil = Date.now() + 800; status(); res.writeHead(200); return res.end() }
    if (url.pathname === '/fake/plate') { plateZ = Number(url.searchParams.get('z')); res.writeHead(200); return res.end() }
    if (url.pathname === '/files' && req.method === 'POST') {
      const body = Readable.toWeb(req)
      const form = await new Request(url, { method: 'POST', headers: { 'content-type': req.headers['content-type'] }, body, duplex: 'half' }).formData()
      for (const [, v] of form) if (typeof v !== 'string') flash.set(v.name.replace(/^\//, ''), Buffer.from(await v.arrayBuffer()))
      return json(res, listingOf(flash))
    }
    if (url.pathname === '/files') return json(res, listingOf(flash))
    if (url.pathname === '/upload' && req.method === 'POST') {
      const body = Readable.toWeb(req)
      const form = await new Request(url, { method: 'POST', headers: { 'content-type': req.headers['content-type'] }, body, duplex: 'half' }).formData()
      let result = 'Ok' // "status" would shadow the status() broadcast function above
      let dir = ''
      for (const [, v] of form) {
        if (typeof v !== 'string') {
          const p = v.name.replace(/^\//, '')
          dir = parent(p)
          if (dir !== '' && !dirs.has(dir)) { result = 'Upload failed'; continue } // the folder does not exist: store nothing
          sd.set(p, Buffer.from(await v.arrayBuffer()))
        }
      }
      return json(res, dirListing(dir, result))
    }
    if (url.pathname === '/upload') {
      const dir = norm(url.searchParams.get('path'))
      const name = url.searchParams.get('filename')
      const action = url.searchParams.get('action')
      const full = dir ? `${dir}/${name}` : name
      let status = 'Ok'
      if (action === 'createdir' && name) { dirs.add(full); status = `${name} created` }
      else if (action === 'delete' && name) { sd.delete(full); status = `${name} deleted` }
      else if (action === 'deletedir' && name) {
        for (const d of [...dirs]) if (d === full || d.startsWith(`${full}/`)) dirs.delete(d)
        for (const [p] of [...sd]) if (p === full || p.startsWith(`${full}/`)) sd.delete(p)
        status = `${name} deleted`
      }
      return json(res, dirListing(dir, status))
    }
    const file = url.pathname.startsWith('/sd/') && sd.get(decodeURIComponent(url.pathname.slice(4)))
    if (file) {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      return res.end(file)
    }
    const onFlash = /^\/([^/]+)$/.exec(url.pathname)
    if (onFlash && req.method === 'GET') { // a flash file, refused during motion as FluidNC does
      if (!['Idle', 'Alarm'].includes(m.state)) { res.writeHead(503); return res.end('Busy') }
      const buf = flash.get(decodeURIComponent(onFlash[1]))
      res.writeHead(buf ? 200 : 404, { 'Content-Type': 'text/plain' })
      return res.end(buf ?? 'Not found')
    }
    res.writeHead(404)
    res.end()
  })

  const wss = new WebSocketServer({ server })
  wss.on('connection', ws => {
    clients.add(ws)
    ws.send('currentID:0') // text control frame, as FluidNC sends
    let buf = ''
    ws.on('message', data => {
      for (const c of data.toString()) { // UTF-8 decoded: override bytes arrive as single characters
        if ('?!~\x18'.includes(c) || c.codePointAt(0) >= 0x80) realtime(c, ws)
        else if (c === '\n') {
          if (job || pendingLines.length) pendingLines.push([buf, ws]) // a job's file is being read: lines wait
          else line(buf, ws)
          buf = ''
        } else if (c !== '\r') buf += c
      }
    })
    ws.on('close', () => {
      clients.delete(ws)
      pendingLines = pendingLines.filter(([, w]) => w !== ws) // its waiting lines go with it
    })
  })
  server.listen(port)

  return {
    close() {
      clearInterval(timer)
      for (const ws of wss.clients) ws.terminate()
      wss.close()
      server.closeAllConnections()
      server.close()
    },
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 8081)
  start(port)
  console.log(`Fake FluidNC on ws://localhost:${port}/ (files on http://localhost:${port}/upload and /files)`)
}
