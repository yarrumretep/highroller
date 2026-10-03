// A pretend FluidNC for UI work without the machine. It speaks just enough of the protocol:
// binary output frames, status reports, jogging, G0/G1 moves, work offsets, overrides, alarms,
// SD files over HTTP (/upload, /sd/<name>) and running them with $SD/Run.
// ponytail: grows only as features need it; job arcs run as straight lines and G20 is ignored.
import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { pathToFileURL } from 'node:url'
import { WebSocketServer } from 'ws'

const RAPID = 5000 // mm/min
const TICK = 20 // ms
const HOLD_MS = 200 // how long the fake reports Hold:1 (decelerating) before Hold:0
const AXES = 'XYZ'
const MAX_RATE = { X: 9000, Y: 9000, Z: 900 } // mm/min, stock LowRider Jackpot config

export function start(port = 8081) {
  const m = { state: 'Alarm', mpos: [0, 0, 0], wco: [0, 0, 0], ov: [100, 100, 100], moves: [], absolute: true, feed: 1000, speed: 0, spindle: 0 }
  const sd = new Map() // the fake SD card: name -> Buffer
  let job = null // { lines, i, pos, size, name } while an SD file runs
  // Like FluidNC 4.x, any number of clients: replies go to the asker, state changes and alarms to everyone.
  const clients = new Set()
  let ri = 0 // ponytail: one shared report interval; FluidNC keeps one per client
  let lastReport = 0
  let wifi = 70 // simulated signal %, wanders a little

  const send = (ws, text) => ws.send(Buffer.from(text + '\r\n'), { binary: true })
  const broadcast = text => { for (const ws of clients) send(ws, text) }
  const fmt = v => v.map(n => n.toFixed(3)).join(',')
  const status = ws => {
    const moving = m.state === 'Run' || m.state === 'Jog'
    const feed = moving && m.moves.length ? m.moves[0].feed : 0
    let report = `<${m.state}|MPos:${fmt(m.mpos)}|FS:${feed},${m.spindle}|WCO:${fmt(m.wco)}|Ov:${m.ov.join(',')}`
    if (m.spindle) report += '|A:S'
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
    const from = m.moves.at(-1)?.to ?? m.mpos
    const target = [...from]
    for (const [w, v] of words(text)) {
      if (w === 'G' && v === 90) abs = true
      else if (w === 'G' && v === 91) abs = false
      else if (w === 'G' && v === 0) rapid = true
      else if (w === 'F') feed = v
      else if (AXES.includes(w)) {
        const i = AXES.indexOf(w)
        target[i] = abs ? v + m.wco[i] : target[i] + v
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
    const run = /^\s*\$SD\/RUN=\/?(.+?)\s*$/i.exec(text) // file names keep their case
    if (run) {
      if (m.state !== 'Idle') return reply('error:8') // not idle
      const buf = sd.get(run[1])
      if (!buf) return reply('error:62') // could not open the file
      job = { lines: buf.toString().split('\n'), i: 0, pos: 0, size: buf.length, name: run[1] }
      m.state = 'Run'
      status()
      return ok()
    }
    const l = text.trim().toUpperCase()
    if (!l) return
    if (l === '$SYSTEM/STATS') { // just enough of ESP420 for the Wi-Fi indicator
      wifi = clamp(wifi + Math.random() * 10 - 5, 55, 85)
      reply('Current WiFi Mode: STA')
      reply(`Signal: ${Math.round(wifi)}%`)
      return ok()
    }
    if (l.startsWith('$RI=')) { ri = Number(l.slice(4)); status(ws); return ok() }
    if (l === '$X') { m.state = 'Idle'; status(); reply('[MSG:INFO: Caution: Unlocked]'); return ok() }
    if (l === '$H') {
      m.state = 'Home'
      status()
      setTimeout(() => { m.mpos = [0, 0, 0]; m.state = 'Idle'; status(); ok() }, 1500)
      return
    }
    const q = /^\$\/AXES\/([XYZ])\/MAX_RATE_MM_PER_MIN$/.exec(l)
    if (q) { reply(`$/axes/${q[1].toLowerCase()}/max_rate_mm_per_min=${MAX_RATE[q[1]].toFixed(3)}`); return ok() }
    if (m.state === 'Alarm') return reply('error:9') // G-code locked out during alarm
    if (l.startsWith('$J=')) return motion(l.slice(3), true, ok)
    if (/^G10\s*L20\s*P[01]/.test(l)) {
      for (const [w, v] of words(l.replace(/^G10\s*L20\s*P[01]/, ''))) {
        if (AXES.includes(w)) m.wco[AXES.indexOf(w)] = m.mpos[AXES.indexOf(w)] - v
      }
      status()
      return ok()
    }
    if (/^(G9[01]\s*)?G[01]\b/.test(l)) return motion(l, false, ok)
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
    if (c === '~') { if (m.state.startsWith('Hold')) m.state = 'Run'; return status() }
    if (code === 0x18) {
      const wasMoving = m.state === 'Run' || m.state === 'Jog' || m.state === 'Hold:1'
      m.moves = []
      job = null
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
    if (ov) m.ov = [clamp(ov[0], 10, 200), ov[1], clamp(ov[2], 10, 200)]
  }

  const timer = setInterval(() => {
    // Read a running SD job a few moves ahead, like FluidNC filling its planner from the file
    while (job && m.state === 'Run' && m.moves.length < 4 && job.i < job.lines.length) {
      const text = job.lines[job.i++]
      job.pos += Buffer.byteLength(text) + 1
      jobLine(text)
    }
    if (job && job.i >= job.lines.length && !m.moves.length && m.state === 'Run') {
      job = null
      m.state = 'Idle'
      status()
    }
    const mv = m.moves[0]
    if (mv && (m.state === 'Run' || m.state === 'Jog')) {
      const pct = mv.jog ? 100 : mv.rapid ? m.ov[1] : m.ov[0]
      const stepMm = ((mv.feed * pct) / 100 / 60000) * TICK
      const d = mv.to.map((t, i) => t - m.mpos[i])
      const dist = Math.hypot(...d)
      if (dist <= stepMm) {
        m.mpos = [...mv.to]
        m.moves.shift()
      } else {
        m.mpos = m.mpos.map((p, i) => p + (d[i] / dist) * stepMm)
      }
      if (!m.moves.length && !job) { m.state = 'Idle'; status() }
    }
    if (ri && (m.state === 'Run' || m.state === 'Jog' || m.state === 'Home') && Date.now() - lastReport >= ri) status()
  }, TICK)

  const json = (res, body) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body))
  }
  const listing = () => ({
    files: [...sd].map(([name, buf]) => ({ name, shortname: name, size: buf.length, datetime: '' })),
    path: '/',
    total: '1.00 GB',
    used: '0.01 GB',
    occupation: 1,
    status: 'Ok',
  })
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://fake')
    if (url.pathname === '/upload' && req.method === 'POST') {
      const body = Readable.toWeb(req)
      const form = await new Request(url, { method: 'POST', headers: { 'content-type': req.headers['content-type'] }, body, duplex: 'half' }).formData()
      for (const [, v] of form) if (typeof v !== 'string') sd.set(v.name.replace(/^\//, ''), Buffer.from(await v.arrayBuffer()))
      return json(res, listing())
    }
    if (url.pathname === '/upload') {
      const name = url.searchParams.get('filename')
      if (url.searchParams.get('action') === 'delete' && name) sd.delete(name)
      return json(res, listing())
    }
    const file = url.pathname.startsWith('/sd/') && sd.get(decodeURIComponent(url.pathname.slice(4)))
    if (file) {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      return res.end(file)
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
        else if (c === '\n') { line(buf, ws); buf = '' }
        else if (c !== '\r') buf += c
      }
    })
    ws.on('close', () => clients.delete(ws))
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
  console.log(`Fake FluidNC on ws://localhost:${port}/ (files on http://localhost:${port}/upload)`)
}
