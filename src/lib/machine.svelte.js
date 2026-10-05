import { FluidNC } from './fluidnc.js'
import { EMPTY, wifiPercent, fwVersion } from './status.js'
import { createJogger } from './jog.js'
import { stopMachine } from './stop.js'
import { readFlash } from './flash.js'
import { getValue } from './yaml-edit.js'
import { axisRange } from './calib.js'
import { homedAfter, homesPositive } from './homing.js'

const LOG_MAX = 500

export const machine = $state({
  conn: 'connecting',
  everOpen: false,
  status: EMPTY,
  alarm: null,
  log: [],
  maxRate: { X: Infinity, Y: Infinity, Z: Infinity },
  stops: 0,
  stopping: false,
  wifi: null,
  fw: null, // the firmware's name and version, from the first stats read on this connection
  config: null,
  homed: {}, // { X: true, … }: axes homed since this connection opened and since any alarm that loses the position
})

export function log(line) {
  machine.log.push(line)
  if (machine.log.length > LOG_MAX) machine.log.splice(0, machine.log.length - LOG_MAX)
}

// FluidNC does not read lines from the app while an SD job runs, so the app's own queries wait for idle.
const whenIdle = []
const idle = s => (s.state === 'Idle' || s.state === 'Alarm') && !s.sd // FluidNC answers $ queries in Alarm too (a fresh boot)
export function runWhenIdle(fn) {
  if (!whenIdle.includes(fn)) whenIdle.push(fn) // a reconnect during a long job would otherwise queue it again
  if (idle(machine.status)) flushIdle()
}
function flushIdle() {
  while (whenIdle.length) whenIdle.shift()()
}

const WIFI_POLL_MS = 15000
let wifiTimer
let wifiPending = false

export const fnc = new FluidNC({
  // On the board, talk to the board. Dev server: VITE_FLUIDNC_HOST, or the fake on :8081.
  host: import.meta.env.DEV ? import.meta.env.VITE_FLUIDNC_HOST || `${location.hostname}:8081` : location.host,
  onStatus: s => {
    machine.status = s
    if (s.state !== 'Alarm') machine.alarm = null
    if ((!machine.config || configStale) && !loadingConfig && (s.state === 'Idle' || s.state === 'Alarm') && Date.now() - configFailedAt > CONFIG_RETRY_MS) reloadConfig().catch(() => {})
    if (idle(s)) flushIdle()
  },
  onLine: line => {
    const m = /^ALARM:(\d+)/.exec(line)
    if (m) machine.alarm = Number(m[1])
    const homed = homedAfter(machine.homed, line)
    if (homed !== machine.homed) machine.homed = homed
    if (line !== 'ok') log(line)
  },
  onConnection: c => {
    machine.conn = c
    clearInterval(wifiTimer)
    machine.wifi = null
    if (c === 'open') {
      machine.everOpen = true
      machine.homed = {}
      // Read the config again (the idle trigger above does it, once no job runs): it may have changed while the
      // link was down. The old copy stays until then, so a phone waking mid-job keeps the outline and its view.
      configStale = true
      configFailedAt = 0
      fnc.jogCancel() // cancel any jog left running from before the link dropped
      runWhenIdle(readMaxRates)
      runWhenIdle(readWifi)
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
// Polled only while idle, one poll at a time: during a job the last reading stays.
async function readWifi() {
  if (!idle(machine.status) || wifiPending) return
  wifiPending = true
  const r = await fnc.send('$System/Stats=json=yes', { quiet: true }) // the plain form has no signal line on 3.9.9
  wifiPending = false
  if (r.ok) {
    machine.wifi = wifiPercent(r.lines)
    machine.fw = fwVersion(r.lines) ?? machine.fw
  }
}

let loadingConfig = false
let configStale = false // the link dropped since machine.config was read
let configFailedAt = 0
const CONFIG_RETRY_MS = 10000 // a failed read is retried this often, not on every status report

// Axis travel in machine coordinates, from the config's homing settings.
function rangesOf(text) {
  const range = {}
  for (const axis of ['X', 'Y', 'Z']) {
    const a = axis.toLowerCase()
    const maxTravel = Number(getValue(text, `axes/${a}/max_travel_mm`))
    const mposMm = Number(getValue(text, `axes/${a}/homing/mpos_mm`) ?? 0)
    const positive = homesPositive(text, a)
    if (!(maxTravel > 0)) return null
    range[axis] = axisRange({ maxTravel, mposMm, positive })
  }
  return range
}

// The config file is only readable while idle; it is kept until the next reload (or connection).
// Resolves with machine.config; a failure is logged, then rejects.
export async function reloadConfig() {
  loadingConfig = true
  try {
    const r = await fnc.send('$Config/Filename', { quiet: true })
    const name = r.lines.find(l => l.startsWith('$Config/Filename='))?.split('=')[1] || 'config.yaml'
    const text = await readFlash(name)
    configStale = false
    return (machine.config = { name, text, range: rangesOf(text) })
  } catch (e) {
    configFailedAt = Date.now()
    log(`Config not read: ${e.message}`)
    throw e
  } finally {
    loadingConfig = false
  }
}

export const jogger = createJogger(fnc)

// Commands the user asked for are echoed into the console, with their ok.
export async function send(line, opts) {
  log('> ' + line)
  const r = await fnc.send(line, opts)
  if (r.ok && !opts?.noReply) log('ok')
  return r
}

export async function stop() {
  machine.stops++ // JogPad cancels any press still waiting to become a hold
  machine.stopping = true // Pause and Resume stay off until the reset is out
  try {
    await stopMachine(fnc, jogger)
  } finally {
    machine.stopping = false
  }
}
