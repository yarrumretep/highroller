import { test } from 'node:test'
import assert from 'node:assert/strict'
import { currentSegment, along, progress } from './track.js'

// 10 segments of 10 mm along X, one per 10-byte line, 1 s each
const line10 = {
  pts: Float32Array.from({ length: 33 }, (_, k) => (k % 3 === 0 ? (k / 3) * 10 : 0)),
  rapid: new Uint8Array(10),
  offset: Uint32Array.from({ length: 10 }, (_, i) => i * 10),
  time: Float64Array.from({ length: 10 }, (_, i) => i + 1),
  bytes: 100,
}

test('finds the segment under the tool, behind the read position', () => {
  assert.equal(currentSegment(line10, 50, [25, 0, 0]), 2)
})

test('never goes backwards', () => {
  assert.equal(currentSegment(line10, 50, [25, 0, 0], 3), 3)
})

test('before any motion line has been read there is no current segment', () => {
  const job = { ...line10, offset: Uint32Array.from({ length: 10 }, (_, i) => 20 + i * 8) }
  assert.equal(currentSegment(job, 10, [0, 0, 0]), -1)
})

test('along: how far the tool is through the current segment', () => {
  assert.equal(along(line10, 2, [25, 0, 0]), 0.5)
  assert.equal(along(line10, 2, [19, 0, 0]), 0)
  assert.equal(along(line10, -1, [0, 0, 0]), 0)
})

test('progress by time, within the current segment', () => {
  const p = progress(line10, 2, 0.5, 0, null) // halfway along segment 2 (which ends at 3 s): 2.5 s of 10
  assert.equal(p.fraction, 0.25)
  assert.equal(p.left, 7.5)
  assert.equal(p.learning, true)
})

test('before any motion there is no progress and the raw estimate is the time left', () => {
  const p = progress(line10, -1, 0, 0, null)
  assert.deepEqual([p.fraction, p.left], [0, 10])
})

test('once enough has run, the time left follows the real speed, smoothed', () => {
  const long = { ...line10, time: Float64Array.from([40, 80]) } // two segments of 40 s
  let p = progress(long, 0, 1, 80, null) // 40 s estimated took 80 s: twice as slow
  assert.equal(p.ratio, 2)
  assert.equal(p.left, 80)
  assert.equal(p.learning, false)
  p = progress(long, 0, 1, 40, p.ratio) // a reading of 1.0 moves the smoothed ratio a tenth of the way
  assert.ok(Math.abs(p.ratio - 1.9) < 1e-9)
  assert.ok(Math.abs(p.left - 76) < 1e-9)
})

test('a path that revisits a point resolves to the earliest visit not yet passed', () => {
  // out 0→10, back 10→0, out again 0→10: one line each
  const job = {
    pts: Float32Array.from([0, 0, 0, 10, 0, 0, 0, 0, 0, 10, 0, 0]),
    rapid: new Uint8Array(3),
    offset: Uint32Array.from([0, 10, 20]),
    time: Float64Array.from([1, 2, 3]),
    bytes: 30,
  }
  assert.equal(currentSegment(job, 100, [5, 0, 0]), 0)
  assert.equal(currentSegment(job, 100, [5, 0, 0], 1), 1)
  assert.equal(currentSegment(job, 100, [5, 0, 0], 2), 2)
})

test('the tool is never placed more than the planner depth behind the read position', () => {
  const n = 100 // one-line segments of 10 mm along X; FluidNC has read line 90 but the tool reads as x=5
  const job = {
    pts: Float32Array.from({ length: (n + 1) * 3 }, (_, k) => (k % 3 === 0 ? (k / 3) * 10 : 0)),
    rapid: new Uint8Array(n),
    offset: Uint32Array.from({ length: n }, (_, i) => i * 10),
    time: Float64Array.from({ length: n }, (_, i) => i + 1),
    bytes: n * 10,
  }
  assert.ok(currentSegment(job, 90, [5, 0, 0]) >= 89 - 63)
})
