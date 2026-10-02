// Jogging. A tap moves one step. Holding keeps a short runway of small jog moves queued
// in FluidNC, so if the link drops the machine stops within a fraction of a second
// instead of running to the end of travel.
const CHUNK_MS = 100 // travel time per jog move
const AHEAD_MS = 250 // top up whenever less than this much motion is queued
const JOG_CANCEL = 0x85

export function createJogger(fnc, now = () => Date.now()) {
  let hold = null

  const jog = (axis, mm, feed) => fnc.send(`$J=G91 G21 ${axis}${+mm.toFixed(3)} F${Math.round(feed)}`)

  function start(axis, dir, feed) {
    stop()
    const h = { until: now() }
    const tick = () => {
      const t = now()
      h.until = Math.max(h.until, t)
      while (h.until - t < AHEAD_MS) {
        jog(axis, (dir * feed * CHUNK_MS) / 60000, feed).then(r => {
          // This move may have reached FluidNC just after the release's cancel: cancel again.
          if (r.ok && hold === null) fnc.realtime(JOG_CANCEL)
        })
        h.until += CHUNK_MS
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
    fnc.realtime(JOG_CANCEL)
  }

  return { step: jog, start, stop }
}
