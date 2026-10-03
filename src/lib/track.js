// Which segment of a running job is being cut, and how long is left.
const ON_PATH_MM = 0.05 // closer than this counts as "on the segment"
const PLANNER_LINES = 64 // FluidNC queues at most planner_blocks (32) lines beyond what is executing; doubled for margin
const WINDOW = 5000 // ponytail: segments scanned per report; if the tool jumped further the trail lags, then catches up

function distToSegment(p, i, [x, y, z]) {
  const ax = p[i * 3], ay = p[i * 3 + 1], az = p[i * 3 + 2]
  const dx = p[i * 3 + 3] - ax, dy = p[i * 3 + 4] - ay, dz = p[i * 3 + 5] - az
  const len2 = dx * dx + dy * dy + dz * dz
  const u = len2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy + (z - az) * dz) / len2)) : 0
  return Math.hypot(ax + u * dx - x, ay + u * dy - y, az + u * dz - z)
}

// FluidNC reads the file ahead of the motion, so the SD percent gives an upper bound. The tool moves along the
// path in order: walk forward from where it was and stop at the first segment it is on, so a path that revisits
// a point resolves to the earliest visit not yet passed. Never moves backwards.
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
  if (ahead < 0) return prev
  // The planner holds a bounded number of lines, so the tool is at most that many motion lines behind the read position.
  let floor = ahead
  for (let lines = 1; floor > 0 && lines < PLANNER_LINES; floor--) if (offset[floor - 1] !== offset[floor]) lines++
  while (floor > 0 && offset[floor - 1] === offset[floor]) floor-- // back to the first segment of that line
  let best = prev, bestD = Infinity
  for (let i = Math.max(prev, floor, 0), end = Math.min(ahead, i + WINDOW); i <= end; i++) {
    const d = distToSegment(pts, i, pos)
    if (d < bestD) {
      bestD = d
      best = i
    }
    if (d < ON_PATH_MM) break
  }
  return best
}

// Time left: the G-code estimate for what's left, scaled by how fast the job has really gone.
export function remaining(job, i, elapsed) {
  const total = job.time.at(-1) ?? 0
  if (i < 0) return total
  const done = job.time[i]
  const left = total - done
  return done > 30 ? (left * elapsed) / done : left // ponytail: trust the raw estimate for the first 30 s
}
