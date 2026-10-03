// The touch-plate routine: find the plate fast, back off, then touch slowly a few times and take the median.
// Heights are machine coordinates, straight from FluidNC's [PRB:x,y,z:1] report.
const DEFAULTS = { fast: 300, slow: 25, maxDown: 20, backoff: 1, touches: 3, tolerance: 0.05 }

const prbZ = lines => {
  const m = lines.map(l => /^\[PRB:([^:\]]+):1\]/.exec(l)).find(Boolean)
  return m ? Number(m[1].split(',')[2]) : NaN
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

export async function probeZ(fnc, opts = {}) {
  const o = { ...DEFAULTS, ...opts }
  if (!(o.touches >= 1)) throw new Error('touches must be at least 1')
  const quiet = line => fnc.send(line, { quiet: true })
  let missed = false
  const probe = async (mm, feed) => {
    const r = await fnc.send(probeCmd(mm, feed))
    // A miss prints [PRB:…:0] and ALARM:5 before the reply; FluidNC is then in alarm.
    if (r.lines.some(l => /^\[PRB:[^\]]*:0\]/.test(l) || l.startsWith('ALARM:5'))) {
      missed = true
      throw new Error('No contact: is the plate under the bit and the clip attached?')
    }
    if (!r.ok) throw new Error(`Probe refused: error ${r.error}`)
    const z = prbZ(r.lines)
    if (Number.isNaN(z)) throw new Error('Probe refused: no [PRB:] report')
    return z
  }
  await quiet('G91')
  try {
    await probe(o.maxDown, o.fast)
    const touches = []
    for (let i = 0; i < o.touches; i++) {
      await quiet(`G0 Z${+o.backoff.toFixed(3)}`)
      touches.push(await probe(2 * o.backoff, o.slow)) // the plate is one back-off below; allow twice that
    }
    const sorted = [...touches].sort((a, b) => a - b)
    const spread = sorted.at(-1) - sorted[0]
    if (spread > o.tolerance) throw new Error(`Touches differ by ${spread.toFixed(3)} mm. Clean the plate and try again.`)
    const n = sorted.length
    const z = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2
    return { z, spread, touches }
  } finally {
    // After a miss FluidNC is in alarm ("position may be lost") and refuses G-code until unlocked.
    // A G90 refused for some other reason does not mean an alarm that $X should clear.
    if (missed) await quiet('$X')
    await quiet('G90')
  }
}
