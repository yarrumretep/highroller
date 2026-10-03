import { test } from 'node:test'
import assert from 'node:assert/strict'
import { probeZ, probeLines } from './probe.js'

// A fake FluidNC that answers each G38.2 with the next contact height (machine Z), or no contact.
// After a miss it is in alarm, like FluidNC: G-code is refused (error:9) until $X.
function fakeFnc(contacts) {
  const f = { sent: [], alarm: false }
  f.send = line => {
    f.sent.push(line)
    if (line === '$X') f.alarm = false
    if (f.alarm) return Promise.resolve({ ok: false, error: 9, lines: [] })
    if (!line.includes('G38.2')) return Promise.resolve({ ok: true, error: null, lines: [] })
    const z = contacts.shift()
    if (z === undefined) {
      f.alarm = true
      return Promise.resolve({ ok: true, error: null, lines: ['[PRB:0.000,0.000,-19.000:0]', 'ALARM:5'] }) // what FluidNC really sends
    }
    return Promise.resolve({ ok: true, error: null, lines: [`[PRB:10.000,20.000,${z.toFixed(3)}:1]`] })
  }
  return f
}

test('finds the plate fast, backs off, touches three times slowly, and returns the median', async () => {
  const f = fakeFnc([-50.4, -50.012, -50.001, -50.02])
  const r = await probeZ(f)
  assert.equal(r.z, -50.012)
  assert.deepEqual([r.x, r.y], [10, 20]) // where it touched, from the same [PRB:] report
  assert.deepEqual(r.touches, [-50.012, -50.001, -50.02])
  assert.ok(Math.abs(r.spread - 0.019) < 1e-9)
  assert.deepEqual(f.sent, [
    'G91',
    'G38.2 Z-20 F300',
    'G0 Z1',
    'G38.2 Z-2 F25',
    'G0 Z1',
    'G38.2 Z-2 F25',
    'G0 Z1',
    'G38.2 Z-2 F25',
    'G90',
  ])
})

test('rejects touches that disagree by more than the tolerance', async () => {
  const f = fakeFnc([-50, -50, -50.1, -50])
  await assert.rejects(probeZ(f), e => /Touches differ by 0.100 mm/.test(e.message) && e.retry === true) // resting on the plate: can be redone
  assert.equal(f.sent.at(-1), 'G90')
})

test('no contact stops at once with a clear error, and unlocks (only after a detected miss) to restore G90', async () => {
  const f = fakeFnc([])
  await assert.rejects(probeZ(f), e => /No contact/.test(e.message) && !e.retry) // the bit went 20 mm down: not to be redone blindly
  assert.deepEqual(f.sent, ['G91', 'G38.2 Z-20 F300', '$X', 'G90'])
})

test('a G90 refusal with no detected miss does not unlock', async () => {
  const f = fakeFnc([-5, -5])
  const sent = []
  const real = f.send
  f.send = line => {
    sent.push(line)
    if (line === 'G90') return Promise.resolve({ ok: false, error: 9, lines: [] })
    return real(line)
  }
  await probeZ(f, { touches: 1 })
  assert.deepEqual(sent.filter(l => l === '$X'), [])
  assert.equal(sent.at(-1), 'G90')
})

test('a refused G91 stops before any probe move', async () => {
  const f = fakeFnc([-5, -5, -5, -5])
  const real = f.send
  f.send = line => (line === 'G91' ? (f.sent.push(line), Promise.resolve({ ok: false, error: 9, lines: [] })) : real(line))
  await assert.rejects(probeZ(f), e => /G91 refused: error 9/.test(e.message) && e.retry === true) // nothing moved
  assert.deepEqual(f.sent, ['G91'])
})

test('a plate already touching at the start (ALARM:4) is said plainly, unlocked, and not redone', async () => {
  const f = fakeFnc([])
  const real = f.send
  f.send = line => {
    if (!line.includes('G38.2')) return real(line)
    f.sent.push(line)
    f.alarm = true
    return Promise.resolve({ ok: true, error: null, lines: ['ALARM:4'] })
  }
  await assert.rejects(probeZ(f), e => /already touching the bit/.test(e.message) && !e.retry)
  assert.deepEqual(f.sent, ['G91', 'G38.2 Z-20 F300', '$X', 'G90'])
})

test('a refused probe can be redone only if nothing had moved yet', async () => {
  const refuse = n => {
    const f = fakeFnc([-5, -5, -5, -5])
    const real = f.send
    let probes = 0
    f.send = line => (line.includes('G38.2') && ++probes === n ? (f.sent.push(line), Promise.resolve({ ok: false, error: 9, lines: [] })) : real(line))
    return probeZ(f)
  }
  await assert.rejects(refuse(1), e => /Probe refused: error 9/.test(e.message) && e.retry === true)
  await assert.rejects(refuse(2), e => /Probe refused: error 9/.test(e.message) && !e.retry)
})

test('options change the feeds, distances and touch count', async () => {
  const f = fakeFnc([-5, -5, -5])
  const r = await probeZ(f, { fast: 100, slow: 10, maxDown: 8, backoff: 0.5, touches: 2 })
  assert.equal(r.z, -5)
  assert.deepEqual(f.sent, ['G91', 'G38.2 Z-8 F100', 'G0 Z0.5', 'G38.2 Z-1 F10', 'G0 Z0.5', 'G38.2 Z-1 F10', 'G90'])
})

test('an even number of touches averages the two middle values', async () => {
  const f = fakeFnc([-5, -5.01, -5.03])
  const r = await probeZ(f, { touches: 2 })
  assert.ok(Math.abs(r.z - -5.02) < 1e-9, `z=${r.z}`)
})

test('a disconnect mid-probe is reported as refused', async () => {
  const f = fakeFnc([-5])
  f.send = line => Promise.resolve(line.includes('G38.2') ? { ok: false, error: 'disconnected', lines: [] } : { ok: true, error: null, lines: [] })
  await assert.rejects(probeZ(f), /Probe refused: error disconnected/)
})

test('probeLines lists exactly what probeZ sends, for default and custom options', async () => {
  assert.deepEqual(probeLines(), ['G91', 'G38.2 Z-20 F300', 'G0 Z1', 'G38.2 Z-2 F25', 'G0 Z1', 'G38.2 Z-2 F25', 'G0 Z1', 'G38.2 Z-2 F25', 'G90'])
  const opts = { fast: 100, slow: 10, maxDown: 8, backoff: 0.5, touches: 2 }
  const f = fakeFnc([-5, -5, -5])
  await probeZ(f, opts)
  assert.deepEqual(f.sent, probeLines(opts))
})
