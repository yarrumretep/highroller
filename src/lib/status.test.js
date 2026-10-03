import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseStatus, EMPTY } from './status.js'

test('parses state, machine position, work offset and work position', () => {
  const s = parseStatus('<Idle|MPos:10.000,20.000,-5.000|FS:0,0|WCO:1.000,2.000,-3.000>')
  assert.equal(s.state, 'Idle')
  assert.equal(s.sub, null)
  assert.deepEqual(s.mpos, [10, 20, -5])
  assert.deepEqual(s.wco, [1, 2, -3])
  assert.deepEqual(s.wpos, [9, 18, -2])
})

test('carries WCO, overrides and accessories over from the previous report', () => {
  const a = parseStatus('<Run|MPos:0,0,0|FS:500,1000|WCO:1,1,1|Ov:120,100,90|A:SF>')
  const b = parseStatus('<Run|MPos:5,5,5|FS:500,1000>', a)
  assert.deepEqual(b.wco, [1, 1, 1])
  assert.deepEqual(b.wpos, [4, 4, 4])
  assert.deepEqual(b.ov, [120, 100, 90])
  assert.equal(b.acc, 'SF')
  assert.equal(b.feed, 500)
  assert.equal(b.spindle, 1000)
})

test('Ov without A means spindle and coolant are off', () => {
  const a = parseStatus('<Run|MPos:0,0,0|FS:0,0|Ov:100,100,100|A:S>')
  const b = parseStatus('<Idle|MPos:0,0,0|FS:0,0|Ov:100,100,100>', a)
  assert.equal(b.acc, '')
})

test('WPos reports derive machine position from WCO', () => {
  const s = parseStatus('<Idle|WPos:4,4,4|FS:0,0|WCO:1,2,3>')
  assert.deepEqual(s.wpos, [4, 4, 4])
  assert.deepEqual(s.mpos, [5, 6, 7])
})

test('splits Hold:0 into state and sub-state', () => {
  const s = parseStatus('<Hold:0|MPos:0,0,0|FS:0,0>')
  assert.equal(s.state, 'Hold')
  assert.equal(s.sub, 0)
})

test('pins and SD progress do not carry over', () => {
  const a = parseStatus('<Run|MPos:0,0,0|FS:0,0|Pn:P|SD:12.50,/sd/job.nc>')
  assert.equal(a.pins, 'P')
  assert.deepEqual(a.sd, { percent: 12.5, file: '/sd/job.nc' })
  const b = parseStatus('<Idle|MPos:0,0,0|FS:0,0>', a)
  assert.equal(b.pins, '')
  assert.equal(b.sd, null)
})

test('does not mutate the previous status', () => {
  const a = parseStatus('<Idle|MPos:1,1,1|FS:0,0|WCO:0,0,0>')
  parseStatus('<Run|MPos:2,2,2|FS:0,0|WCO:1,1,1>', a)
  assert.deepEqual(a.mpos, [1, 1, 1])
  assert.deepEqual(a.wco, [0, 0, 0])
  assert.equal(EMPTY.state, 'Unknown')
})

test('a file FluidNC has finished reading reports 100 %', () => {
  const s = parseStatus('<Run|MPos:0,0,0|FS:0,0|SD: /sd/job.nc: Sent>')
  assert.deepEqual(s.sd, { percent: 100, file: '/sd/job.nc' })
})
