import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calibrate, badEdit } from './calibration.js'
import { getValue } from './yaml-edit.js'
import { skew } from './calib.js'

const CONFIG = `axes:
  x:
    steps_per_mm: 50.000
    max_travel_mm: 1220
    homing:
      positive_direction: false
      mpos_mm: 3
    motor0:
      pulloff_mm: 4.000
  y:
    steps_per_mm: 50.000
    max_travel_mm: 2440
    homing:
      positive_direction: false
      mpos_mm: 3
    motor0:
      pulloff_mm: 4.000
    motor1:
      pulloff_mm: 4.000
  z:
    steps_per_mm: 200.000
    max_travel_mm: 300.000
    homing:
      positive_direction: true
      mpos_mm: 3
    motor0:
      pulloff_mm: 4.000
    motor1:
      pulloff_mm: 4.000
`
const range = { X: { min: 3, max: 1223 }, Y: { min: 3, max: 2443 }, Z: { min: -297, max: 3 } }

// A scripted machine and user: probes answer in order (an Error is thrown), questions get fixed answers,
// everything is recorded. The probe touches where the last corner move went, plus that corner's offset in `at`.
function scripted({ probes, answers, keep = c => true, at = [], text = CONFIG }) {
  const rec = { sent: [], steps: [], asks: [], review: null, applied: null, base: null, busy: [], order: [] }
  const settings = { plateMm: 10, tapeMm: 0.1, dotMm: 0.3, spanMm: 1200, marginMm: 50, yMotor0AtXmax: false, zMotor0AtXmax: false }
  const io = {
    settings,
    readConfig: async () => { rec.order.push('readConfig'); return { name: 'config.yaml', text, range } },
    send: async line => { rec.sent.push(line); return { ok: true, error: null, lines: [] } },
    probe: async () => {
      const z = probes.shift()
      if (z instanceof Error) throw z
      const moves = rec.sent.filter(l => l.startsWith('G53 G0 X'))
      const [, x, y] = /X(\S+) Y(\S+)/.exec(moves.at(-1))
      const [dx, dy] = at[moves.length - 1] ?? [0, 0]
      return { x: Number(x) + dx, y: Number(y) + dy, z }
    },
    step: async s => { rec.order.push(s.title); rec.steps.push(s) },
    ask: async q => { rec.asks.push(q); return answers.shift() },
    review: async r => { rec.review = r; return r.changes.filter(keep) },
    apply: async (text, base) => { rec.applied = text; rec.base = base },
    busy: t => rec.busy.push(t),
  }
  return { io, rec, settings }
}

const paths = changes => changes.flatMap(c => c.edits.map(e => e.path))

const d = (dx, dy) => Math.hypot(dx, dy)

