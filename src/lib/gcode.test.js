import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseGcode } from './gcode.js'

const xyz = (job, i) => [...job.pts.slice(i * 3, i * 3 + 3)].map(v => Math.round(v * 1000) / 1000)

test('straight moves become segments tagged rapid or cut, with the byte offset of their line', () => {
  const job = parseGcode('G21 G90\nG0 X10 Y0\nG1 X10 Y10 F600\n')
  assert.equal(job.rapid.length, 2)
  assert.deepEqual(xyz(job, 1), [10, 0, 0])
  assert.deepEqual(xyz(job, 2), [10, 10, 0])
  assert.deepEqual([...job.rapid], [1, 0])
  assert.deepEqual([...job.offset], [8, 18])
  assert.equal(job.bytes, 34)
})

test('G91 moves are relative and G20 means inches', () => {
  const job = parseGcode('G20 G91\nG1 X1 F10\nG1 Y1\n')
  assert.deepEqual(xyz(job, 1), [25.4, 0, 0])
  assert.deepEqual(xyz(job, 2), [25.4, 25.4, 0])
})

test('comments are ignored', () => {
  const job = parseGcode('G1 X5 F100 (move X99) ; Y99\n(X77)\n')
  assert.equal(job.rapid.length, 1)
  assert.deepEqual(xyz(job, 1), [5, 0, 0])
})

test('lines that set offsets or move in machine coordinates are skipped', () => {
  const job = parseGcode('G10 L20 P1 X0\nG92 X0\nG53 G0 Z-5\nG28 X0\nG1 X1 F100\n')
  assert.equal(job.rapid.length, 1)
})

test('a G3 arc by I/J becomes chords on the circle, ending exactly on the target', () => {
  const job = parseGcode('G1 X10 Y0 F100\nG3 X0 Y10 I-10 J0\n')
  const n = job.rapid.length - 1
  assert.equal(n, 32) // a quarter circle of radius 10 in 0.5 mm chords
  for (let i = 2; i <= n + 1; i++) assert.ok(Math.abs(Math.hypot(job.pts[i * 3], job.pts[i * 3 + 1]) - 10) < 1e-3)
  assert.deepEqual(xyz(job, n + 1), [0, 10, 0])
})

test('a G2 arc by R curves clockwise', () => {
  const job = parseGcode('G2 X10 Y0 R5 F100\n')
  let maxY = -Infinity
  for (let i = 1; i < job.pts.length / 3; i++) maxY = Math.max(maxY, job.pts[i * 3 + 1])
  assert.ok(Math.abs(maxY - 5) < 0.01)
  assert.deepEqual(xyz(job, job.rapid.length), [10, 0, 0])
})

test('time estimates use the feed for cuts and the axis max rate for rapids', () => {
  const job = parseGcode('G1 X60 F600\nG0 Z-9\n', { X: 9000, Y: 9000, Z: 900 })
  assert.ok(Math.abs(job.time[0] - 6) < 1e-9) // 60 mm at 600 mm/min
  assert.ok(Math.abs(job.time[1] - 6.6) < 1e-9) // plus 9 mm of Z at 900 mm/min
})

test('bounds cover the moves but not the origin start point', () => {
  const job = parseGcode('G0 X5 Y5\nG1 X-5 Y20 F100\n')
  assert.deepEqual(job.bounds, { minX: -5, minY: 5, maxX: 5, maxY: 20 })
})

test('a full circle given by I/J with no end point is drawn', () => {
  const job = parseGcode('G1 X10 Y0 F100\nG3 I-10 J0\n')
  const n = job.rapid.length - 1
  assert.ok(n >= 120, `chords=${n}`) // 2π·10 mm in 0.5 mm chords
  assert.deepEqual(xyz(job, n + 1), [10, 0, 0])
  for (let i = 2; i <= n + 1; i++) assert.ok(Math.abs(Math.hypot(job.pts[i * 3], job.pts[i * 3 + 1]) - 10) < 1e-3)
})

test('arcs outside the XY plane are drawn as straight lines', () => {
  const job = parseGcode('G18 G2 X10 Z-5 I5 K0 F100\n')
  assert.equal(job.rapid.length, 1)
  assert.deepEqual(xyz(job, 1), [10, 0, -5])
})
