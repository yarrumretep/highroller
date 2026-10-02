import { FluidNC } from './fluidnc.js'
import { EMPTY } from './status.js'
import { createJogger } from './jog.js'

const LOG_MAX = 500

export const machine = $state({ conn: 'connecting', everOpen: false, status: EMPTY, alarm: null, log: [] })

function log(line) {
  machine.log.push(line)
  if (machine.log.length > LOG_MAX) machine.log.splice(0, machine.log.length - LOG_MAX)
}

export const fnc = new FluidNC({
  // On the board, talk to the board. On the dev server: VITE_FLUIDNC_HOST, or the fake on :8081.
  host: import.meta.env.VITE_FLUIDNC_HOST || (import.meta.env.DEV ? `${location.hostname}:8081` : location.host),
  onStatus: s => {
    machine.status = s
    if (s.state !== 'Alarm') machine.alarm = null
  },
  onLine: line => {
    const m = /^ALARM:(\d+)/.exec(line)
    if (m) machine.alarm = Number(m[1])
    log(line)
  },
  onConnection: c => {
    machine.conn = c
    if (c === 'open') machine.everOpen = true
  },
})
fnc.connect()

export const jogger = createJogger(fnc)

// Commands the user asked for are echoed into the console.
export function send(line) {
  log('> ' + line)
  return fnc.send(line)
}

const moving = s => s.state === 'Run' || s.state === 'Jog' || (s.state === 'Hold' && s.sub !== 0)

// Hold first so the machine decelerates and keeps its position, then reset.
export async function stop() {
  jogger.stop()
  fnc.realtime(0x21) // '!'
  const t0 = Date.now()
  while (moving(machine.status) && Date.now() - t0 < 1000) await new Promise(r => setTimeout(r, 50))
  fnc.reset()
}
