import { test } from 'node:test'
import assert from 'node:assert/strict'
import { skew, tilt, stepsPerMm, splitPulloff, axisRange } from './calib.js'

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`)

test('skew from the diagonals of a rectangle', () => {
  // A 1120 × 2340 rectangle whose X-max side sits 1 mm further along +Y: AC grows, BD shrinks.
  const d = (dx, dy) => Math.hypot(dx, dy)
  const ac = d(1120, 2340 + 1), bd = d(1120, 2340 - 1)
  near(skew({ ac, bd, w: 1120, h: 2340 }), 1 / 1120, 1e-5)
  assert.equal(skew({ ac: 100, bd: 100, w: 60, h: 80 }), 0)
})

test('tilt from two probe heights', () => {
  near(tilt({ zMin: -50, zMax: -49.5, xMin: 50, xMax: 1050 }), 0.0005) // X-max side is lower
  assert.equal(tilt({ zMin: -50, zMax: -50, xMin: 50, xMax: 1050 }), 0)
})

test('steps per mm scales by commanded over measured', () => {
  near(stepsPerMm(50, 1000, 1002), 50 * 1000 / 1002)
})

test('splitPulloff moves the X-max motor by half the delta and the other by the opposite half', () => {
  assert.deepEqual(splitPulloff({ p0: 4, p1: 4, delta: 0.6, motor0AtXmax: false }), [4.3, 3.7])
  assert.deepEqual(splitPulloff({ p0: 4, p1: 4, delta: 0.6, motor0AtXmax: true }), [3.7, 4.3])
  assert.deepEqual(splitPulloff({ p0: 4, p1: 4, delta: -0.6, motor0AtXmax: false }), [3.7, 4.3])
})

test('pull-offs never go below 1 mm: both are raised instead', () => {
  assert.deepEqual(splitPulloff({ p0: 1.2, p1: 1.2, delta: 1, motor0AtXmax: false }), [2, 1])
})

test('axis ranges in machine coordinates for both homing directions', () => {
  assert.deepEqual(axisRange({ maxTravel: 1220, mposMm: 3, positive: false }), { min: 3, max: 1223 })
  assert.deepEqual(axisRange({ maxTravel: 300, mposMm: 3, positive: true }), { min: -297, max: 3 })
})
