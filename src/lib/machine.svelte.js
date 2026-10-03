import { FluidNC } from './fluidnc.js'
import { EMPTY } from './status.js'
import { createJogger } from './jog.js'

const LOG_MAX = 500

export const machine = $state({
  conn: 'connecting',
  everOpen: false,
  status: EMPTY,
  alarm: null,
  log: [],
  maxRate: { X: Infinity, Y: Infinity, Z: Infinity },
  stops: 0,
})

function log(line) {
  machine.log.push(line)
  if (machine.log.length > LOG_MAX) machine.log.splice(0, machine.log.length - LOG_MAX)
}

export const fnc = new FluidNC({
  // On the board, talk to the board. Dev server: VITE_FLUIDNC_HOST, or the fake on :8081.
  host: import.meta.env.DEV ? import.meta.env.VITE_FLUIDNC_HOST || `${location.hostname}:8081` : location.host,
  onStatus: s => {
    machine.status = s
    if (s.state !== 'Alarm') machine.alarm = null
  },
  onLine: line => {
    const m = /^ALARM:(\d+)/.exec(line)
    if (m) machine.alarm = Number(m[1])
    if (line !== 'ok') log(line)
  },
  onConnection: c => {
    machine.conn = c
    if (c === 'open') {
      machine.everOpen = true
      fnc.jogCancel() // cancel any jog left running from before the link dropped
      readMaxRates()
    }
  },
})
fnc.connect()
import.meta.hot?.dispose(() => fnc.close()) // dev hot reload: don't leave the old client connected

async function readMaxRates() {
  for (const axis of ['X', 'Y', 'Z']) {
    const r = await fnc.send(`$/axes/${axis.toLowerCase()}/max_rate_mm_per_min`, { quiet: true })
    const v = Number(r.lines.find(l => l.startsWith('$/'))?.split('=')[1])
    if (v > 0) machine.maxRate[axis] = v
  }
}

export const jogger = createJogger(fnc)

// Commands the user asked for are echoed into the console, with their ok.
export async function send(line) {
  log('> ' + line)
  const r = await fnc.send(line)
  if (r.ok) log('ok')
  return r
}

const moving = s => s.state === 'Run' || s.state === 'Jog' || (s.state === 'Hold' && s.sub !== 0)

const sleep = ms => new Promise(r => setTimeout(r, ms))

// Hold first so the machine decelerates and keeps its position, then reset.
export async function stop() {
  machine.stops++ // JogPad cancels any press still waiting to become a hold
  jogger.stop()
  fnc.realtime(0x21) // '!'
  await sleep(150) // let a fresh report arrive: motion may have started since the last one
  const t0 = Date.now()
  while (moving(machine.status) && Date.now() - t0 < 2000) await sleep(50)
  fnc.reset()
}
