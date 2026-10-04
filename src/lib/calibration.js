import { skew, tilt, stepsPerMm, splitPulloff } from './calib.js'
import { getValue, setValue } from './yaml-edit.js'
import { probeLines } from './probe.js'
import { homesPositive } from './homing.js'

// One calibration pass, written as a script. The UI (or a test) supplies `io`: the config, machine commands,
// the probe, and the manual steps. The first page picks what to calibrate. Z tilt alone needs the touch plate
// at the two front corners; squareness and X/Y steps per mm need four V-bit dots on tape, measured (their
// probes give the tilt for free). Every correction is applied with one config write and one restart.
const DOT_FEED = 100 // mm/min, pushing the V-bit into the surface
const TRAVEL_ABOVE_MM = 10 // travel height above the first touch
const WORSE = 1.2 // a pass that leaves more than this much of the previous error made it worse
const LIFT_MM = 5 // after a probe that can be redone, before it is tried again
const OFF_MM = 0.5 // a corner probed further than this from where it was sent is mentioned in the review
const MAX_PULLOFF_STEP = 3 // mm per motor per pass; more is likelier a bad measurement than a real error

const r3 = v => Math.round(v * 1000) / 1000
const fmt = v => r3(v).toFixed(3) // config values keep three decimals
const num = v => String(r3(v)) // G-code numbers: no trailing zeros

// Why an edited config must not be written, or null: every line must stay where it was, and still be blank,
// a comment or a `key:` line.
export function badEdit(old, text) {
  const lines = text.split('\n')
  if (lines.length !== old.split('\n').length) return 'the number of lines changed'
  const i = lines.findIndex(l => l.trim() && !l.trim().startsWith('#') && !/^\s*[A-Za-z0-9_-]+:/.test(l))
  return i < 0 ? null : `line ${i + 1} is not a key: ${lines[i].trim()}`
}

