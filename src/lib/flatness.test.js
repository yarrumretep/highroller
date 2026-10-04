import { test } from 'node:test'
import assert from 'node:assert/strict'
import { flatnessReport } from './flatness.js'

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`)

test('a perfectly flat table: flat verdict, no tilt, no depth', () => {
  const points = [{ x: 0, y: 0, z: -50 }, { x: 100, y: 0, z: -50 }, { x: 100, y: 50, z: -50 }, { x: 0, y: 50, z: -50 }]
  const r = flatnessReport(points)
  near(r.plane.a, 0); near(r.plane.b, 0); near(r.plane.c, -50)
  near(r.tiltX, 0); near(r.tiltY, 0)
  near(r.pv, 0); near(r.residualPv, 0); near(r.residualRms, 0)
  assert.equal(r.verdict, 'flat')
  assert.equal(r.depth, 0)
})

test('a tilted plane: tiltX/tiltY read off the plane, residual near zero', () => {
  const a = 0.001, b = 0.0005, c = -50
  const points = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 50 }, { x: 100, y: 50 }]
    .map(p => ({ ...p, z: a * p.x + b * p.y + c }))
  const r = flatnessReport(points)
  near(r.tiltX, 0.1)
  near(r.tiltY, 0.025)
  near(r.residualPv, 0, 1e-6)
  near(r.residualRms, 0, 1e-6)
})

test('one low corner: peak-to-valley, surface verdict, depth rounded up to 0.05, one zero rel', () => {
  const points = [{ x: 0, y: 0, z: -50.00 }, { x: 100, y: 0, z: -50.05 }, { x: 100, y: 50, z: -50.03 }, { x: 0, y: 50, z: -50.22 }]
  const r = flatnessReport(points)
  near(r.pv, 0.22)
  assert.equal(r.verdict, 'surface')
  assert.equal(r.depth, 0.35) // pv + 0.1 = 0.32, rounded up to the next 0.05
  assert.deepEqual(r.highest, { x: 0, y: 0, z: -50.00 })
  assert.deepEqual(r.heights.map(h => h.x), points.map(p => p.x)) // same order as the input
  assert.ok(r.heights.every(h => h.rel <= 0))
  assert.equal(r.heights.filter(h => h.rel === 0).length, 1)
})

test('collinear points fall back to a horizontal plane through the mean', () => {
  const points = [{ x: 0, y: 0, z: -50 }, { x: 0, y: 10, z: -50.1 }, { x: 0, y: 20, z: -49.9 }]
  const r = flatnessReport(points)
  near(r.plane.a, 0); near(r.plane.b, 0); near(r.plane.c, -50)
  near(r.tiltX, 0); near(r.tiltY, 0)
})
