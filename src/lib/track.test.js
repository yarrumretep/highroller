import { test } from 'node:test'
import assert from 'node:assert/strict'
import { currentSegment, remaining } from './track.js'

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

test('remaining time is the raw estimate early on, then scaled by real progress', () => {
  assert.equal(remaining(line10, -1, 0), 10)
  assert.equal(remaining(line10, 4, 99), 5) // only 5 s estimated done: trust the estimate
  const long = { ...line10, time: Float64Array.from([40, 80]) }
  assert.equal(remaining(long, 0, 80), 80) // running at half the estimated speed
})
