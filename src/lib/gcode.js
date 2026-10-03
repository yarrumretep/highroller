// Turns G-code into a chain of straight segments for the preview, the progress trail and time estimates.
// Handles G0/G1/G2/G3 (XY arcs by I/J or R), G90/G91, G20/G21 and comments; positions are work coordinates.
// ponytail: G17 (XY) arcs only, so G18/G19 arcs are drawn straight; lines with G10/G28/G30/G53/G92 are skipped.
const ARC_MM = 0.5 // chord length for arcs
const SKIP = new Set([10, 28, 30, 53, 92])
const STOCK = { X: 9000, Y: 9000, Z: 900 } // stock LowRider max rates, used until the machine's are known

const utf8len = s => (/[^\x00-\x7f]/.test(s) ? new TextEncoder().encode(s).length : s.length)

export function parseGcode(text, maxRate = STOCK) {
  const pts = [0, 0, 0]
  const rapid = []
  const offset = []
  const time = []
  let x = 0, y = 0, z = 0
  let abs = true, unit = 1, motion = 0, feed = 0, t = 0, byte = 0

  function add(nx, ny, nz, isRapid, at, rate) {
    const len = Math.hypot(nx - x, ny - y, nz - z)
    if (rate > 0 && rate < Infinity) t += (len / rate) * 60
    pts.push(nx, ny, nz)
    rapid.push(isRapid ? 1 : 0)
    offset.push(at)
    time.push(t)
    x = nx
    y = ny
    z = nz
  }

  // Rapids run at the slowest max rate among the axes that move.
  const rapidRate = (nx, ny, nz) =>
    Math.min(nx !== x ? maxRate.X : Infinity, ny !== y ? maxRate.Y : Infinity, nz !== z ? maxRate.Z : Infinity)

  function arc(nx, ny, nz, v, at) {
    const x0 = x, y0 = y, z0 = z
    const dx = nx - x0, dy = ny - y0
    let cx, cy
    if ('R' in v) {
      if (!dx && !dy) return add(nx, ny, nz, false, at, feed) // an R arc can't be a full circle
      // Centre from the radius, as Grbl computes it
      const r = v.R * unit
      let h = -Math.sqrt(Math.max(0, 4 * r * r - dx * dx - dy * dy)) / Math.hypot(dx, dy)
      if (motion === 3) h = -h
      if (r < 0) h = -h
      cx = x0 + 0.5 * (dx - dy * h)
      cy = y0 + 0.5 * (dy + dx * h)
    } else {
      cx = x0 + (v.I ?? 0) * unit
      cy = y0 + (v.J ?? 0) * unit
    }
    const radius = Math.hypot(x0 - cx, y0 - cy)
    const a0 = Math.atan2(y0 - cy, x0 - cx)
    let sweep = Math.atan2(ny - cy, nx - cx) - a0
    if (motion === 2 && sweep >= 0) sweep -= 2 * Math.PI // clockwise
    if (motion === 3 && sweep <= 0) sweep += 2 * Math.PI // counter-clockwise
    const n = Math.max(1, Math.ceil((Math.abs(sweep) * radius) / ARC_MM))
    for (let k = 1; k <= n; k++) {
      const a = a0 + (sweep * k) / n
      const last = k === n
      add(last ? nx : cx + radius * Math.cos(a), last ? ny : cy + radius * Math.sin(a), z0 + ((nz - z0) * k) / n, false, at, feed)
    }
  }

  for (const raw of text.split('\n')) {
    const at = byte
    byte += utf8len(raw) + 1
    const line = raw.replace(/\([^)]*\)|;.*$/g, '').toUpperCase()
    const gs = []
    const v = {}
    for (const [, w, n] of line.matchAll(/([A-Z])\s*([-+]?(?:\d+\.?\d*|\.\d+))/g)) {
      if (w === 'G') gs.push(Number(n))
      else v[w] = Number(n)
    }
    for (const g of gs) {
      if (g === 90) abs = true
      else if (g === 91) abs = false
      else if (g === 20) unit = 25.4
      else if (g === 21) unit = 1
      else if (g === 0 || g === 1 || g === 2 || g === 3) motion = g
    }
    if (v.F !== undefined) feed = v.F * unit
    if (gs.some(g => SKIP.has(g)) || !('X' in v || 'Y' in v || 'Z' in v)) continue
    const to = (axis, cur) => (axis in v ? (abs ? v[axis] * unit : cur + v[axis] * unit) : cur)
    const nx = to('X', x), ny = to('Y', y), nz = to('Z', z)
    if (motion === 2 || motion === 3) arc(nx, ny, nz, v, at)
    else add(nx, ny, nz, motion === 0, at, motion === 0 ? rapidRate(nx, ny, nz) : feed)
  }

  const P = Float32Array.from(pts)
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  for (let i = 3; i < P.length; i += 3) {
    bounds.minX = Math.min(bounds.minX, P[i])
    bounds.maxX = Math.max(bounds.maxX, P[i])
    bounds.minY = Math.min(bounds.minY, P[i + 1])
    bounds.maxY = Math.max(bounds.maxY, P[i + 1])
  }
  return {
    pts: P,
    rapid: Uint8Array.from(rapid),
    offset: Uint32Array.from(offset),
    time: Float64Array.from(time),
    bytes: utf8len(text),
    bounds,
  }
}
