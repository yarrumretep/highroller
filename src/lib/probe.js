// The touch-plate routine: find the plate fast, back off, then touch slowly a few times and take the median.
// Positions are machine coordinates, straight from FluidNC's [PRB:x,y,z:1] report.
const DEFAULTS = { fast: 300, slow: 25, maxDown: 20, backoff: 1, touches: 3, tolerance: 0.05 }

const prb = lines => {
  const m = lines.map(l => /^\[PRB:([^:\]]+):1\]/.exec(l)).find(Boolean)
  return m ? m[1].split(',').map(Number) : []
}

const probeCmd = (mm, feed) => `G38.2 Z-${+mm.toFixed(3)} F${feed}`

// The exact lines probeZ(fnc, opts) sends, in order — for a caller (the calibration wizard) that wants to
// show them before probing actually runs. Built from the same DEFAULTS/opts and the same `probeCmd`.
export function probeLines(opts = {}) {
  const o = { ...DEFAULTS, ...opts }
  const lines = ['G91', probeCmd(o.maxDown, o.fast)]
  for (let i = 0; i < o.touches; i++) lines.push(`G0 Z${+o.backoff.toFixed(3)}`, probeCmd(2 * o.backoff, o.slow))
  lines.push('G90')
  return lines
}

// A failed probe throws; `e.retry` is true when it can simply be tried again: nothing had moved yet, or the
// touches disagreed with the bit resting on the plate. A miss (the bit went the whole way down) is not.
const fail = (message, retry = false) => Object.assign(new Error(message), { retry })

export async function probeZ(fnc, opts = {}) {
  const o = { ...DEFAULTS, ...opts }
  if (!(o.touches >= 1)) throw new Error('touches must be at least 1')
  const quiet = line => fnc.send(line, { quiet: true })
  let alarmed = false
  let at // x, y of the last touch; unset while nothing has moved yet
  const probe = async (mm, feed) => {
    const r = await fnc.send(probeCmd(mm, feed))
    // FluidNC prints these before the reply and is then in alarm: ALARM:4, the probe was already closed at the
    // start; a miss, [PRB:…:0] and ALARM:5.
    if (r.lines.some(l => l.startsWith('ALARM:4'))) {
      alarmed = true
      throw fail('The plate was already touching the bit when probing started. Make sure it is clear of the bit before probing.')
    }
    if (r.lines.some(l => /^\[PRB:[^\]]*:0\]/.test(l) || l.startsWith('ALARM:5'))) {
      alarmed = true
      throw fail('No contact: is the plate under the bit and the clip attached? Re-home Z before moving on (the bit may have stalled).')
    }
    if (!r.ok) throw fail(`Probe refused: error ${r.error}`, !at)
    const [x, y, z] = prb(r.lines)
    if (![x, y, z].every(Number.isFinite)) throw fail('Probe refused: no [PRB:] report')
    at = { x, y }
    return z
  }
  const g91 = await quiet('G91')
  if (!g91.ok) throw fail(`G91 refused: error ${g91.error}`, true) // in absolute mode G38.2 Z-20 would head for work Z -20
  try {
    await probe(o.maxDown, o.fast)
    const touches = []
    for (let i = 0; i < o.touches; i++) {
      await quiet(`G0 Z${+o.backoff.toFixed(3)}`)
      touches.push(await probe(2 * o.backoff, o.slow)) // the plate is one back-off below; allow twice that
    }
    const sorted = [...touches].sort((a, b) => a - b)
    const spread = sorted.at(-1) - sorted[0]
    if (spread > o.tolerance) throw fail(`Touches differ by ${spread.toFixed(3)} mm. Clean the plate and try again.`, true)
    const n = sorted.length
    const z = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2
    return { ...at, z, spread, touches }
  } finally {
    // After a miss or ALARM:4 FluidNC is in alarm and refuses G-code until unlocked (neither loses the position).
    // A G90 refused for some other reason does not mean an alarm that $X should clear.
    if (alarmed) await quiet('$X')
    await quiet('G90')
  }
}
