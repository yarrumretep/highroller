import { getValue } from './yaml-edit.js'

// Homing as FluidNC 3.9.9 reports and configures it.

const LOSES_POSITION = [1, 3, 6, 7, 8, 9, 12, 13] // ALARM codes after which the machine position can't be trusted (7, 12: homing failed)

// The axes homed so far ({ X: true, … }) after one line from the controller. 3.9.9 prints one
// [MSG:Homed:<axes>] per homing cycle (the stock LowRider homes Z, then XY), so homing Z alone marks only Z.
// A probe miss (ALARM:5) drove the bit up to 20 mm into something: Z may have stalled, so Z counts as unhomed.
export function homedAfter(homed, line) {
  const h = /^\[MSG:Homed:([A-Za-z]+)/.exec(line)
  if (h) return { ...homed, ...Object.fromEntries([...h[1].toUpperCase()].map(a => [a, true])) }
  const a = /^ALARM:(\d+)/.exec(line)
  if (!a) return homed
  if (LOSES_POSITION.includes(Number(a[1]))) return {}
  if (Number(a[1]) === 5 && homed.Z) return { ...homed, Z: false }
  return homed
}

// axes/<axis>/homing/positive_direction: absent means true; otherwise FluidNC compares with "true", ignoring case.
export function homesPositive(text, axis) {
  const v = getValue(text, `axes/${axis}/homing/positive_direction`)
  return v === undefined || v.toLowerCase() === 'true'
}
