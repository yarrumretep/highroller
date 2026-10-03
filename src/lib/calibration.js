import { skew, tilt, stepsPerMm, splitPulloff } from './calib.js'
import { getValue, setValue } from './yaml-edit.js'

// One calibration pass, written as a script. The UI (or a test) supplies `io`: machine commands, the probe,
// and the manual steps. Four V-bit dots on tape give Z tilt (from the probes), squareness (the diagonals)
// and X/Y steps per mm (the sides); every correction is applied with one config write and one restart.
const DOT_FEED = 100 // mm/min, pushing the V-bit into the tape
const TRAVEL_ABOVE_MM = 10 // travel height above the first touch
const WORSE = 1.2 // a pass that leaves more than this much of the previous error made it worse

const r3 = v => Math.round(v * 1000) / 1000
const fmt = v => r3(v).toFixed(3) // config values keep three decimals
const num = v => String(r3(v)) // G-code numbers: no trailing zeros

export async function calibrate(io) {
  const { settings: s, config } = io
  if (!config?.range) throw new Error('The config has no axis travel (max_travel_mm / homing) to work from')
  const g = async line => {
    const r = await io.send(line)
    if (!r.ok) throw new Error(`${line} failed: ${r.error}`)
  }
  if (!(s.spanMm > 0)) {
    const a = await io.ask({ title: 'Gantry span', text: 'Distance between the two Y motors (and the two Z motors), in mm.', fields: [{ name: 'spanMm', label: 'Span', unit: 'mm' }] })
    if (!(a.spanMm > 0)) throw new Error('A gantry span is needed')
    s.spanMm = Number(a.spanMm)
  }

  const { X, Y, Z } = config.range
  const xMin = X.min + s.marginMm, xMax = X.max - s.marginMm, yMin = Y.min + s.marginMm, yMax = Y.max - s.marginMm
  const corners = [
    { name: 'A', x: xMin, y: yMin },
    { name: 'B', x: xMax, y: yMin },
    { name: 'C', x: xMax, y: yMax },
    { name: 'D', x: xMin, y: yMax },
  ]

  await io.step({
    title: 'Before you start',
    text: 'Fit a V-bit and make sure the router is off. You will need four pieces of masking tape, the touch plate and its clip, and calipers or a tape measure. Dots go at the four corners of a ' + `${xMax - xMin} × ${yMax - yMin} mm rectangle.`,
  })
  io.busy('Homing…')
  await g('$H')

  let travelZ = Z.max
  for (const c of corners) {
    io.busy(`Moving to corner ${c.name}…`)
    await g(`G53 G0 Z${num(travelZ)}`)
    await g(`G53 G0 X${c.x} Y${c.y}`)
    await g('G4 P0')
    if (c.name === 'A') {
      await io.step({ title: 'Corner A: set the height', text: 'Jog the bit down until it is a few millimetres above where the plate will sit, then continue.', jog: true })
    }
    await io.step({
      title: `Corner ${c.name}: tape and plate`,
      text: 'Stick a piece of tape under the bit. Put the touch plate on the tape and attach the clip to the bit. Tap the plate against the bit so the app sees the contact, then press Probe.',
      arm: true,
    })
    io.busy('Probing…')
    c.z = (await io.probe()).z
    await io.step({ title: `Corner ${c.name}: make the dot`, text: 'Lift the plate off the tape. Keep the clip on. Press Continue to push the bit into the tape.' })
    await g('M5')
    await g('G91')
    await g('G0 Z2')
    await g('G90')
    await g(`G53 G1 Z${num(c.z - s.plateMm - s.tapeMm)} F${DOT_FEED}`)
    if (c.name === 'A') travelZ = c.z + TRAVEL_ABOVE_MM
    await g(`G53 G0 Z${num(travelZ)}`)
    await g('G4 P0')
  }
  await g(`G53 G0 Z${Z.max}`)

  const [A, B, C, D] = corners
  const W = xMax - xMin, H = yMax - yMin
  const m = await io.ask({
    title: 'Measure the dots',
    text: `Measure between the dot centres. The diagonals give squareness; the sides are optional and give steps per mm. The rectangle was commanded as ${W} × ${H} mm.`,
    fields: [
      { name: 'ac', label: 'Diagonal A–C', unit: 'mm' },
      { name: 'bd', label: 'Diagonal B–D', unit: 'mm' },
      { name: 'ab', label: 'Side A–B (X, front)', unit: 'mm', optional: true },
      { name: 'dc', label: 'Side D–C (X, back)', unit: 'mm', optional: true },
      { name: 'ad', label: 'Side A–D (Y, left)', unit: 'mm', optional: true },
      { name: 'bc', label: 'Side B–C (Y, right)', unit: 'mm', optional: true },
    ],
  })

  // Tilt: the X-max side lower by this much across the gantry span (average of the two rows)
  const tiltMm = s.spanMm * (tilt({ zMin: A.z, zMax: B.z, xMin: A.x, xMax: B.x }) + tilt({ zMin: D.z, zMax: C.z, xMin: D.x, xMax: C.x })) / 2
  // Skew: the X-max side further along +Y by this much across the span
  const skewMm = s.spanMm * skew({ ac: m.ac, bd: m.bd, w: W, h: H })

  const notes = []
  if (s.lastSkewMm != null && Math.abs(skewMm) > WORSE * Math.abs(s.lastSkewMm) && Math.sign(skewMm) === Math.sign(s.lastSkewMm)) {
    s.yMotor0AtXmax = !s.yMotor0AtXmax
    notes.push('The last pass made squareness worse, so the Y motor sides have been swapped.')
  }
  if (s.lastTiltMm != null && Math.abs(tiltMm) > WORSE * Math.abs(s.lastTiltMm) && Math.sign(tiltMm) === Math.sign(s.lastTiltMm)) {
    s.zMotor0AtXmax = !s.zMotor0AtXmax
    notes.push('The last pass made the tilt worse, so the Z motor sides have been swapped.')
  }

  // Pull-off: `delta` is how much too far from its switch the X-max side sits. Lower means further from a top
  // switch; further +Y means further from a Y-min switch. The opposite homing direction flips the sign.
  const homesPositive = axis => getValue(config.text, `axes/${axis}/homing/positive_direction`) === 'true'
  const changes = []
  const pulloffs = (axis, delta, motor0AtXmax, what) => {
    const p0 = Number(getValue(config.text, `axes/${axis}/motor0/pulloff_mm`))
    const p1 = Number(getValue(config.text, `axes/${axis}/motor1/pulloff_mm`))
    if (!(p0 >= 0 && p1 >= 0)) return notes.push(`No twin-motor pull-off found for ${axis.toUpperCase()}; ${what} not corrected.`)
    const [n0, n1] = splitPulloff({ p0, p1, delta, motor0AtXmax })
    for (const [motor, old, now] of [['motor0', p0, n0], ['motor1', p1, n1]]) {
      if (fmt(old) !== fmt(now)) changes.push({ path: `axes/${axis}/${motor}/pulloff_mm`, label: `${axis.toUpperCase()} ${motor} pull-off`, old: fmt(old), new: fmt(now), apply: true })
    }
  }
  pulloffs('z', (homesPositive('z') ? 1 : -1) * tiltMm, s.zMotor0AtXmax, 'tilt')
  pulloffs('y', (homesPositive('y') ? -1 : 1) * skewMm, s.yMotor0AtXmax, 'squareness')

  const scale = (axis, commanded, a, b) => {
    if (!(a > 0 && b > 0)) return
    const cur = Number(getValue(config.text, `axes/${axis}/steps_per_mm`))
    const now = stepsPerMm(cur, commanded, (a + b) / 2)
    if (fmt(cur) !== fmt(now)) changes.push({ path: `axes/${axis}/steps_per_mm`, label: `${axis.toUpperCase()} steps per mm`, old: fmt(cur), new: fmt(now), apply: true })
  }
  scale('x', W, m.ab, m.dc)
  scale('y', H, m.ad, m.bc)

  const summary = { tiltMm: r3(tiltMm), skewMm: r3(skewMm), changes, applied: false }
  const chosen = await io.review({
    changes,
    notes: [
      `Z tilt: the X-max side is ${fmt(Math.abs(tiltMm))} mm ${tiltMm >= 0 ? 'lower' : 'higher'} across the gantry.`,
      `Squareness: the X-max side is ${fmt(Math.abs(skewMm))} mm ${skewMm >= 0 ? 'ahead' : 'behind'} across the gantry.`,
      ...notes,
    ],
  })
  if (!chosen || !chosen.length) return summary

  let text = config.text
  for (const c of chosen) text = setValue(text, c.path, c.new)
  io.busy('Writing the config and restarting…')
  await io.apply(text)
  s.lastSkewMm = r3(skewMm)
  s.lastTiltMm = r3(tiltMm)
  summary.applied = true
  summary.changes = chosen
  return summary
}
