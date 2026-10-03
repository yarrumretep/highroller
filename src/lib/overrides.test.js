import { test } from 'node:test'
import assert from 'node:assert/strict'
import { overrideBytes, RAPID } from './overrides.js'

test('steps by tens, then ones', () => {
  assert.deepEqual(overrideBytes('feed', 100, 123), [0x91, 0x91, 0x93, 0x93, 0x93])
  assert.deepEqual(overrideBytes('spindle', 150, 42), [...Array(10).fill(0x9b), ...Array(8).fill(0x9d)])
})

test('going back to 100 % is one reset byte', () => {
  assert.deepEqual(overrideBytes('feed', 137, 100), [0x90])
  assert.deepEqual(overrideBytes('spindle', 80, 100), [0x99])
})

test('no change sends nothing', () => {
  assert.deepEqual(overrideBytes('feed', 100, 100), [])
})

test('targets are clamped to 10–200 %', () => {
  assert.deepEqual(overrideBytes('feed', 190, 250), [0x91])
  assert.deepEqual(overrideBytes('feed', 12, 0), [0x94, 0x94])
})

test('rapid override has three fixed levels', () => {
  assert.deepEqual(RAPID, { 25: 0x97, 50: 0x96, 100: 0x95 })
})
