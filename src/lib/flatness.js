// Flatness: fits a plane through probed points and reports how far the surface departs from it.
const r2 = v => Math.round(v * 100) / 100

// Ordinary least squares for z = a·x + b·y + c: solve the 3×3 normal equations by Cramer's rule.
function fitPlane(points) {
  let Sx = 0, Sy = 0, Sz = 0, Sxx = 0, Syy = 0, Sxy = 0, Sxz = 0, Syz = 0
  for (const p of points) {
    Sx += p.x; Sy += p.y; Sz += p.z
    Sxx += p.x * p.x; Syy += p.y * p.y; Sxy += p.x * p.y
    Sxz += p.x * p.z; Syz += p.y * p.z
  }
  const n = points.length
  const det3 = m => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  const M = [[Sxx, Sxy, Sx], [Sxy, Syy, Sy], [Sx, Sy, n]]
  const D = det3(M)
  // Collinear points leave x,y underdetermined (D is exactly, or only float-noise away from, zero).
  if (Math.abs(D) < 1e-9 * (Math.abs(Sxx * Syy * n) + 1)) return { a: 0, b: 0, c: Sz / n }
  const a = det3([[Sxz, Sxy, Sx], [Syz, Syy, Sy], [Sz, Sy, n]]) / D
  const b = det3([[Sxx, Sxz, Sx], [Sxy, Syz, Sy], [Sx, Sz, n]]) / D
  const c = det3([[Sxx, Sxy, Sxz], [Sxy, Syy, Syz], [Sx, Sy, Sz]]) / D
  return { a, b, c }
}

// points: [{ x, y, z }] in machine mm (3 or more, not collinear). threshold: mm of peak-to-valley that counts as flat.
export function flatnessReport(points, { threshold = 0.15 } = {}) {
  const highest = points.reduce((h, p) => (p.z > h.z ? p : h))
  const heights = points.map(p => ({ ...p, rel: p.z - highest.z }))

  const plane = fitPlane(points)
  const xs = points.map(p => p.x), ys = points.map(p => p.y), zs = points.map(p => p.z)
  const tiltX = plane.a * (Math.max(...xs) - Math.min(...xs))
  const tiltY = plane.b * (Math.max(...ys) - Math.min(...ys))

  const pv = Math.max(...zs) - Math.min(...zs)
  const residuals = points.map(p => p.z - (plane.a * p.x + plane.b * p.y + plane.c))
  const residualPv = Math.max(...residuals) - Math.min(...residuals)
  const residualRms = Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / residuals.length)

  const verdict = pv > threshold ? 'surface' : 'flat'
  // Round up to the next 0.05 mm step; the -1e-9 keeps a value already on the grid from jumping to the next one.
  const depth = verdict === 'surface' ? r2(Math.ceil((pv + 0.1) / 0.05 - 1e-9) * 0.05) : 0

  return { highest: { x: highest.x, y: highest.y, z: highest.z }, heights, plane, tiltX, tiltY, pv, residualPv, residualRms, verdict, depth }
}
