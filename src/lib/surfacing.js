// Surfacing: a one-way raster that skims an area flat in equal depth passes down to `depth`. Every row cuts
// toward +X (left to right), with a lift to safeZ and a rapid back between rows, so each row is the same cut
// (climb or conventional) and the finish has one grain.
// Work coordinates: Z0 is the highest point of the area, X0 Y0 its minimum corner (the caller sets that zero).
const num = v => String(Math.round(v * 1000) / 1000) // G-code numbers: at most 3 decimals, no trailing zeros

// origin: the work X0 Y0 in machine coordinates, written into the file so it always cuts at its own corner.
// spindle: 'manual' holds the job (M0) before the first cut so the router can be switched on by hand; 'relay'
// switches it with M3 (the controller's spinup_ms waits for it) and M5 at the end.
export function surfacingGcode({ xMin, xMax, yMin, yMax, diameter = 25.4, stepoverPct = 40, depth, depthPerPass = 0.5, feed = 2500, plungeFeed = 300, safeZ = 5, origin = null, spindle = 'manual' }) {
  const radius = diameter / 2
  const x0 = xMin - radius, x1 = xMax + radius
  const step = diameter * stepoverPct / 100
  // The loops below count up by step and by pass: a zero or negative one would never end
  if (!(step > 0 && depthPerPass > 0 && depth > 0 && xMax > xMin && yMax > yMin)) throw new Error('Surfacing needs a positive area, stepover, depth and depth per pass')

  const rows = []
  for (let i = 0; yMin + i * step < yMax - 1e-9; i++) rows.push(yMin + i * step)
  rows.push(yMax)

  const passes = []
  for (let j = 1; j * depthPerPass < depth - 1e-9; j++) passes.push(-(j * depthPerPass))
  passes.push(-depth)

  const lines = ['G21 G90 G94 G54'] // G54: the zero Create and the flatness map set
  if (origin) lines.push(`G10 L2 P1 X${num(origin.x)} Y${num(origin.y)}`) // Z0 stays whatever was set at the highest point
  lines.push(`G0 Z${num(safeZ)}`, `G0 X${num(x0)} Y${num(yMin)}`, spindle === 'relay' ? 'M3 S1000' : 'M0')
  // Each pass covers the whole area again, deeper. Every row: lift, rapid to its left end, plunge, cut to the right.
  // (The first row's lift and rapid are zero-length: the tool already waits there.)
  for (const z of passes) {
    for (const y of rows) lines.push(`G0 Z${num(safeZ)}`, `G0 X${num(x0)} Y${num(y)}`, `G1 Z${num(z)} F${num(plungeFeed)}`, `G1 X${num(x1)} F${num(feed)}`)
  }
  lines.push(`G0 Z${num(safeZ)}`)
  if (spindle === 'relay') lines.push('M5')
  lines.push(`G0 X${num(x0)} Y${num(yMin)}`)
  return lines.join('\n') + '\n'
}

// 'surface-<W>x<H>-<depth>mm.gcode', integers for W and H, depth with up to 2 decimals
export function surfacingName({ xMin, xMax, yMin, yMax, depth }) {
  const w = Math.round(xMax - xMin), h = Math.round(yMax - yMin)
  const d = Math.round(depth * 100) / 100
  return `surface-${w}x${h}-${d}mm.gcode`
}