test('one pass: probes, dots, measurements, and a single config write with every correction', async () => {
  // X-max side 0.5 mm lower at both rows; rectangle 1120 × 2340 with the X-max side 1 mm further along +Y; X reads 1 mm long.
  const { io, rec } = scripted({
    probes: [-40, -39.5, -39.5, -40],
    answers: [{ ac: d(1120, 2341), bd: d(1120, 2339), ab: 1121, dc: 1121, ad: 2340, bc: 2340 }],
  })
  const summary = await calibrate(io)

  // Corners in order, each at the travel height, then the dot sequence
  const moves = rec.sent.filter(l => l.startsWith('G53 G0 X'))
  assert.deepEqual(moves, ['G53 G0 X53 Y53', 'G53 G0 X1173 Y53', 'G53 G0 X1173 Y2393', 'G53 G0 X53 Y2393'])
  assert.equal(rec.sent[0], '$H')
  const a = rec.sent.indexOf('G53 G0 X53 Y53')
  // after the probe: lift clear of the plate, then (after Continue) the dot and the retract
  assert.deepEqual(rec.sent.slice(a + 1, a + 9), ['G4 P0', 'G91', 'G0 Z5', 'G90', 'M5', 'G53 G1 Z-50.4 F100', 'G53 G0 Z-30', 'G4 P0']) // touch − plate − tape − dot
  assert.ok(rec.sent.includes('G53 G1 Z-49.9 F100')) // corner B's dot, 0.5 mm higher

  // The numbers
  assert.ok(Math.abs(summary.tiltMm - 0.5357) < 0.001, `tilt ${summary.tiltMm}`)
  assert.ok(Math.abs(summary.skewMm - 1.0714) < 0.001, `skew ${summary.skewMm}`)
  assert.deepEqual(paths(rec.review.changes), ['axes/z/motor0/pulloff_mm', 'axes/z/motor1/pulloff_mm', 'axes/y/motor0/pulloff_mm', 'axes/y/motor1/pulloff_mm', 'axes/x/steps_per_mm'])
  assert.deepEqual(rec.review.changes.map(c => c.edits.length), [2, 2, 1]) // an axis's two pull-offs go under one checkbox
  const applied = rec.applied
  assert.equal(getValue(applied, 'axes/z/motor0/pulloff_mm'), '4.268')
  assert.equal(getValue(applied, 'axes/z/motor1/pulloff_mm'), '3.732')
  assert.equal(getValue(applied, 'axes/y/motor0/pulloff_mm'), '4.536')
  assert.equal(getValue(applied, 'axes/y/motor1/pulloff_mm'), '3.464')
  assert.equal(getValue(applied, 'axes/x/steps_per_mm'), '49.955')
  assert.equal(getValue(applied, 'axes/y/steps_per_mm'), '50.000') // sides matched: untouched
  assert.equal(io.settings.lastSkewMm.toFixed(3), '1.071')

  // F4: "make the dot" previews exactly what Continue goes on to send, through the rapid to the next corner
  const dotStepA = rec.steps.find(st => st.title === 'Corner A: make the dot')
  assert.deepEqual(dotStepA.lines, rec.sent.slice(a + 5, a + 11)) // M5, plunge, retract, G4, next corner's Z and XY
  // ... and after D, just the one final rapid up (no corner to move to)
  const dotStepD = rec.steps.find(st => st.title === 'Corner D: make the dot')
  assert.equal(dotStepD.lines.length, 5)
  assert.equal(dotStepD.lines.at(-1), 'G53 G0 Z3')

  // The review previews Apply's own moves ($Bye restarts the board; $H is a move too)
  assert.deepEqual(rec.review.lines, ['$Bye', '$H'])

  // The config is read fresh before anything else, and apply is told which text the pass was computed from
  assert.deepEqual(rec.order.slice(0, 2), ['readConfig', 'Before you start'])
  assert.equal(rec.base.text, CONFIG)
  // Corner A's height is set with Z only; a dot is not pushed while the plate still touches the bit
  assert.equal(rec.steps.find(st => st.title === 'Corner A: set the height').jog, 'z')
  assert.ok(rec.steps.filter(st => / make the dot$/.test(st.title)).every(st => st.plateOff))
})

test('unticked changes are not applied, and skipped side measurements leave steps/mm alone', async () => {
  const { io, rec } = scripted({
    probes: [-40, -40, -40, -40],
    answers: [{ ac: d(1120, 2341), bd: d(1120, 2339), ab: null, dc: null, ad: null, bc: null }],
    keep: c => c.edits[0].path.startsWith('axes/y/motor'),
  })
  await calibrate(io)
  assert.deepEqual(paths(rec.review.changes), ['axes/y/motor0/pulloff_mm', 'axes/y/motor1/pulloff_mm'])
  assert.equal(getValue(rec.applied, 'axes/y/motor1/pulloff_mm'), '3.464')
  assert.equal(getValue(rec.applied, 'axes/x/steps_per_mm'), '50.000')
})

