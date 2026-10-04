import { test } from 'node:test'
import assert from 'node:assert/strict'
import { flatnessProbe, resultLines } from './flatnessProbe.js'
import { flatnessReport } from './flatness.js'
import { probeLines } from './probe.js'

const range = { X: { min: 3, max: 1223 }, Y: { min: 3, max: 2443 }, Z: { min: -297, max: 3 } }
const CONFIG = 'axes:\n  x:\n    steps_per_mm: 50.000\n'
const LIFT = ['G91', 'G0 Z5', 'G90']

// A scripted machine and user, as in calibration.test.js: probes answer in order (an Error is thrown), the grid
// question gets fixed answers, everything is recorded. The probe touches where the last XY move went.
// Each step remembers how many lines had been sent when it was shown, so its preview can be checked against what followed.
function scripted({ probes, answers = [{ cols: 2, rows: 2 }] }) {
  const rec = { sent: [], steps: [], asks: [], busy: [], order: [] }
  const settings = { plateMm: 0.5, marginMm: 50 }
  const io = {
    settings,
    readConfig: async () => { rec.order.push('readConfig'); return { name: 'config.yaml', text: CONFIG, range } },
    send: async line => { rec.sent.push(line); return { ok: true, error: null, lines: [] } },
    probe: async () => {
      const z = probes.shift()
      if (z instanceof Error) throw z
      const [, x, y] = /X(\S+) Y(\S+)/.exec(rec.sent.filter(l => l.startsWith('G53 G0 X')).at(-1))
      return { x: Number(x), y: Number(y), z }
    },
    step: async s => { rec.order.push(s.title); rec.steps.push({ ...s, at: rec.sent.length }) },
    ask: async q => { rec.order.push(q.title); rec.asks.push(q); return answers.shift() },
    busy: t => rec.busy.push(t),
  }
  return { io, rec, settings }
}

const moves = rec => rec.sent.filter(l => l.startsWith('G53 G0 X'))
const xy = pts => pts.map(([x, y]) => `G53 G0 X${x} Y${y}`)

test('a 2 × 2 grid: home, then four points in serpentine order, each probed and lifted, then up to the top', async () => {
  const { io, rec } = scripted({ probes: [-40, -40.2, -39.9, -40.1] })
  const summary = await flatnessProbe(io)
  assert.equal(rec.sent[0], '$H')
  assert.deepEqual(moves(rec), xy([[53, 53], [1173, 53], [1173, 2393], [53, 2393]]))
  assert.equal(rec.sent.filter(l => l === 'G0 Z5').length, 4) // one lift per probe
  assert.equal(rec.sent.at(-1), 'G53 G0 Z3') // the top of Z
  assert.deepEqual(rec.order.slice(0, 3), ['readConfig', 'Flatness map: the grid', 'Before you start'])

  // The report is computed from the probed points in grid order (row by row from Y-min, X ascending), not the visiting order
  const grid = [[53, 53, -40], [1173, 53, -40.2], [53, 2393, -40.1], [1173, 2393, -39.9]].map(([x, y, z]) => ({ x, y, z }))
  assert.equal(summary.kind, 'flatness')
  assert.deepEqual(summary.report, flatnessReport(grid, { threshold: 0.15 }))
  assert.deepEqual(summary.grid, { cols: 2, rows: 2 })
  assert.deepEqual(summary.area, { xMin: 53, xMax: 1173, yMin: 53, yMax: 2393 })
  // Work X0 Y0 at the area's corner; Z0 on the table at the highest point, one plate thickness below the touch
  assert.equal(summary.zeroLine, 'G10 L2 P1 X53 Y53 Z-40.4')
  // The config it ran with: a later calibration that changes it makes the map stale
  assert.equal(summary.configText, CONFIG)
})

test('a 3 × 3 grid snakes row by row: X ascending, then descending, then ascending', async () => {
  const { io, rec } = scripted({ probes: Array(9).fill(-40), answers: [{ cols: 3, rows: 3 }] })
  const summary = await flatnessProbe(io)
  assert.deepEqual(moves(rec), xy([[53, 53], [613, 53], [1173, 53], [1173, 1223], [613, 1223], [53, 1223], [53, 2393], [613, 2393], [1173, 2393]]))
  assert.deepEqual(summary.report.heights.map(h => [h.x, h.y]), [[53, 53], [613, 53], [1173, 53], [53, 1223], [613, 1223], [1173, 1223], [53, 2393], [613, 2393], [1173, 2393]])
})

test('every move is shown before it runs; the first point is set with Z only; the plate is off before each move', async () => {
  const { io, rec } = scripted({ probes: [-40, -40, -40, -40] })
  await flatnessProbe(io)
  const before = rec.steps.find(s => s.title === 'Before you start')
  assert.deepEqual(before.lines, ['$H', 'G53 G0 Z3', 'G53 G0 X53 Y53', 'G4 P0'])
  for (const s of rec.steps.filter(s => s.lines && !s.arm)) assert.deepEqual(rec.sent.slice(s.at, s.at + s.lines.length), s.lines, s.title)

  // Probe goes on to run the probe (sent by io.probe), then the lift
  const arms = rec.steps.filter(s => s.arm)
  assert.equal(arms.length, 4)
  for (const s of arms) {
    assert.deepEqual(s.lines, [...probeLines(), ...LIFT])
    assert.deepEqual(rec.sent.slice(s.at, s.at + 3), LIFT)
  }

  // The height step: once, at the first point, after the move there and before its probe; Z only, and it moves nothing itself
  const height = rec.steps.filter(s => s.jog)
  assert.equal(height.length, 1)
  assert.equal(height[0].jog, 'z')
  assert.equal(height[0].lines, undefined)
  assert.equal(rec.sent[height[0].at - 2], 'G53 G0 X53 Y53')
  assert.ok(rec.steps.indexOf(height[0]) < rec.steps.indexOf(arms[0]))

  // After each probe: wait for the plate to come off, showing the move to the next point (after the last: the rapid up)
  const off = rec.steps.filter(s => s.plateOff)
  assert.equal(off.length, 4)
  assert.deepEqual(off[0].lines, ['G53 G0 Z-30', 'G53 G0 X1173 Y53', 'G4 P0']) // the first touch + 10
  assert.deepEqual(off.at(-1).lines, ['G53 G0 Z3'])
  assert.equal(off.at(-1).at + 1, rec.sent.length) // and nothing after it
})