export async function calibrate(io) {
  const { settings: s } = io
  const g = async line => {
    const r = await io.send(line)
    if (!r.ok) throw new Error(`${line} failed: ${r.error}`)
  }

  io.busy('Reading the config…')
  const config = await io.readConfig() // fresh: another device may have changed it since this page read it
  if (!config?.range) throw new Error('The config has no axis travel (max_travel_mm / homing) to work from')
  const { X, Y, Z } = config.range
  // The lever arm that turns a measured slope into a pull-off change: the X travel. The motors sit a little
  // further apart than that (the core's width), so one pass corrects most of the error and the check pass
  // takes the rest.
  const span = X.max - X.min

  // What to calibrate, and the two numbers that go with it (remembered in the settings for next time).
  let what = { tilt: true, square: true, steps: true, dotMm: s.dotMm, marginMm: s.marginMm }, whatError = null
  for (;;) {
    what = await io.ask({
      title: 'Calibrate',
      text: 'Z tilt needs the touch plate at two front corners. Squareness and steps per mm need four V-bit dots on tape, measured with calipers or a tape measure.',
      checks: [
        { name: 'tilt', label: 'Z tilt: level the gantry' },
        { name: 'square', label: 'Squareness' },
        { name: 'steps', label: 'Steps per mm (X and Y)' },
      ],
      fields: [
        { name: 'dotMm', label: 'Dot depth below the probed surface', unit: 'mm', step: 0.05, enabledIf: v => !!(v.square || v.steps) },
        { name: 'marginMm', label: 'Corner margin inside the travel', unit: 'mm', step: 1, allowZero: true },
      ],
      error: whatError,
      values: what,
    })
    const dots = what.square || what.steps
    const m = what.marginMm
    whatError = !(what.tilt || dots) ? 'Tick at least one.'
      : dots && !(what.dotMm > 0) ? 'Dot depth: a number above 0.'
      : !(m >= 0) ? 'Corner margin: 0 or more.'
      : !(X.max - m > X.min + m && Y.max - m > Y.min + m) ? 'The margin leaves no rectangle inside the travel: lower it.'
      : null
    if (!whatError) break
  }
  const dots = !!(what.square || what.steps) // dots are made (and measured) only for squareness or steps per mm
  const dotMm = what.dotMm
  s.marginMm = what.marginMm
  if (dots) s.dotMm = dotMm
  const xMin = X.min + what.marginMm, xMax = X.max - what.marginMm, yMin = Y.min + what.marginMm, yMax = Y.max - what.marginMm
  const corners = [
    { name: 'A', x: xMin, y: yMin },
    { name: 'B', x: xMax, y: yMin },
    ...(dots ? [{ name: 'C', x: xMax, y: yMax }, { name: 'D', x: xMin, y: yMax }] : []),
  ]
  const xyLines = corners.map(c => `G53 G0 X${c.x} Y${c.y}`) // computed once; the same strings are previewed and sent

  // Computed once, shown to the user, then sent — never recomputed between preview and send.
  let travelZ = Z.max
  const homeLine = '$H'
  const firstZLine = `G53 G0 Z${num(travelZ)}`
  const finalZLine = `G53 G0 Z${num(Z.max)}` // the rapid up after the last corner; same height as firstZLine

  const under = dots ? 'tape' : 'plate'
  await io.step({
    title: 'Before you start',
    text: (dots
      ? 'Fit a V-bit and make sure the router is off. You will need four pieces of masking tape, the touch plate and its clip, and calipers or a tape measure. Dots go at the four corners of a ' + `${xMax - xMin} × ${yMax - yMin} mm rectangle.`
      : `Make sure the router is off. You will need the touch plate and its clip. The plate is touched at the two front corners, ${xMax - xMin} mm apart, and carried from one to the other.`)
      + (what.tilt ? ` Note: tilt is measured against the surface the ${under} sits on; if this machine already surfaced the spoilboard, that surface follows the old tilt, so for a true reading put the ${under} on something the machine did not cut, such as a straight bar laid across.` : ''),
    lines: [homeLine, firstZLine, xyLines[0]],
  })
  io.busy('Homing…')
  await g(homeLine)

  for (let i = 0; i < corners.length; i++) {
    const c = corners[i]
    io.busy(`Moving to corner ${c.name}…`)
    const zLine = i === 0 ? firstZLine : `G53 G0 Z${num(travelZ)}`
    await g(zLine)
    await g(xyLines[i])
    await g('G4 P0')
    if (c.name === 'A') {
      // Z only: an X/Y jog here would move the dot away from the corner the maths expects
      await io.step({ title: 'Corner A: set the height', text: 'Jog the bit down until it is a few millimetres above where the plate will sit, then continue.', jog: 'z' })
    }
    // Touches that disagree (the bit rests on the plate) or a refusal before any motion are redone: lift clear
    // and ask again. Anything else ends the pass: no contact means the bit went 20 mm down into whatever was
    // there and may have lost steps, and STOP is STOP.
    for (let error = null; ;) {
      await io.step({
        title: `Corner ${c.name}: ${dots ? 'tape and plate' : 'touch plate'}`,
        text: (dots ? 'Stick a piece of tape under the bit. Put the touch plate on the tape' : 'Put the touch plate under the bit') + ' and attach the clip to the bit. Tap the plate against the bit so the app sees the contact, then press Probe.',
        arm: true,
        lines: probeLines(),
        error,
      })
      io.busy('Probing…')
      try {
        c.probed = await io.probe() // { x, y, z }: where the dot will be, in machine coordinates
        break
      } catch (e) {
        if (!e.retry) throw e
        error = `${e.message}${/[.?!]$/.test(e.message) ? '' : '.'} The bit was lifted ${LIFT_MM} mm; probe this corner again.`
        io.busy(`Probe failed; lifting ${LIFT_MM} mm…`)
        await g('G91')
        await g(`G0 Z${LIFT_MM}`)
        await g('G90')
      }
    }
    // The probe ends with the bit resting on the plate: lift clear of it before asking for the plate back.
    io.busy(`Lifting ${LIFT_MM} mm off the plate…`)
    await g('G91')
    await g(`G0 Z${LIFT_MM}`)
    await g('G90')
    const z = c.probed.z
    // The dot goes dotMm below the surface the plate sat on (the touch is one plate above it). Without dots the
    // step is just where the plate is picked up before the bit moves on.
    const dotLines = dots ? ['M5', `G53 G1 Z${num(z - s.plateMm - dotMm)} F${DOT_FEED}`] : []
    if (c.name === 'A') travelZ = Math.min(z + TRAVEL_ABOVE_MM, Z.max)
    const upLine = `G53 G0 Z${num(travelZ)}`
    // What Continue actually goes on to run: this corner's dot, then the rapid to the next corner
    // (or, after the last one, just the final rapid up — there's no further corner to move to).
    const nextLines = i < corners.length - 1 ? [upLine, xyLines[i + 1]] : [finalZLine]
    await io.step({
      title: dots ? `Corner ${c.name}: make the dot` : `Corner ${c.name}: pick up the plate`,
      text: dots
        ? `Lift the plate off the tape. Keep the clip on. Press Continue to make the dot, ${num(dotMm)} mm below the surface the plate sat on.`
        : 'Lift the plate clear of the bit. Keep the clip on. Press Continue to move on.',
      plateOff: true, // the plate must not still be touching the bit
      lines: [...dotLines, upLine, 'G4 P0', ...nextLines],
    })
    for (const l of dotLines) await g(l)
    await g(upLine)
    await g('G4 P0')
  }
  await g(finalZLine)

  // The maths uses where each dot actually is: the probe's own position.
  const [A, B, C, D] = corners.map(c => c.probed)
  const len = (p, q) => Math.hypot(q.x - p.x, q.y - p.y)
  // Tilt: the X-max side lower by this much across the gantry (both rows averaged; with the plate alone, the front one)
  const rowTilt = (p, q) => tilt({ zMin: p.z, zMax: q.z, xMin: p.x, xMax: q.x })
  const tiltMm = what.tilt ? span * (dots ? (rowTilt(A, B) + rowTilt(D, C)) / 2 : rowTilt(A, B)) : null

  // The measurements: the diagonals give squareness, the sides steps per mm.
  let m = null, skewMm = null, W = 0, H = 0
  if (dots) {
    const expected = { ac: len(A, C), bd: len(B, D), ab: len(A, B), dc: len(D, C), ad: len(A, D), bc: len(B, C) }
    const fields = [
      ...(what.square ? [
        { name: 'ac', label: 'Diagonal A–C', unit: 'mm' },
        { name: 'bd', label: 'Diagonal B–D', unit: 'mm' },
      ] : []),
      ...(what.steps ? [
        { name: 'ab', label: 'Side A–B (X, front)', unit: 'mm', optional: true },
        { name: 'dc', label: 'Side D–C (X, back)', unit: 'mm', optional: true },
        { name: 'ad', label: 'Side A–D (Y, left)', unit: 'mm', optional: true },
        { name: 'bc', label: 'Side B–C (Y, right)', unit: 'mm', optional: true },
      ] : []),
    ]
    let error = null
    for (;;) {
      m = await io.ask({
        title: 'Measure the dots',
        text: 'Measure between the dot centres.' + (what.steps ? ' One side per axis is enough for steps per mm; two are averaged.' : '') + ` The rectangle was commanded as ${xMax - xMin} × ${yMax - yMin} mm.`,
        fields,
        error,
        values: m, // what was typed stays filled in when it is asked again
      })
      // More than 1 % or 10 mm (whichever is smaller) away from where the dots were put is a misreading, not an error to correct.
      const bad = fields.find(f => m[f.name] != null && Math.abs(m[f.name] - expected[f.name]) > Math.min(0.01 * expected[f.name], 10))
      if (bad) { error = `${bad.label}: ${m[bad.name]} mm is too far from the expected ${expected[bad.name].toFixed(1)} mm. Measure it again.`; continue }
      break
    }
    W = (expected.ab + expected.dc) / 2
    H = (expected.ad + expected.bc) / 2
    // Skew: the X-max side further along +Y by this much across the span. A skewed length² is dx² + dy² + 2θ·dx·dy,
    // so what the diagonals measure beyond the probed spots' own difference is the skew.
    if (what.square) skewMm = span * (skew({ ac: m.ac, bd: m.bd, w: W, h: H }) - skew({ ac: expected.ac, bd: expected.bd, w: W, h: H }))
  }

  // The motor-side swap is only a proposal until the review is confirmed (it must not stick on Cancel).
  const notes = []
  corners.forEach(c => {
    const off = len(c, c.probed)
    if (off > OFF_MM) notes.push(`Corner ${c.name} was probed at X${num(c.probed.x)} Y${num(c.probed.y)}, ${fmt(off)} mm from where it was sent; the numbers use where it was probed.`)
  })
  let yMotor0AtXmax = s.yMotor0AtXmax, zMotor0AtXmax = s.zMotor0AtXmax
  if (skewMm != null && s.lastSkewMm != null && Math.abs(skewMm) > WORSE * Math.abs(s.lastSkewMm) && Math.sign(skewMm) === Math.sign(s.lastSkewMm)) {
    yMotor0AtXmax = !yMotor0AtXmax
    notes.push('The last pass made squareness worse, so the Y motor sides will be swapped.')
  }
  if (tiltMm != null && s.lastTiltMm != null && Math.abs(tiltMm) > WORSE * Math.abs(s.lastTiltMm) && Math.sign(tiltMm) === Math.sign(s.lastTiltMm)) {
    zMotor0AtXmax = !zMotor0AtXmax
    notes.push('The last pass made the tilt worse, so the Z motor sides will be swapped.')
  }

  // Pull-off: `delta` is how much too far from its switch the X-max side sits. Lower means further from a top
  // switch; further +Y means further from a Y-min switch. The opposite homing direction flips the sign.
  // One review entry per checkbox; an axis's two pull-offs go together, since one without the other moves the origin.
  const changes = []
  const pulloffs = (axis, delta, motor0AtXmax, what, measured) => {
    const p0 = Number(getValue(config.text, `axes/${axis}/motor0/pulloff_mm`))
    const p1 = Number(getValue(config.text, `axes/${axis}/motor1/pulloff_mm`))
    if (!(p0 >= 0 && p1 >= 0)) return notes.push(`No twin-motor pull-off found for ${axis.toUpperCase()}; ${what} not corrected.`)
    const [n0, n1] = splitPulloff({ p0, p1, delta, motor0AtXmax })
    if (Math.max(Math.abs(n0 - p0), Math.abs(n1 - p1)) > MAX_PULLOFF_STEP) {
      throw new Error(`This pass would change the ${axis.toUpperCase()} pull-offs by ${fmt(n0 - p0)} and ${fmt(n1 - p1)} mm (${what}: ${fmt(measured)} mm across the gantry), more than ${MAX_PULLOFF_STEP} mm per pass, so nothing was changed. Check the measurements. If they are right, the machine is further out than one pass corrects: square it by hand, or correct the pull-offs in steps of up to ${MAX_PULLOFF_STEP} mm, then run the pass again.`)
    }
    const edits = [['motor0', p0, n0], ['motor1', p1, n1]]
      .filter(([, old, now]) => fmt(old) !== fmt(now))
      .map(([motor, old, now]) => ({ path: `axes/${axis}/${motor}/pulloff_mm`, label: motor, old: fmt(old), new: fmt(now) }))
    if (edits.length) changes.push({ key: what, label: `${axis.toUpperCase()} pull-offs (${what})`, edits })
  }
  if (what.tilt) pulloffs('z', (homesPositive(config.text, 'z') ? 1 : -1) * tiltMm, zMotor0AtXmax, 'tilt', tiltMm)
  if (what.square) pulloffs('y', (homesPositive(config.text, 'y') ? -1 : 1) * skewMm, yMotor0AtXmax, 'squareness', skewMm)

  // Homing sets the position in whole steps and the soft-limit travel starts exactly at mpos_mm, so a homed
  // position that is not a whole number of steps lands a fraction of a step outside the travel and trips ALARM:2.
  const softLimitNote = (axis, now) => {
    if (getValue(config.text, `axes/${axis}/soft_limits`) !== 'true') return
    const mpos = Number(getValue(config.text, `axes/${axis}/homing/mpos_mm`) ?? 0)
    const steps = mpos * now
    if (mpos && Math.abs(steps - Math.round(steps)) > 1e-6) notes.push(`${axis.toUpperCase()} has soft limits and homes to mpos_mm ${num(mpos)}, which is ${fmt(steps)} steps at the new steps per mm: the homed position would land just outside the travel and the first move would trip ALARM:2. Set axes/${axis}/homing/mpos_mm to 0 (and add ${num(mpos)} to max_travel_mm) before applying.`)
  }
  const scale = (axis, commanded, a, b) => {
    const given = [a, b].filter(v => v > 0) // one side is enough; two are averaged
    if (!given.length) return null
    const cur = Number(getValue(config.text, `axes/${axis}/steps_per_mm`))
    const now = stepsPerMm(cur, commanded, given.reduce((s, v) => s + v, 0) / given.length)
    if (fmt(cur) !== fmt(now)) {
      changes.push({ label: `${axis.toUpperCase()} steps per mm`, edits: [{ path: `axes/${axis}/steps_per_mm`, old: fmt(cur), new: fmt(now) }] })
      softLimitNote(axis, Number(fmt(now)))
    }
    return now / cur
  }
  // Only one axis measured: offer the other the same scale, unticked (same belts, but not the same pulleys or tension).
  const sameScale = (axis, from, ratio) => {
    const cur = Number(getValue(config.text, `axes/${axis}/steps_per_mm`))
    const now = cur * ratio
    if (fmt(cur) !== fmt(now)) {
      changes.push({ label: `${axis.toUpperCase()} steps per mm (same scale as ${from}, unmeasured)`, unticked: true, edits: [{ path: `axes/${axis}/steps_per_mm`, old: fmt(cur), new: fmt(now) }] })
      softLimitNote(axis, Number(fmt(now)))
    }
  }
  if (what.steps) {
    const xRatio = scale('x', W, m.ab, m.dc)
    const yRatio = scale('y', H, m.ad, m.bc)
    if (xRatio != null && yRatio == null) sameScale('y', 'X', xRatio)
    if (yRatio != null && xRatio == null) sameScale('x', 'Y', yRatio)
  }

  const summary = { tiltMm: tiltMm == null ? null : r3(tiltMm), skewMm: skewMm == null ? null : r3(skewMm), changes, applied: false }
  const chosen = await io.review({
    changes,
    notes: [
      ...(tiltMm == null ? [] : [`Z tilt: the X-max side is ${fmt(Math.abs(tiltMm))} mm ${tiltMm >= 0 ? 'lower' : 'higher'} across the gantry.`]),
      ...(skewMm == null ? [] : [`Squareness: the X-max side is ${fmt(Math.abs(skewMm))} mm ${skewMm >= 0 ? 'ahead' : 'behind'} across the gantry.`]),
      ...notes,
    ],
    lines: ['$Bye', '$H'], // what Apply goes on to run — homing is a move too
  })
  if (!chosen || !chosen.length) return summary

  let text = config.text
  for (const c of chosen) for (const e of c.edits) text = setValue(text, e.path, e.new)
  io.busy('Writing the config and restarting…')
  await io.apply(text, config) // with the config it was computed from, to check the file hasn't changed since

  // Only now that apply() has actually succeeded are the proposed motor-side swap and the last-pass
  // numbers committed — and only for an axis whose change was applied; a failed (or stopped) apply
  // must leave settings exactly as they were.
  if (chosen.some(c => c.key === 'squareness')) {
    s.yMotor0AtXmax = yMotor0AtXmax
    s.lastSkewMm = r3(skewMm)
  }
  if (chosen.some(c => c.key === 'tilt')) {
    s.zMotor0AtXmax = zMotor0AtXmax
    s.lastTiltMm = r3(tiltMm)
  }
  summary.applied = true
  summary.changes = chosen
  return summary
}
