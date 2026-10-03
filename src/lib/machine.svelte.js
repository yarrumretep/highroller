import { FluidNC } from './fluidnc.js'
import { EMPTY, wifiPercent } from './status.js'
import { createJogger } from './jog.js'
import { stopMachine } from './stop.js'

const LOG_MAX = 500

export const machine = $state({
  conn: 'connecting',
  everOpen: false,
  status: EMPTY,
  alarm: null,
  log: [],
  maxRate: { X: Infinity, Y: Infinity, Z: Infinity },
  stops: 0,
  wifi: null,
})

function log(line) {
  machine.log.push(line)
  if (machine.log.length > LOG_MAX) machine.log.splice(0, machine.log.length - LOG_MAX)
}

const WIFI_POLL_MS = 15000
let wifiTimer

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
    clearInterval(wifiTimer)
    machine.wifi = null
    if (c === 'open') {
      machine.everOpen = true
      fnc.jogCancel() // cancel any jog left running from before the link dropped
      readMaxRates()
      readWifi()
      wifiTimer = setInterval(readWifi, WIFI_POLL_MS)
    }
  },
})
fnc.connect()
import.meta.hot?.dispose(() => { clearInterval(wifiTimer); fnc.close() }) // dev hot reload: don't leave the old client connected

async function readMaxRates() {
  for (const axis of ['X', 'Y', 'Z']) {
    const r = await fnc.send(`$/axes/${axis.toLowerCase()}/max_rate_mm_per_min`, { quiet: true })
    const v = Number(r.lines.find(l => l.startsWith('$/'))?.split('=')[1])
    if (v > 0) machine.maxRate[axis] = v
  }
}

// The signal at the controller is what matters for a link dropping mid-job (the phone shows its own).
async function readWifi() {
  const r = await fnc.send('$System/Stats', { quiet: true })
  if (r.ok) machine.wifi = wifiPercent(r.lines)
}

export const jogger = createJogger(fnc)

// Commands the user asked for are echoed into the console, with their ok.
export async function send(line) {
  log('> ' + line)
  const r = await fnc.send(line)
  if (r.ok) log('ok')
  return r
}

export async function stop() {
  machine.stops++ // JogPad cancels any press still waiting to become a hold
  await stopMachine(fnc, jogger)
}
