import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calibrate } from './calibration.js'
import { getValue } from './yaml-edit.js'

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

// A scripted machine and user: probes answer in order, questions get fixed answers, everything is recorded.
function scripted({ probes, answers, keep = c => true }) {
  const rec = { sent: [], steps: [], asks: [], review: null, applied: null, busy: [] }
  const settings = { plateMm: 10, tapeMm: 0.1, spanMm: 1200, marginMm: 50, yMotor0AtXmax: false, zMotor0AtXmax: false }
  const io = {
    settings,
    config: { name: 'config.yaml', text: CONFIG, range },
    send: async line => { rec.sent.push(line); return { ok: true, error: null, lines: [] } },
    probe: async () => ({ z: probes.shift() }),
    step: async s => { rec.steps.push(s.title) },
    ask: async q => { rec.asks.push(q); return answers.shift() },
    review: async r => { rec.review = r; return r.changes.filter(keep) },
    apply: async text => { rec.applied = text },
    busy: t => rec.busy.push(t),
  }
  return { io, rec, settings }
}

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
  assert.deepEqual(rec.sent.slice(a + 1, a + 9), ['G4 P0', 'M5', 'G91', 'G0 Z2', 'G90', 'G53 G1 Z-50.1 F100', 'G53 G0 Z-30', 'G4 P0'])
  assert.ok(rec.sent.includes('G53 G1 Z-49.6 F100')) // corner B's dot, 0.5 mm higher

  // The numbers
  assert.ok(Math.abs(summary.tiltMm - 0.5357) < 0.001, `tilt ${summary.tiltMm}`)
  assert.ok(Math.abs(summary.skewMm - 1.0714) < 0.001, `skew ${summary.skewMm}`)
  const paths = rec.review.changes.map(c => c.path)
  assert.deepEqual(paths, ['axes/z/motor0/pulloff_mm', 'axes/z/motor1/pulloff_mm', 'axes/y/motor0/pulloff_mm', 'axes/y/motor1/pulloff_mm', 'axes/x/steps_per_mm'])
  const applied = rec.applied
  assert.equal(getValue(applied, 'axes/z/motor0/pulloff_mm'), '4.268')
  assert.equal(getValue(applied, 'axes/z/motor1/pulloff_mm'), '3.732')
  assert.equal(getValue(applied, 'axes/y/motor0/pulloff_mm'), '4.536')
  assert.equal(getValue(applied, 'axes/y/motor1/pulloff_mm'), '3.464')
  assert.equal(getValue(applied, 'axes/x/steps_per_mm'), '49.955')
  assert.equal(getValue(applied, 'axes/y/steps_per_mm'), '50.000') // sides matched: untouched
  assert.equal(io.settings.lastSkewMm.toFixed(3), '1.071')
})

test('unticked changes are not applied, and skipped side measurements leave steps/mm alone', async () => {
  const { io, rec } = scripted({
    probes: [-40, -40, -40, -40],
    answers: [{ ac: d(1120, 2341), bd: d(1120, 2339), ab: null, dc: null, ad: null, bc: null }],
    keep: c => c.path.startsWith('axes/y/motor'),
  })
  await calibrate(io)
  assert.deepEqual(rec.review.changes.map(c => c.path), ['axes/y/motor0/pulloff_mm', 'axes/y/motor1/pulloff_mm'])
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
  const { io, rec } = scripted({ probes: [-40, -40, -40, -40], answers: [{ ac: 100, bd: 100, ab: null, dc: null, ad: null, bc: null }] })
  io.review = async () => null
  const summary = await calibrate(io)
  assert.equal(summary.applied, false)
  assert.equal(rec.applied, null)
})

test('a refused command aborts with its message', async () => {
  const { io } = scripted({ probes: [], answers: [] })
  io.send = async line => ({ ok: line !== '$H', error: 'reset', lines: [] })
  await assert.rejects(calibrate(io), /\$H failed: reset/)
})