test('a pass that made squareness worse flips the motor-side setting', async () => {
  const { io, rec, settings } = scripted({
    probes: [-40, -40, -40, -40],
    answers: [{ ac: d(1120, 2342), bd: d(1120, 2338), ab: null, dc: null, ad: null, bc: null }],
  })
  settings.lastSkewMm = 1.0 // last time the skew was 1 mm; now it is 2 mm, the same way
  await calibrate(io)
  assert.equal(settings.yMotor0AtXmax, true)
  assert.ok(rec.review.notes.some(n => /swapped/.test(n)))
  assert.equal(getValue(rec.applied, 'axes/y/motor0/pulloff_mm'), '2.929') // now motor0 is the X-max motor
})

test('stops cleanly when the user cancels at the review', async () => {
  const { io, rec } = scripted({ probes: [-40, -40, -40, -40], answers: [{ ac: d(1120, 2340), bd: d(1120, 2340), ab: null, dc: null, ad: null, bc: null }] })
  io.review = async () => null
  const summary = await calibrate(io)
  assert.equal(summary.applied, false)
  assert.equal(rec.applied, null)
})

test('one side length is enough for steps per mm', async () => {
  const { io, rec } = scripted({ probes: [-40, -40, -40, -40], answers: [{ ac: d(1120, 2340), bd: d(1120, 2340), ab: 1121, dc: null, ad: null, bc: null }] })
  await calibrate(io)
  const x = rec.review.changes.find(c => c.label === 'X steps per mm')
  assert.ok(x, 'an X steps-per-mm change from the front side alone')
  assert.ok(Number(x.edits[0].new) < Number(x.edits[0].old), 'measured long, so fewer steps per mm') // 1121 measured for 1120 commanded
  assert.ok(!rec.review.changes.some(c => c.label === 'Y steps per mm'))
  // the unmeasured axis is offered the same scale, unticked
  const y = rec.review.changes.find(c => c.label.startsWith('Y steps per mm (same scale as X'))
  assert.ok(y?.unticked, 'an unticked Y entry')
  assert.equal(Number(y.edits[0].new), Number((Number(y.edits[0].old) * Number(x.edits[0].new) / Number(x.edits[0].old)).toFixed(3)))
})

test('a refused command aborts with its message', async () => {
  const { io } = scripted({ probes: [], answers: [] })
  io.send = async line => ({ ok: line !== '$H', error: 'reset', lines: [] })
  await assert.rejects(calibrate(io), /\$H failed: reset/)
})

test('the motor-side swap is only saved once the review is confirmed, not on cancel', async () => {
  const { io, rec, settings } = scripted({
    probes: [-40, -40, -40, -40],
    answers: [{ ac: d(1120, 2342), bd: d(1120, 2338), ab: null, dc: null, ad: null, bc: null }],
  })
  settings.lastSkewMm = 1.0 // set up the same "made it worse" condition as the swap test above
  io.review = async r => { rec.review = r; return null } // user cancels at the review
  await calibrate(io)
  assert.equal(settings.yMotor0AtXmax, false) // proposed, but never committed
  assert.equal(rec.applied, null)
})

test('gantry span 0 uses the X travel as the lever arm', async () => {
  const wideRange = { ...range, X: { min: 0, max: 1250 } }
  const ac = d(1150, 2342), bd = d(1150, 2338)
  const { io } = scripted({
    probes: [-40, -40, -40, -40],
    answers: [{ ac, bd, ab: null, dc: null, ad: null, bc: null }],
  })
  io.readConfig = async () => ({ name: 'config.yaml', text: CONFIG, range: wideRange })
  io.settings.spanMm = 0
  const summary = await calibrate(io)
  const w = wideRange.X.max - io.settings.marginMm - (wideRange.X.min + io.settings.marginMm)
  const h = range.Y.max - io.settings.marginMm - (range.Y.min + io.settings.marginMm)
  const expected = 1250 * skew({ ac, bd, w, h })
  assert.ok(Math.abs(summary.skewMm - expected) < 0.001, `skewMm ${summary.skewMm} vs expected ${expected}`)
})

