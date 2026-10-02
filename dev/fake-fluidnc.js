// A pretend FluidNC for UI work without the machine. It speaks just enough of the protocol:
// binary output frames, status reports, jogging, G0/G1 moves, work offsets, overrides and alarms.
// ponytail: grows only as features need it (probing, SD jobs and files come with later steps).
import { WebSocketServer } from 'ws'
import { pathToFileURL } from 'node:url'

const RAPID = 5000 // mm/min
const TICK = 20 // ms
const AXES = 'XYZ'

export function start(port = 8081) {
  const m = { state: 'Alarm', mpos: [0, 0, 0], wco: [0, 0, 0], ov: [100, 100, 100], moves: [], absolute: true, feed: 1000 }
  let client = null
  let ri = 0
  let lastReport = 0

  const out = text => client?.send(Buffer.from(text + '\r\n'), { binary: true })
  const ok = () => out('ok')
  const fmt = v => v.map(n => n.toFixed(3)).join(',')
  const status = () => {
    lastReport = Date.now()
    const feed = m.moves.length && !m.state.startsWith('Hold') ? m.moves[0].feed : 0
    out(`<${m.state}|MPos:${fmt(m.mpos)}|FS:${feed},0|WCO:${fmt(m.wco)}|Ov:${m.ov.join(',')}>`)
  }
  const words = text => [...text.matchAll(/([A-Z])\s*(-?\d*\.?\d+)/g)].map(([, w, v]) => [w, Number(v)])
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

  function motion(text, jog) {
    let abs = jog ? true : m.absolute
    let feed = jog ? null : m.feed
    let rapid = false
    const target = [...(m.moves.at(-1)?.to ?? m.mpos)]
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
    m.moves.push({ to: target, feed: rapid ? RAPID : feed ?? m.feed, jog, rapid })
    if (m.state === 'Idle') m.state = jog ? 'Jog' : 'Run'
    ok()
  }

  function line(text) {
    const l = text.trim().toUpperCase()
    if (!l) return
    if (l.startsWith('$RI=')) { ri = Number(l.slice(4)); status(); return ok() }
    if (l === '$X') { m.state = 'Idle'; out('[MSG:INFO: Caution: Unlocked]'); return ok() }
    if (l === '$H') {
      m.state = 'Home'
      status()
      setTimeout(() => { m.mpos = [0, 0, 0]; m.state = 'Idle'; status(); ok() }, 1500)
      return
    }
    if (m.state === 'Alarm') return out('error:9') // G-code locked out during alarm
    if (l.startsWith('$J=')) return motion(l.slice(3), true)
    if (/^G10\s*L20\s*P[01]/.test(l)) {
      for (const [w, v] of words(l.replace(/^G10\s*L20\s*P[01]/, ''))) {
        if (AXES.includes(w)) m.wco[AXES.indexOf(w)] = m.mpos[AXES.indexOf(w)] - v
      }
      status()
      return ok()
    }
    if (/^(G9[01]\s*)?G[01]\b/.test(l)) return motion(l, false)
    ok()
  }

  function realtime(c) {
    const code = c.codePointAt(0)
    if (c === '?') return status()
    if (c === '!') {
      if (m.state === 'Jog') { m.moves = []; m.state = 'Idle' } // a hold during a jog cancels it
      else if (m.state === 'Run') m.state = 'Hold:0'
      return status()
    }
    if (c === '~') { if (m.state === 'Hold:0') m.state = 'Run'; return status() }
    if (code === 0x18) {
      const wasMoving = m.state === 'Run' || m.state === 'Jog'
      m.moves = []
      if (m.state !== 'Alarm') m.state = wasMoving ? 'Alarm' : 'Idle'
      out("Grbl 4.1 [FluidNC fake, '$' for help]")
      if (wasMoving) out('ALARM:3')
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
      if (!m.moves.length) { m.state = 'Idle'; status() }
    }
    if (ri && (m.state === 'Run' || m.state === 'Jog' || m.state === 'Home') && Date.now() - lastReport >= ri) status()
  }, TICK)

  const wss = new WebSocketServer({ port })
  wss.on('connection', ws => {
    client?.close() // one client at a time is plenty for a fake
    client = ws
    ws.send('currentID:0') // text control frame, as FluidNC sends
    let buf = ''
    ws.on('message', data => {
      for (const c of data.toString()) { // UTF-8 decoded: override bytes arrive as single characters
        if ('?!~\x18'.includes(c) || c.codePointAt(0) >= 0x80) realtime(c)
        else if (c === '\n') { line(buf); buf = '' }
        else if (c !== '\r') buf += c
      }
    })
    ws.on('close', () => { if (client === ws) client = null })
  })

  return {
    close() {
      clearInterval(timer)
      for (const ws of wss.clients) ws.terminate()
      wss.close()
    },
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 8081)
  start(port)
  console.log(`Fake FluidNC on ws://localhost:${port}/`)
}
