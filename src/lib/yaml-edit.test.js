import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getValue, setValue } from './yaml-edit.js'

// A slice of the stock LowRider config, including its odd indented comment line.
const CONFIG = `board: Jackpot TMC2209
name: LowRider

axes:
  shared_stepper_disable_pin: NO_PIN

  y:
    steps_per_mm: 50.000
    max_rate_mm_per_min: 9000.000
    homing:
      cycle: 2
      positive_direction: false
    motor0:
      limit_neg_pin: gpio.33:high
      pulloff_mm: 4.000
     #B
    motor1:
      limit_neg_pin: gpio.35:high
      pulloff_mm: 4.000 # right side

  z:
    steps_per_mm: 200.000
    motor0:
      pulloff_mm: 4.000
probe:
  pin: gpio.36:low
`

test('reads scalars by path, without trailing comments', () => {
  assert.equal(getValue(CONFIG, 'name'), 'LowRider')
  assert.equal(getValue(CONFIG, 'axes/y/motor0/pulloff_mm'), '4.000')
  assert.equal(getValue(CONFIG, 'axes/y/motor1/pulloff_mm'), '4.000')
  assert.equal(getValue(CONFIG, 'axes/z/steps_per_mm'), '200.000')
  assert.equal(getValue(CONFIG, 'axes/y/homing/positive_direction'), 'false')
  assert.equal(getValue(CONFIG, 'probe/pin'), 'gpio.36:low')
})

test('missing paths read as undefined and cannot be set', () => {
  assert.equal(getValue(CONFIG, 'axes/y/motor2/pulloff_mm'), undefined)
  assert.equal(getValue(CONFIG, 'axes/a/steps_per_mm'), undefined)
  assert.throws(() => setValue(CONFIG, 'axes/y/motor2/pulloff_mm', '1'), /not found/)
})

test('setValue changes exactly one line and keeps everything else', () => {
  const out = setValue(CONFIG, 'axes/y/motor1/pulloff_mm', '4.350')
  const diff = out.split('\n').filter((l, i) => l !== CONFIG.split('\n')[i])
  assert.deepEqual(diff, ['      pulloff_mm: 4.350 # right side'])
  assert.equal(out.length, CONFIG.length)
  assert.equal(getValue(out, 'axes/y/motor0/pulloff_mm'), '4.000')
  assert.equal(getValue(out, 'axes/z/motor0/pulloff_mm'), '4.000')
})

test('the same key under different parents is told apart', () => {
  const out = setValue(CONFIG, 'axes/z/motor0/pulloff_mm', '3.5')
  assert.equal(getValue(out, 'axes/z/motor0/pulloff_mm'), '3.5')
  assert.equal(getValue(out, 'axes/y/motor0/pulloff_mm'), '4.000')
})

test('CRLF line endings are read and kept', () => {
  const crlf = CONFIG.replace(/\n/g, '\r\n')
  assert.equal(getValue(crlf, 'axes/y/motor1/pulloff_mm'), '4.000')
  const out = setValue(crlf, 'axes/y/motor1/pulloff_mm', '4.350')
  assert.equal(getValue(out, 'axes/y/motor1/pulloff_mm'), '4.350')
  assert.ok(!/[^\r]\n/.test(out), 'no bare LF introduced')
  assert.equal(out.split('\r\n').length, crlf.split('\r\n').length)
})

test('trailing whitespace on the edited line survives, and a # inside a value is not a comment', () => {
  assert.equal(setValue('a: 1   \nb: 2\n', 'a', '9'), 'a: 9   \nb: 2\n')
  assert.equal(getValue('tag: ABC#123\n', 'tag'), 'ABC#123')
  assert.equal(setValue('tag: ABC#123\n', 'tag', 'X'), 'tag: X\n')
})