test('a swap and the last-pass numbers are committed only for an axis whose change was applied', async () => {
  const { io, rec, settings } = scripted({
    probes: [-40, -39.5, -39.5, -40],
    answers: [{ ac: d(1120, 2342), bd: d(1120, 2338), ab: null, dc: null, ad: null, bc: null }],
    keep: c => c.edits[0].path.startsWith('axes/z/'),
  })
  settings.lastSkewMm = 1.0 // both got worse the same way: both swaps are proposed
  settings.lastTiltMm = 0.2
  await calibrate(io)
  assert.equal(rec.review.notes.filter(n => /swapped/.test(n)).length, 2)
  assert.equal(settings.zMotor0AtXmax, true)
  assert.equal(settings.lastTiltMm, 0.536)
  assert.equal(settings.yMotor0AtXmax, false) // the Y change was not applied: its swap and skew stay as they were
  assert.equal(settings.lastSkewMm, 1.0)
  assert.equal(getValue(rec.applied, 'axes/y/motor0/pulloff_mm'), '4.000')
})

test('the maths uses where each corner was probed, and the review says when that is off the commanded corner', async () => {
  // A square machine, but corner A ended up 5 mm left and 4 mm further back: the measurements match the probed spots
  const A = [48, 57], B = [1173, 53], C = [1173, 2393], D = [53, 2393]
  const dist = (p, q) => d(q[0] - p[0], q[1] - p[1])
  const { io, rec } = scripted({
    probes: [-40, -40, -40, -40],
    at: [[-5, 4]],
    answers: [{ ac: dist(A, C), bd: dist(B, D), ab: dist(A, B), dc: dist(D, C), ad: dist(A, D), bc: dist(B, C) }],
  })
  const summary = await calibrate(io)
  assert.ok(Math.abs(summary.skewMm) < 0.001, `skew ${summary.skewMm}`) // the commanded rectangle would read -0.86
  assert.deepEqual(rec.review.changes, [])
  assert.ok(rec.review.notes.some(n => /^Corner A was probed at X48 Y57, 6.403 mm from/.test(n)), rec.review.notes.join('|'))
  assert.ok(!rec.review.notes.some(n => /^Corner [BCD] was probed/.test(n)))
})

test('measurements more than 1 % or 10 mm off what was commanded are asked again', async () => {
  // margin 500: a 220 × 1440 rectangle, so a side may be 2.2 mm off (1 %) and a diagonal 10 mm
  const diag = d(220, 1440)
  const none = { ab: null, dc: null, ad: null, bc: null }
  const { io, rec } = scripted({
    probes: [-40, -40, -40, -40],
    answers: [
      { ac: diag + 10.5, bd: diag, ...none },
      { ac: diag + 9.5, bd: diag, ...none, ab: 222.3 },
      { ac: diag, bd: diag, ...none, ab: 222.1, dc: 222.1 },
    ],
  })
  io.settings.marginMm = 500
  await calibrate(io)
  assert.equal(rec.asks.length, 3)
  assert.equal(rec.asks[0].error, null)
  assert.match(rec.asks[1].error, /Diagonal A–C: .* the expected 1456\.7 mm/)
  assert.match(rec.asks[2].error, /Side A–B \(X, front\): .* the expected 220\.0 mm/)
  assert.deepEqual(rec.asks[1].values, { ac: diag + 10.5, bd: diag, ...none }) // what was typed stays filled in
  assert.ok(rec.review)
})

test('a pull-off change of more than 3 mm on a motor is refused', async () => {
  const { io, rec } = scripted({
    probes: [-40, -34, -34, -40], // touches 6 mm higher on the X-max side: 6.4 mm of tilt across the span
    answers: [{ ac: d(1120, 2340), bd: d(1120, 2340), ab: null, dc: null, ad: null, bc: null }],
  })
  await assert.rejects(calibrate(io), /Z pull-offs by 3\.429 and -3\.000 mm \(tilt: 6\.429 mm across the gantry\).*more than 3 mm.*Check the measurements.*If they are right.*square it by hand/)
  assert.equal(rec.review, null)
  assert.equal(rec.applied, null)
})

