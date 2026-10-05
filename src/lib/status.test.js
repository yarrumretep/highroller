import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseStatus, EMPTY, wifiPercent, fwVersion } from './status.js'

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
  assert.equal(EMPTY.mpos, null)
})

test('a file FluidNC has finished reading reports 100 %', () => {
  const s = parseStatus('<Run|MPos:0,0,0|FS:0,0|SD: /sd/job.nc: Sent>')
  assert.deepEqual(s.sd, { percent: 100, file: '/sd/job.nc' })
})

test('a comma in the file name stays part of the name', () => {
  assert.deepEqual(parseStatus('<Run|MPos:0,0,0|FS:0,0|SD:12.50,/sd/a,b.nc>').sd, { percent: 12.5, file: '/sd/a,b.nc' })
  assert.deepEqual(parseStatus('<Run|MPos:0,0,0|FS:0,0|SD: /sd/a,b.nc: Sent>').sd, { percent: 100, file: '/sd/a,b.nc' })
})

test('before any WCO the work position is unknown, and only the reported position is known', () => {
  assert.equal(parseStatus('<Idle|FS:0,0>').mpos, null) // no position field at all yet: unknown, not a stale zero
  const a = parseStatus('<Idle|MPos:1,2,3|FS:0,0>')
  assert.equal(a.wco, null)
  assert.equal(a.wpos, null)
  assert.deepEqual(a.mpos, [1, 2, 3])
  const b = parseStatus('<Idle|WPos:4,5,6|FS:0,0>')
  assert.deepEqual(b.wpos, [4, 5, 6])
  assert.equal(b.mpos, null)
  const c = parseStatus('<Idle|MPos:1,2,3|FS:0,0|WCO:1,1,1>', a)
  assert.deepEqual(c.wpos, [0, 1, 2])
  assert.deepEqual(parseStatus('<Idle|MPos:2,2,2|FS:0,0>', c).wpos, [1, 1, 1]) // known from then on
})

test('overrides are unknown until a report carries Ov', () => {
  const a = parseStatus('<Run|MPos:0,0,0|FS:0,0>')
  assert.equal(a.ov, null)
  const b = parseStatus('<Run|MPos:0,0,0|FS:0,0|Ov:110,100,100|A:S>', a)
  assert.deepEqual(b.ov, [110, 100, 100])
  assert.equal(b.acc, 'S')
  assert.deepEqual(parseStatus('<Run|MPos:0,0,0|FS:0,0>', b).ov, [110, 100, 100])
})

test('wifiPercent reads the Signal entry of the JSON stats, split across [MSG:JSON:…] chunks', () => {
  const json = '{"cmd":"420","status":"ok","data":[{"id":"Chip ID","value":"36942"},{"id":"Signal","value":"78%"},{"id":"FW version","value":"FluidNC v3.9.9"}]}'
  const chunks = [`[MSG:JSON:${json.slice(0, 70)}]`, `[MSG:JSON:${json.slice(70)}]`] // the cut lands inside the Signal entry
  assert.equal(wifiPercent(chunks), 78)
  assert.equal(wifiPercent([json.slice(0, 70), json.slice(70)]), 78) // the websocket channel sends the chunks bare
  assert.equal(wifiPercent(['[MSG:JSON:{"cmd":"420","status":"ok","data":[{"id":"Current WiFi Mode","value":"AP"}]}]']), null)
  // the plain 3.9.9 output has no signal; an older plain "Signal:" line still reads
  assert.equal(wifiPercent(['Chip ID: 36942', '[MSG:Mode=STA:SSID=shop:Status=Connected:IP=1.2.3.4:MAC=00]', 'FW version: FluidNC v3.9.9']), null)
  assert.equal(wifiPercent(['Current WiFi Mode: STA', 'Signal: 78%']), 78)
})

test('fwVersion reads the FW version entry of the JSON stats, or a plain line, and is null without one', () => {
  const json = '{"cmd":"420","status":"ok","data":[{"id":"Chip ID","value":"36942"},{"id":"FW version","value":"FluidNC v3.9.9 (main-abc1234)"},{"id":"Signal","value":"78%"}]}'
  assert.equal(fwVersion([json.slice(0, 60), json.slice(60)]), 'FluidNC v3.9.9 (main-abc1234)')
  assert.equal(fwVersion([`[MSG:JSON:${json.slice(0, 90)}]`, `[MSG:JSON:${json.slice(90)}]`]), 'FluidNC v3.9.9 (main-abc1234)')
  assert.equal(fwVersion(['Chip ID: 36942', 'FW version: FluidNC v3.9.9']), 'FluidNC v3.9.9')
  assert.equal(fwVersion(['Chip ID: 36942']), null)
})
