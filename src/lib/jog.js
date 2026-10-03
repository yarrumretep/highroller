// Jogging. A tap moves one step. Holding keeps a short runway of small jog moves queued
// in FluidNC, so if the link drops the machine stops within a fraction of a second
// instead of running to the end of travel.
const CHUNK_MS = 100 // travel time per jog move
const AHEAD_MS = 250 // top up whenever less than this much motion is queued
const MAX_QUEUED_MS = 600 // never more than this much jog distance beyond what the machine has travelled
const AXES = 'XYZ'

export function createJogger(fnc, now = () => Date.now()) {
  let hold = null

  const jog = (axis, mm, feed) => fnc.send(`$J=G91 G21 ${axis}${+mm.toFixed(3)} F${Math.round(feed)}`)

  function start(axis, dir, feed) {
    stop()
    const i = AXES.indexOf(axis)
    const mmPerMs = feed / 60000
    const startPos = fnc.status.mpos[i]
    const h = { until: now(), sent: 0 }
    const tick = () => {
      const t = now()
      h.until = Math.max(h.until, t)
      // FluidNC caps jog speed at the axis max rate, so also bound what is queued by distance travelled.
      const travelled = Math.abs(fnc.status.mpos[i] - startPos)
      while (h.until - t < AHEAD_MS && h.sent - travelled < mmPerMs * MAX_QUEUED_MS) {
        jog(axis, dir * mmPerMs * CHUNK_MS, feed).then(r => {
          // This move may have reached FluidNC just after the release's cancel: cancel again.
          if (r.ok && hold === null) fnc.jogCancel()
        })
        h.until += CHUNK_MS
        h.sent += mmPerMs * CHUNK_MS
      }
    }
    hold = h
    tick()
    h.timer = setInterval(tick, 50)
  }

  function stop() {
    if (!hold) return
    clearInterval(hold.timer)
    hold = null
    // Release cancels every pending jog, taps included: FluidNC's jog cancel flushes them all anyway.
    fnc.dropQueued(line => line.startsWith('$J='))
    fnc.jogCancel()
  }

  return { step: jog, start, stop }
}