const redo = message => Object.assign(new Error(message), { retry: true }) // as probeZ marks one that can be tried again

test('a probe that can be redone lifts 5 mm and repeats that corner, as often as it fails; a miss or STOP ends the pass', async () => {
  const { io, rec } = scripted({
    probes: [redo('Touches differ by 0.100 mm.'), redo('G91 refused: error 9'), -40, -40, -40, -40],
    answers: [{ ac: d(1120, 2340), bd: d(1120, 2340), ab: null, dc: null, ad: null, bc: null }],
  })
  await calibrate(io)
  const tape = rec.steps.filter(st => st.title === 'Corner A: tape and plate')
  assert.equal(tape.length, 3)
  assert.equal(tape[0].error, null)
  assert.match(tape[1].error, /Touches differ by 0.100 mm\..*lifted 5 mm/)
  assert.match(tape[2].error, /^G91 refused: error 9\. The bit was lifted/)
  const a = rec.sent.indexOf('G53 G0 X53 Y53')
  assert.deepEqual(rec.sent.slice(a + 1, a + 8), ['G4 P0', 'G91', 'G0 Z5', 'G90', 'G91', 'G0 Z5', 'G90'])

  // No contact: the bit went the whole way down, so the pass ends with the probe's message, without a lift
  const miss = scripted({ probes: [new Error('No contact: is the plate under the bit and the clip attached?')], answers: [] })
  await assert.rejects(calibrate(miss.io), /^Error: No contact/)
  assert.ok(!miss.rec.sent.includes('G0 Z5'))
  assert.equal(miss.rec.steps.filter(st => st.title === 'Corner A: tape and plate').length, 1)

  // STOP: the probe ends with "Stopped" and every later send refuses, so nothing is lifted or asked again
  const stopped = new Error('Stopped')
  let stop = false
  const s2 = scripted({ probes: [], answers: [] })
  s2.io.probe = async () => { stop = true; throw stopped }
  const send = s2.io.send
  s2.io.send = async line => { if (stop) throw stopped; return send(line) } // as the dialog's send does once stopped
  await assert.rejects(calibrate(s2.io), /^Error: Stopped$/)
  assert.ok(!s2.rec.sent.includes('G0 Z5'))
  assert.equal(s2.rec.steps.filter(st => st.title === 'Corner A: tape and plate').length, 1)
})

test('the travel height never goes above the top of Z', async () => {
  const { io, rec } = scripted({
    probes: [-2, -2, -2, -2], // first touch + 10 would be Z8; the top is Z3
    answers: [{ ac: d(1120, 2340), bd: d(1120, 2340), ab: null, dc: null, ad: null, bc: null }],
  })
  await calibrate(io)
  assert.ok(rec.sent.includes('G53 G0 Z3'))
  assert.ok(!rec.sent.includes('G53 G0 Z8'))
})

test('a missing homing/positive_direction counts as true, as in FluidNC', async () => {
  const { io, rec } = scripted({
    probes: [-40, -39.5, -39.5, -40],
    answers: [{ ac: d(1120, 2340), bd: d(1120, 2340), ab: null, dc: null, ad: null, bc: null }],
    text: CONFIG.replace('      positive_direction: true\n', ''),
  })
  await calibrate(io)
  assert.equal(getValue(rec.applied, 'axes/z/motor0/pulloff_mm'), '4.268') // the same as with "true"
})

test('badEdit accepts an edit that keeps the lines, and names what is wrong otherwise', () => {
  const old = 'axes:\n\n  # a comment\n  x:\n    steps_per_mm: 50\n'
  assert.equal(badEdit(old, old.replace('50', '49.9')), null)
  assert.match(badEdit(old, old + 'extra: 1\n'), /number of lines/)
  assert.match(badEdit(old, old.replace('  # a comment', '[MSG:INFO: auto report interval set to 100]')), /line 3/)
})
