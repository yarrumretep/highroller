import { test } from 'node:test'
import assert from 'node:assert/strict'
import { surfacingGcode, surfacingName } from './surfacing.js'

test('a zero or negative stepover, depth, depth per pass or area is refused, not looped on', () => {
  const ok = { xMin: 0, xMax: 100, yMin: 0, yMax: 50, diameter: 25.4, stepoverPct: 40, depth: 0.5, depthPerPass: 0.5 }
  for (const bad of [{ stepoverPct: 0 }, { stepoverPct: -5 }, { diameter: 0 }, { depthPerPass: 0 }, { depth: 0 }, { xMax: 0 }, { yMax: -1 }]) {
    assert.throws(() => surfacingGcode({ ...ok, ...bad }), /positive/, JSON.stringify(bad))
  }
})

test('an origin is written into the file right after the header, and left out otherwise', () => {
  const ok = { xMin: 0, xMax: 100, yMin: 0, yMax: 50, diameter: 25.4, stepoverPct: 40, depth: 0.5, depthPerPass: 0.5 }
  const lines = surfacingGcode({ ...ok, origin: { x: 16.7, y: 16.7 } }).split('\n')
  assert.equal(lines[0], 'G21 G90 G94 G54')
  assert.equal(lines[1], 'G10 L2 P1 X16.7 Y16.7')
  assert.ok(!surfacingGcode(ok).includes('G10'))
})

test('rows raster across the area, capped at the far edge', () => {
  const text = surfacingGcode({ xMin: 0, xMax: 100, yMin: 0, yMax: 50, diameter: 25.4, stepoverPct: 40, depth: 0.5, depthPerPass: 0.5 })
  const ys = [0, ...[...text.matchAll(/^G1 Y(-?[\d.]+)/gm)].map(m => Number(m[1]))]
  assert.deepEqual(ys, [0, 10.16, 20.32, 30.48, 40.64, 50])
})

test('depth passes step down in equal increments, the last exactly at the full depth', () => {
  const text = surfacingGcode({ xMin: 0, xMax: 100, yMin: 0, yMax: 50, depth: 1.2, depthPerPass: 0.5 })
  const zs = [...text.matchAll(/Z(-?[\d.]+)/g)].map(m => Number(m[1]))
  const cutDepths = [...new Set(zs.filter(z => z < 0))]
  assert.deepEqual(cutDepths, [-0.5, -1, -1.2])
  assert.ok(zs.every(z => z >= -1.2 - 1e-9))
})

test('M0 holds the job before any cutting move', () => {
  const text = surfacingGcode({ xMin: 0, xMax: 10, yMin: 0, yMax: 10, depth: 0.5, depthPerPass: 0.5 })
  const lines = text.split('\n')
  const m0 = lines.indexOf('M0')
  assert.equal(lines.filter(l => l === 'M0').length, 1)
  assert.ok(m0 >= 0)
  assert.ok(lines.slice(0, m0).every(l => !l.startsWith('G1')))
})

test('the file ends raised clear of the work', () => {
  const text = surfacingGcode({ xMin: 0, xMax: 10, yMin: 0, yMax: 10, depth: 0.5, depthPerPass: 0.5, safeZ: 7 })
  const lines = text.trim().split('\n')
  assert.equal(lines.at(-2), 'G0 Z7')
  assert.equal(lines.at(-1), 'G0 X-12.7 Y0')
})

test('the raster clears the cutter radius past both X edges', () => {
  const text = surfacingGcode({ xMin: 0, xMax: 100, yMin: 0, yMax: 10, depth: 0.5, depthPerPass: 0.5 })
  const xs = [...text.matchAll(/X(-?[\d.]+)/g)].map(m => Number(m[1]))
  assert.equal(Math.min(...xs), -12.7)
  assert.equal(Math.max(...xs), 112.7)
})

test('surfacingName builds a descriptive filename', () => {
  assert.equal(surfacingName({ xMin: 0, xMax: 100, yMin: 0, yMax: 50, depth: 1.2 }), 'surface-100x50-1.2mm.gcode')
})
