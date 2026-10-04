import { test } from 'node:test'
import assert from 'node:assert/strict'
import { homedAfter, homesPositive, unhomedNote } from './homing.js'

const after = lines => lines.reduce(homedAfter, {})

test('unhomedNote names the axes not seen homed, and is empty once they all have been', () => {
  assert.match(unhomedNote({}, 'XY'), /^X Y not seen homed/)
  assert.match(unhomedNote(after(['[MSG:Homed:Z]', '[MSG:Homed:X]']), 'XYZ'), /^Y not seen homed/)
  assert.equal(unhomedNote(after(['[MSG:Homed:Z]', '[MSG:Homed:XY]']), 'XYZ'), '')
})

test('each homing cycle marks only its own axes: Home Z alone does not unlock X and Y', () => {
  assert.deepEqual(after(['[MSG:Homed:Z]']), { Z: true })
  assert.deepEqual(after(['[MSG:Homed:Z]', '[MSG:Homed:XY]']), { Z: true, X: true, Y: true })
  assert.deepEqual(after(['[MSG:Homed:X]']), { X: true })
})

test('an alarm that loses the position forgets every axis; other lines and alarms leave them', () => {
  const all = after(['[MSG:Homed:Z]', '[MSG:Homed:XY]'])
  for (const n of [1, 3, 6, 7, 8, 9, 12, 13]) assert.deepEqual(homedAfter(all, `ALARM:${n}`), {}, `ALARM:${n}`)
  for (const line of ['ALARM:2', 'ALARM:4', "Grbl 3.9 [FluidNC v3.9.9 (wifi) '$' for help]", '[MSG:INFO: Caution: Unlocked]', 'ok']) {
    assert.equal(homedAfter(all, line), all, line)
  }
})

test('a probe miss (ALARM:5) forgets Z only: the bit may have stalled on the way down', () => {
  const all = after(['[MSG:Homed:Z]', '[MSG:Homed:XY]'])
  assert.deepEqual(homedAfter(all, 'ALARM:5'), { Z: false, X: true, Y: true })
  const xy = after(['[MSG:Homed:XY]'])
  assert.equal(homedAfter(xy, 'ALARM:5'), xy)
})

const cfg = v => `axes:\n  z:\n    homing:\n${v === undefined ? '' : `      positive_direction: ${v}\n`}      mpos_mm: 3\n`

test('homing/positive_direction: absent is true, otherwise only "true" in any case', () => {
  assert.equal(homesPositive(cfg(undefined), 'z'), true)
  assert.equal(homesPositive(cfg('true'), 'z'), true)
  assert.equal(homesPositive(cfg('True'), 'z'), true)
  assert.equal(homesPositive(cfg('false'), 'z'), false)
  assert.equal(homesPositive(cfg('yes'), 'z'), false)
})
