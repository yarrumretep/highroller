import { test } from 'node:test'
import assert from 'node:assert/strict'
import { probeZ } from './probe.js'

// A fake FluidNC that answers each G38.2 with the next contact height (machine Z), or no contact.
function fakeFnc(contacts) {
  const f = { sent: [] }
  f.send = line => {
    f.sent.push(line)
    if (!line.includes('G38.2')) return Promise.resolve({ ok: true, error: null, lines: [] })
    const z = contacts.shift()
    if (z === undefined) return Promise.resolve({ ok: true, error: null, lines: ['[PRB:0.000,0.000,-19.000:0]', 'ALARM:5'] }) // what FluidNC really sends
    return Promise.resolve({ ok: true, error: null, lines: [`[PRB:10.000,20.000,${z.toFixed(3)}:1]`] })
  }
  return f
}

test('finds the plate fast, backs off, touches three times slowly, and returns the median', async () => {
  const f = fakeFnc([-50.4, -50.012, -50.001, -50.02])
  const r = await probeZ(f)
  assert.equal(r.z, -50.012)
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
  await assert.rejects(probeZ(f), /Touches differ by 0.100 mm/)
  assert.equal(f.sent.at(-1), 'G90')
})

test('no contact stops at once with a clear error', async () => {
  const f = fakeFnc([])
  await assert.rejects(probeZ(f), /No contact/)
  assert.deepEqual(f.sent, ['G91', 'G38.2 Z-20 F300', 'G90'])
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
