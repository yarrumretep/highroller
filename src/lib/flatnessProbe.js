import { probeLines } from './probe.js'
import { flatnessReport } from './flatness.js'

// The flatness map, written as a script in the style of calibrate(io): a grid of touch-plate probes over the
// travel (less the margin), visited row by row in a serpentine. The UI (or a test) supplies `io`.
const TRAVEL_ABOVE_MM = 10 // travel height above the first touch
const LIFT_MM = 5 // off the plate after each probe, and before one that is redone
const THRESHOLD_MM = 0.15 // peak to valley that still counts as flat

const r3 = v => Math.round(v * 1000) / 1000
const num = v => String(r3(v)) // G-code numbers: no trailing zeros
const okCount = v => Number.isInteger(v) && v >= 2 && v <= 5

export async function flatnessProbe(io) {
  const { settings: s } = io
  const g = async line => {
    const r = await io.send(line)
    if (!r.ok) throw new Error(`${line} failed: ${r.error}`)
  }

  io.busy('Reading the config…')
  const config = await io.readConfig()
  if (!config?.range) throw new Error('The config has no axis travel (max_travel_mm / homing) to work from')
  const { X, Y, Z } = config.range
  const xMin = X.min + s.marginMm, xMax = X.max - s.marginMm, yMin = Y.min + s.marginMm, yMax = Y.max - s.marginMm
  if (!(xMax > xMin && yMax > yMin)) throw new Error('The margin leaves no area to probe: lower it')

  let grid = { cols: 3, rows: 3 }, gridError = null
  for (;;) {
    grid = await io.ask({
      title: 'Flatness map: the grid',
      text: `The plate is probed at a grid of points over a ${num(xMax - xMin)} × ${num(yMax - yMin)} mm area (the travel less the margin). More points show more of the shape and take longer.`,
      fields: [
        { name: 'cols', label: 'Columns (along X)', unit: 'points', step: 1 },
        { name: 'rows', label: 'Rows (along Y)', unit: 'points', step: 1 },
      ],
      error: gridError,
      values: grid,
    })
    if (okCount(grid.cols) && okCount(grid.rows)) break
    gridError = 'Columns and rows: a whole number from 2 to 5 each.'
  }
  const { cols, rows } = grid
  const at = (i, n, lo, hi) => r3(lo + (i * (hi - lo)) / (n - 1))
  // Row by row from Y-min, alternate rows right to left, so each move is to a neighbour
  const points = []
  for (let j = 0; j < rows; j++) {
    for (let k = 0; k < cols; k++) {
      const i = j % 2 ? cols - 1 - k : k
      points.push({ i, j, x: at(i, cols, xMin, xMax), y: at(j, rows, yMin, yMax) })
    }
  }
  const n = points.length
  const xyLines = points.map(p => `G53 G0 X${num(p.x)} Y${num(p.y)}`) // computed once; the same strings are previewed and sent

  let travelZ = Z.max
  const homeLine = '$H'
  const firstMove = [`G53 G0 Z${num(travelZ)}`, xyLines[0], 'G4 P0']
  const finalZLine = `G53 G0 Z${num(Z.max)}`

  await io.step({
    title: 'Before you start',
    text: `Fit the bit you will surface with (the zero at the highest point is for the bit that probed) and make sure the router is off. You need the touch plate and its clip. The bit visits ${n} points (${cols} × ${rows}), row by row; at each one the plate goes under the bit and is probed, then you pick it up before the next move.`,
    lines: [homeLine, ...firstMove],
  })
  io.busy('Homing…')
  await g(homeLine)
  io.busy('Moving to point 1…')
  for (const l of firstMove) await g(l)
  // Z only: the grid's points are where the map says they are
  await io.step({ title: `Point 1 of ${n}: set the height`, text: 'Jog the bit down until it is a few millimetres above where the plate will sit, then continue.', jog: 'z' })

  for (let k = 0; k < n; k++) {
    const p = points[k]
    const label = `Point ${k + 1} of ${n}`
    // A redo (touches that disagree, or a refusal before any motion) lifts clear and asks again. Anything else
    // ends the run: no contact means the bit went 20 mm down into whatever was there and may have lost steps.
    for (let error = null; ;) {
      await io.step({
        title: `${label}: plate and clip`,
        text: `Put the touch plate on the table under the bit${k === 0 ? ' and attach the clip to the bit' : ''}. Tap the plate against the bit so the app sees the contact, then press Probe.`,
        arm: true,
        lines: [...probeLines(), 'G91', `G0 Z${LIFT_MM}`, 'G90'], // the probe, then the lift off the plate
        error,
      })
      io.busy('Probing…')
      try {
        p.probed = await io.probe() // { x, y, z } in machine coordinates
        break
      } catch (e) {
        if (!e.retry) throw e
        error = `${e.message}${/[.?!]$/.test(e.message) ? '' : '.'} The bit was lifted ${LIFT_MM} mm; probe this point again.`
        io.busy(`Probe failed; lifting ${LIFT_MM} mm…`)
        await g('G91')
        await g(`G0 Z${LIFT_MM}`)
        await g('G90')
      }
    }
    io.busy(`Lifting ${LIFT_MM} mm off the plate…`)
    await g('G91')
    await g(`G0 Z${LIFT_MM}`)
    await g('G90')
    if (k === 0) travelZ = Math.min(p.probed.z + TRAVEL_ABOVE_MM, Z.max)
    const last = k === n - 1
    const next = last ? [finalZLine] : [`G53 G0 Z${num(travelZ)}`, xyLines[k + 1], 'G4 P0']
    await io.step({
      title: `${label}: pick up the plate`,
      text: last ? 'Pick up the plate and take the clip off the bit. Continue raises the bit to the top.' : `Pick up the plate; keep the clip on the bit. Continue moves to point ${k + 2}.`,
      plateOff: true, // the plate goes with the user, not dragged along by the clip's lead
      lines: next,
    })
    io.busy(last ? 'Raising the bit…' : `Moving to point ${k + 2}…`)
    for (const l of next) await g(l)
  }

  // Grid order (row by row from Y-min, X ascending), so a caller can lay the heights out as the table
  const probed = [...points].sort((a, b) => a.j - b.j || a.i - b.i).map(p => p.probed)
  const report = flatnessReport(probed, { threshold: THRESHOLD_MM })
  // The touch is one plate thickness above the table: work Z0 goes on the table itself, as the Z0 probe does
  const zeroLine = `G10 L2 P1 X${num(xMin)} Y${num(yMin)} Z${num(report.highest.z - s.plateMm)}`
  // configText: a calibration applied since (steps/mm, pull-offs) moves the table under these numbers
  return { kind: 'flatness', report, area: { xMin, xMax, yMin, yMax }, grid: { cols, rows }, zeroLine, configText: config.text }
}

const mm = v => Math.abs(v).toFixed(2)
const side = (axis, v) => (Math.abs(v) < 0.005 ? `${axis}-max side level` : `${axis}-max side ${mm(v)} mm ${v > 0 ? 'higher' : 'lower'}`)

// The result as the dialog and the Tools card show it.
export function resultLines(r) {
  return {
    tilt: `Tilt: ${side('X', r.tiltX)}, ${side('Y', r.tiltY)}`,
    flatness: `Peak to valley ${mm(r.pv)} mm, ${mm(r.residualPv)} mm after removing the tilt`,
    verdict: r.verdict === 'flat' ? 'Flat enough' : `Surface it: cut ${mm(r.depth)} mm from the highest point`,
  }
}
