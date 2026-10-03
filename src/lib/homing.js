import { getValue } from './yaml-edit.js'

// Homing as FluidNC 3.9.9 reports and configures it.

const LOSES_POSITION = [1, 3, 6, 8, 9, 13] // ALARM codes after which the machine position can't be trusted

// The axes homed so far ({ X: true, … }) after one line from the controller. 3.9.9 prints one
// [MSG:Homed:<axes>] per homing cycle (the stock LowRider homes Z, then XY), so homing Z alone marks only Z.
export function homedAfter(homed, line) {
  const h = /^\[MSG:Homed:([A-Za-z]+)/.exec(line)
  if (h) return { ...homed, ...Object.fromEntries([...h[1].toUpperCase()].map(a => [a, true])) }
  const a = /^ALARM:(\d+)/.exec(line)
  return a && LOSES_POSITION.includes(Number(a[1])) ? {} : homed
}

// axes/<axis>/homing/positive_direction: absent means true; otherwise FluidNC compares with "true", ignoring case.
export function homesPositive(text, axis) {
  const v = getValue(text, `axes/${axis}/homing/positive_direction`)
  return v === undefined || v.toLowerCase() === 'true'
}