test('the travel height is the first touch + 10, never above the top of Z', async () => {
  const { io, rec } = scripted({ probes: [-2, -2, -2, -2] }) // first touch + 10 would be Z8; the top is Z3
  await flatnessProbe(io)
  assert.ok(!rec.sent.includes('G53 G0 Z8'))
  assert.deepEqual(rec.steps.find(s => s.plateOff).lines, ['G53 G0 Z3', 'G53 G0 X1173 Y53', 'G4 P0'])
})

const redo = message => Object.assign(new Error(message), { retry: true })

test('a probe that can be redone lifts 5 mm and repeats that point; a miss ends the run', async () => {
  const { io, rec } = scripted({ probes: [-40, redo('Touches differ by 0.100 mm.'), -40, -40, -40] })
  await flatnessProbe(io)
  const second = rec.steps.filter(s => s.title === 'Point 2 of 4: plate and clip')
  assert.equal(second.length, 2)
  assert.equal(second[0].error, null)
  assert.match(second[1].error, /^Touches differ by 0.100 mm\. The bit was lifted 5 mm; probe this point again\.$/)
  assert.equal(rec.sent.filter(l => l === 'G0 Z5').length, 5) // the redo's lift, and one after each good probe

  // No contact: the bit went the whole way down. The run ends with the probe's message: no lift, no further move.
  const miss = scripted({ probes: [-40, new Error('No contact: is the plate under the bit and the clip attached?')] })
  await assert.rejects(flatnessProbe(miss.io), /^Error: No contact/)
  assert.deepEqual(moves(miss.rec), xy([[53, 53], [1173, 53]]))
  assert.equal(miss.rec.sent.filter(l => l === 'G0 Z5').length, 1)
  assert.equal(miss.rec.sent.at(-1), 'G4 P0') // the arrival at point 2, then nothing
  assert.ok(!miss.rec.steps.some(s => s.title === 'Point 2 of 4: pick up the plate'))
})

test('the grid is asked with two fields, 3 × 3 by default, and asked again until both are whole numbers from 2 to 5', async () => {
  const { io, rec } = scripted({ probes: Array(6).fill(-40), answers: [{ cols: 6, rows: 3 }, { cols: 3, rows: 2.5 }, { cols: 3, rows: 2 }] })
  await flatnessProbe(io)
  assert.equal(rec.asks.length, 3)
  assert.deepEqual(rec.asks[0].fields.map(f => f.name), ['cols', 'rows'])
  assert.deepEqual(rec.asks[0].values, { cols: 3, rows: 3 })
  assert.equal(rec.asks[0].error, null)
  assert.match(rec.asks[1].error, /2 to 5/)
  assert.deepEqual(rec.asks[1].values, { cols: 6, rows: 3 }) // what was typed stays filled in
  assert.match(rec.asks[2].error, /2 to 5/)
  assert.equal(moves(rec).length, 6)
})

test('a refused command aborts with its message, and a config without travel stops before anything moves', async () => {
  const { io } = scripted({ probes: [] })
  io.send = async line => ({ ok: line !== '$H', error: 'reset', lines: [] })
  await assert.rejects(flatnessProbe(io), /\$H failed: reset/)

  const bare = scripted({ probes: [] })
  bare.io.readConfig = async () => ({ name: 'config.yaml', text: '', range: null })
  await assert.rejects(flatnessProbe(bare.io), /no axis travel/)
  assert.deepEqual(bare.rec.sent, [])

  // A margin of half the Y travel or more leaves nothing to probe: said before the grid is asked
  const wide = scripted({ probes: [] })
  wide.settings.marginMm = 1220
  await assert.rejects(flatnessProbe(wide.io), /^Error: The margin leaves no area to probe: lower it$/)
  assert.equal(wide.rec.asks.length, 0)
  assert.deepEqual(wide.rec.sent, [])
})

test('resultLines: the tilt per side, the peak to valley before and after the tilt, and the verdict', () => {
  const r = { tiltX: -0.234, tiltY: 0.1, pv: 0.456, residualPv: 0.12, verdict: 'surface', depth: 0.6 }
  assert.deepEqual(resultLines(r), {
    tilt: 'Tilt: X-max side 0.23 mm lower, Y-max side 0.10 mm higher',
    flatness: 'Peak to valley 0.46 mm, 0.12 mm after removing the tilt',
    verdict: 'Surface it: cut 0.60 mm from the highest point',
  })
  const flat = resultLines({ tiltX: 0, tiltY: -0.001, pv: 0.05, residualPv: 0.01, verdict: 'flat', depth: 0 })
  assert.equal(flat.tilt, 'Tilt: X-max side level, Y-max side level')
  assert.equal(flat.verdict, 'Flat enough')
})
