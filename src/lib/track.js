// Which segment of a running job is being cut, and how long is left.
const LOOK_BACK = 400 // ponytail: segments searched behind FluidNC's read position; widen it if a job outruns it

function distToSegment(p, i, [x, y, z]) {
  const ax = p[i * 3], ay = p[i * 3 + 1], az = p[i * 3 + 2]
  const dx = p[i * 3 + 3] - ax, dy = p[i * 3 + 4] - ay, dz = p[i * 3 + 5] - az
  const len2 = dx * dx + dy * dy + dz * dz
  const u = len2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy + (z - az) * dz) / len2)) : 0
  return Math.hypot(ax + u * dx - x, ay + u * dy - y, az + u * dz - z)
}

// FluidNC reads the file ahead of the motion: start at the read position (SD percent → byte → segment)
// and look back for the segment nearest the tool. Never moves backwards.
export function currentSegment(job, percent, pos, prev = -1) {
  const { pts, offset } = job
  const byte = (percent / 100) * job.bytes
  let lo = 0, hi = offset.length - 1, ahead = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (offset[mid] <= byte) {
      ahead = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  let best = prev, bestD = Infinity
  for (let i = ahead; i >= Math.max(prev, ahead - LOOK_BACK, 0); i--) {
    const d = distToSegment(pts, i, pos)
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return Math.max(prev, best)
}

// Time left: the G-code estimate for what's left, scaled by how fast the job has really gone.
export function remaining(job, i, elapsed) {
  const total = job.time.at(-1) ?? 0
  if (i < 0) return total
  const done = job.time[i]
  const left = total - done
  return done > 30 ? (left * elapsed) / done : left // ponytail: trust the raw estimate for the first 30 s
}
