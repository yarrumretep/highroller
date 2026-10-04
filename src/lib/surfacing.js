// Surfacing: a serpentine raster that skims an area flat in equal depth passes down to `depth`.
// Work coordinates: Z0 is the highest point of the area, X0 Y0 its minimum corner (the caller sets that zero).
const num = v => String(Math.round(v * 1000) / 1000) // G-code numbers: at most 3 decimals, no trailing zeros

// origin: the work X0 Y0 in machine coordinates, written into the file so it always cuts at its own corner.
export function surfacingGcode({ xMin, xMax, yMin, yMax, diameter = 25.4, stepoverPct = 40, depth, depthPerPass = 0.5, feed = 2500, plungeFeed = 300, safeZ = 5, origin = null }) {
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
  lines.push(`G0 Z${num(safeZ)}`, `G0 X${num(x0)} Y${num(yMin)}`, 'M0')
  let rightward = true // the tool starts at x0, so the first sweep goes toward x1
  for (let p = 0; p < passes.length; p++) {
    const z = passes[p]
    // Each pass covers the whole area again, deeper; alternating row order keeps the tool where the last pass left it.
    const order = p % 2 === 0 ? rows : rows.slice().reverse()
    order.forEach((y, r) => {
      if (r > 0) lines.push(`G1 Y${num(y)}`) // next row, still at cutting depth: no lift
      if (r === 0) lines.push(`G1 Z${num(z)} F${num(plungeFeed)}`) // plunge to this pass's depth
      lines.push(`G1 X${num(rightward ? x1 : x0)} F${num(feed)}`)
      rightward = !rightward
    })
  }
  lines.push(`G0 Z${num(safeZ)}`, `G0 X${num(x0)} Y${num(yMin)}`)
  return lines.join('\n') + '\n'
}

// 'surface-<W>x<H>-<depth>mm.gcode', integers for W and H, depth with up to 2 decimals
export function surfacingName({ xMin, xMax, yMin, yMax, depth }) {
  const w = Math.round(xMax - xMin), h = Math.round(yMax - yMin)
  const d = Math.round(depth * 100) / 100
  return `surface-${w}x${h}-${d}mm.gcode`
}
