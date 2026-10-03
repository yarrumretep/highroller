// FluidNC only takes override changes as ±10 % and ±1 % steps (or a reset to 100 %),
// so a slider target becomes a short list of real-time bytes.
const BYTES = {
  feed: { reset: 0x90, up10: 0x91, down10: 0x92, up1: 0x93, down1: 0x94 },
  spindle: { reset: 0x99, up10: 0x9a, down10: 0x9b, up1: 0x9c, down1: 0x9d },
}

export const RAPID = { 25: 0x97, 50: 0x96, 100: 0x95 }

export function overrideBytes(kind, from, to) {
  const b = BYTES[kind]
  to = Math.min(200, Math.max(10, Math.round(to)))
  if (to === from) return []
  if (to === 100) return [b.reset]
  const out = []
  let v = from
  while (to - v >= 10) { out.push(b.up10); v += 10 }
  while (v - to >= 10) { out.push(b.down10); v -= 10 }
  while (v < to) { out.push(b.up1); v++ }
  while (v > to) { out.push(b.down1); v-- }
  return out
}
