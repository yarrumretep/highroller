# HighRoller Step 3: Probing, Settings on the Board, and Calibration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Probe work Z0 with the touch plate from the Jog tab, keep HighRoller's settings on the board so phone and desktop share them, and run one calibration routine that measures Z tilt, squareness and steps/mm from four V-bit dots, then applies all of it with a single config write and restart.

**Architecture:**
- **Pure modules in `src/lib`, tested in Node:**
  - `probe.js`: the touch-plate probe routine (fast find, back off, three slow touches, median).
  - `yaml-edit.js`: read and change one value in FluidNC's `config.yaml` text, keeping comments and layout.
  - `calib.js`: the calibration maths and the pull-off rules.
  - `flash.js`: files on the board's flash, read and written over HTTP.
  - `calibration.js`: the calibration routine as an async script that asks the UI for each manual step.
- **App state:** `settings.svelte.js` becomes board-backed (`highroller.json`); `machine.svelte.js` loads the config file and the axis limits.
- **UI:** zeroing buttons on the Jog tab; a Tools tab listing the Calibrate routine, which runs in a full-screen dialog with its own STOP; the preview drawn in machine coordinates with the travel outline (user request, 2026-10-03).
- **Fake controller:** gains a touch plate, `$LocalFS/Show`, flash uploads, `$Bye`, per-axis homing and `G4` waits.

**Tech Stack:** Svelte 5, Vite, Node 22 `node:test`, `ws` (dev only).

**Spec:** `docs/superpowers/specs/2026-10-02-highroller-design.md`, sections "Calibration" and "Settings" (amended 2026-10-03: one unified routine). This plan is build-order step 3.

**Amended after the final review (2026-10-03).** Where a task's code listing below disagrees, these win (the code in the repo follows them):
- Files on flash are read over HTTP (`readFlash(name)`: `GET /<name>`, exact bytes; 404 → "no file", otherwise "the board is busy"), not with `$LocalFS/Show`, whose lines other clients' `[MSG:]`/`[PRB:]`/`ALARM:` broadcasts interleave with (and which truncates long lines and drops blank ones). The fake serves `/<name>` (503 while moving) and broadcasts those lines; the dev server proxies `/<name>.yaml|json|bak`.
- The config and `highroller.json` are read again on every connection; after a reconnect the board's settings win outright. A pass reads the config fresh before "Before you start", and Apply re-reads it and refuses if it changed or if the edit doesn't keep the file's shape.
- Settings are written only while the machine is Idle or Alarm with no job (otherwise once idle); only a missing file (404) leads to writing the defaults.
- Corner A's height step has a Z-only jog pad; the maths uses the probe's own x, y (`probeZ` returns `{x, y, z, spread, touches}`); measurements more than 1 % or 10 mm off are asked again; a pull-off change over 3 mm per motor is refused; a failed probe lifts 5 mm and repeats the corner.
- `<name>.bak` is written only if it isn't on the flash yet (`GET /files`).

## Global Constraints

- **Language and libraries:** Svelte 5 with runes, Vite, plain JavaScript, no runtime dependencies. Dev dependencies stay as they are.
- **Build output:** one file, `dist/index.html.gz`, under 100 KB.
- **Tests:** `npm test` (`node --disable-warning=ExperimentalWarning --test`), no framework, `*.test.js` beside each module. Fake-timer tests step the clock in small ticks and flush promises with `setImmediate`.
- **Protocol boundary:** only `src/lib/fluidnc.js` touches the websocket. Everything else goes through `fnc.send()`, `fnc.realtime()` and the named helpers.
- **The machine:** FluidNC 3.9.9. Facts verified in its source:
  - `G38.2` reports `[PRB:x,y,z:1]` in **machine** coordinates, then `ok`. No contact raises `ALARM:5` (and `[PRB:…:0]`).
  - A flash file is served over HTTP at `/<name>`, byte for byte, while Idle or Alarm; it is refused during motion. (`$LocalFS/Show=<name>` also prints it, but other clients' `[MSG:]`, `[PRB:]` and `ALARM:` broadcasts land among its lines, and it truncates lines over 254 characters and drops blank ones, so the app does not use it.)
  - Flash uploads: multipart `POST /files`, same form as the SD upload (`/<name>S` size field first, then the file part `/<name>`).
  - `$Config/Filename` answers `$Config/Filename=config.yaml`. `$Bye` restarts the board. `$H` homes everything; `$HX`, `$HY`, `$HZ` home one axis.
  - `G4 P0`'s `ok` arrives only after all queued motion has finished.
  - Config values live at YAML paths such as `axes/y/motor1/pulloff_mm` and `axes/x/steps_per_mm`. The stock LowRider config has 2-space indentation, `pulloff_mm: 4.000` per motor, X/Y homing negative, Z homing positive.
- **Safety:**
  - Every wizard move is a G-code line the user can read on screen before it runs.
  - Probing never starts until the status report has shown the probe input close and open again (`Pn:P`), proving the clip is connected.
  - Config changes are shown as old → new and need a confirmation; the original is saved as `<name>.bak` first, unless a `.bak` is already on the flash.
  - STOP stays available inside the wizard dialog.
- **UI:** touch targets ≥ 44 px; phone layout below 900 px (tabs Jog · Job · Tools · More); desktop at ≥ 900 px.
- **Comments:** short, only where they explain why; `ponytail:` marks deliberate simplifications.

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/probe.js` (new) | `probeZ(fnc, opts)`: the touch-plate routine, returns the contact height |
| `src/lib/yaml-edit.js` (new) | `getValue(text, path)`, `setValue(text, path, value)` |
| `src/lib/calib.js` (new) | `skew()`, `tilt()`, `stepsPerMm()`, `splitPulloff()`, `axisRange()` |
| `src/lib/flash.js` (new) | `readFlash(name)`, `listFlash()`, `writeFlash(name, text)` |
| `src/lib/calibration.js` (new) | `calibrate(io)`: the routine as a script of moves, probes, dots and questions |
| `src/lib/settings.svelte.js` (rewrite) | Board-backed settings with a localStorage fallback |
| `src/lib/machine.svelte.js` (modify) | `machine.config` (name, text, axis ranges), loaded when idle |
| `src/components/Dro.svelte` (modify) | Probe Z0, Go to XY0, Raise Z; double-click a coordinate to move |
| `src/components/Tools.svelte` (new) | The Tools list and the Settings form |
| `src/components/Calibrate.svelte` (new) | The wizard dialog driven by `calibrate(io)` |
| `src/App.svelte` (modify) | Tools tab; preview props |
| `src/components/Preview.svelte` (modify) | Machine coordinates, travel outline, fit toggle; tap to go there |
| `src/lib/track.js`, `src/lib/job.svelte.js`, `src/components/Job.svelte` (modify) | Progress by time; a time-left estimate that learns |
| `src/lib/confirm.svelte.js`, `src/components/ConfirmDialog.svelte` (new) | In-app confirmation instead of window.confirm |
| `src/components/FileBrowser.svelte` (new), `src/lib/files.js`, `dev/fake-fluidnc.js` (modify) | SD card browser with folders |
| `dev/fake-fluidnc.js` (modify) | Touch plate and probing, flash files, `$Bye`, `$HZ`, `G4` |

---

### Task 1: Touch-plate probe routine

**Files:**
- Create: `src/lib/probe.js`
- Test: `src/lib/probe.test.js`

**Interfaces:**
- Consumes: `fnc.send(line, { quiet })` → `{ ok, error, lines }`.
- Produces: `probeZ(fnc, opts?): Promise<{ z: number, spread: number, touches: number[] }>`
  - `z` is the median contact height in **machine** coordinates.
  - Options and defaults: `fast: 300` (mm/min), `slow: 25`, `maxDown: 20` (mm), `backoff: 1`, `touches: 3`, `tolerance: 0.05`.
  - Throws `Error('No contact: …')` when FluidNC reports no contact, `Error('Touches differ by …')` when the spread exceeds the tolerance, and `Error('Probe refused: …')` on any other error reply. On every error it has already sent `G90`.
  - Every command is sent quietly except the probe moves themselves, so the console shows the touches.

- [ ] **Step 1: Write the failing tests**

`src/lib/probe.test.js`:
```js
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
    if (z === undefined) return Promise.resolve({ ok: false, error: 5, lines: ['[PRB:0.000,0.000,-19.000:0]', 'ALARM:5'] })
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
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm test`
Expected: FAIL with `Cannot find module` for `./probe.js`.

- [ ] **Step 3: Implement `src/lib/probe.js`**

```js
// The touch-plate routine: find the plate fast, back off, then touch slowly a few times and take the median.
// Heights are machine coordinates, straight from FluidNC's [PRB:x,y,z:1] report.
const DEFAULTS = { fast: 300, slow: 25, maxDown: 20, backoff: 1, touches: 3, tolerance: 0.05 }

const prbZ = lines => {
  const m = lines.map(l => /^\[PRB:([^:\]]+):1\]/.exec(l)).find(Boolean)
  return m ? Number(m[1].split(',')[2]) : NaN
}

export async function probeZ(fnc, opts = {}) {
  const o = { ...DEFAULTS, ...opts }
  const quiet = line => fnc.send(line, { quiet: true })
  const probe = async (mm, feed) => {
    const r = await fnc.send(`G38.2 Z-${+mm.toFixed(3)} F${feed}`)
    if (r.error === 5 || r.lines.some(l => /^\[PRB:[^\]]*:0\]/.test(l))) throw new Error('No contact: is the plate under the bit and the clip attached?')
    if (!r.ok) throw new Error(`Probe refused: error ${r.error}`)
    const z = prbZ(r.lines)
    if (Number.isNaN(z)) throw new Error('Probe refused: no [PRB:] report')
    return z
  }
  await quiet('G91')
  try {
    await probe(o.maxDown, o.fast)
    const touches = []
    for (let i = 0; i < o.touches; i++) {
      await quiet(`G0 Z${+o.backoff.toFixed(3)}`)
      touches.push(await probe(2 * o.backoff, o.slow)) // the plate is one back-off below; allow twice that
    }
    const sorted = [...touches].sort((a, b) => a - b)
    const spread = sorted.at(-1) - sorted[0]
    if (spread > o.tolerance) throw new Error(`Touches differ by ${spread.toFixed(3)} mm. Clean the plate and try again.`)
    return { z: sorted[Math.floor(sorted.length / 2)], spread, touches }
  } finally {
    await quiet('G90')
  }
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test`
Expected: PASS, 4 new tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/probe.js src/lib/probe.test.js
git commit -m "Add the touch-plate probe routine"
```

---

### Task 2: Reading and changing values in config.yaml text

**Files:**
- Create: `src/lib/yaml-edit.js`
- Test: `src/lib/yaml-edit.test.js`

**Interfaces:**
- Produces:
  - `getValue(text, path): string | undefined`, where `path` is like `'axes/y/motor1/pulloff_mm'`. The value is the raw scalar text with any trailing comment removed.
  - `setValue(text, path, value): string`: the same text with only that scalar replaced. It throws if the path doesn't exist. Comments, blank lines and indentation are untouched.
- Scope (`ponytail:` in the file): block mappings with scalar leaves only, which is all FluidNC uses. No lists, no flow style, no multi-line scalars.

- [ ] **Step 1: Write the failing tests**

`src/lib/yaml-edit.test.js`:
```js
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
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm test`
Expected: FAIL with `Cannot find module` for `./yaml-edit.js`.

- [ ] **Step 3: Implement `src/lib/yaml-edit.js`**

```js
// Read or change one scalar in FluidNC's config.yaml without disturbing anything else.
// ponytail: block mappings of scalars only (all FluidNC uses); no lists, flow style or multi-line scalars.

// Finds the line index of `path` by walking indentation: a child is the next key line with deeper indent.
function findLine(lines, path) {
  const keys = path.split('/')
  let depth = -1 // indent of the parent we are inside; -1 = top level
  let i = 0
  for (const key of keys) {
    let found = -1
    for (; i < lines.length; i++) {
      const line = lines[i]
      const m = /^(\s*)([^\s#][^:]*):(.*)$/.exec(line)
      if (!m) continue // blank or comment
      const indent = m[1].length
      if (indent <= depth) return -1 // left the parent block without finding the key
      if (m[2] === key && (depth < 0 ? indent === 0 : indent > depth)) { found = i; break }
    }
    if (found < 0) return -1
    depth = /^(\s*)/.exec(lines[found])[1].length
    i = found + 1
  }
  return i - 1
}

const scalar = line => /:(.*)$/.exec(line)[1].replace(/\s+#.*$/, '').trim()

export function getValue(text, path) {
  const lines = text.split('\n')
  const i = findLine(lines, path)
  return i < 0 ? undefined : scalar(lines[i])
}

export function setValue(text, path, value) {
  const lines = text.split('\n')
  const i = findLine(lines, path)
  if (i < 0) throw new Error(`${path} not found in config`)
  const m = /^([^:]*:)(\s*)([^#]*?)(\s*#.*)?$/.exec(lines[i])
  lines[i] = `${m[1]}${m[2] || ' '}${value}${m[4] ?? ''}`
  return lines.join('\n')
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test`
Expected: PASS, 4 new tests. (Watch the "same key under different parents" case: when `motor0` is searched under `z`, the walker must not accept `y`'s `motor0`, which is why a key only matches while still inside the parent block.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/yaml-edit.js src/lib/yaml-edit.test.js
git commit -m "Add a minimal config.yaml value reader and editor"
```

---

### Task 3: Calibration maths and pull-off rules

**Files:**
- Create: `src/lib/calib.js`
- Test: `src/lib/calib.test.js`

**Interfaces:**
- Produces (all pure):
  - `skew({ ac, bd, w, h })`: the skew angle θ in radians, positive when AC > BD (the X-max side sits further along +Y).
  - `tilt({ zMin, zMax, xMin, xMax })`: slope in mm per mm, positive when the X-max side is lower (its contact height is higher).
  - `stepsPerMm(current, commanded, measured)`.
  - `splitPulloff({ p0, p1, delta, motor0AtXmax })`: new pull-offs `[n0, n1]`. `delta` is how much too far from its switch the X-max side sits (negative: too close). Pull-off moves a motor away from its switch, so the X-max motor pulls off less by delta/2 and the other more. Neither result goes below 1 mm: if one would, both are raised so the lower one is exactly 1.
  - `sideDelta({ measured, span, homesPositive, lowerOrAheadIsFar })`: not needed — the routine converts measurements to `delta` itself (see Task 6), because the sign depends on which way the axis homes.
  - `axisRange({ maxTravel, mposMm, positive })`: `{ min, max }` in machine coordinates.
- Conventions, written down once here and used by the routine:
  - Corners: A = (X-min, Y-min), B = (X-max, Y-min), C = (X-max, Y-max), D = (X-min, Y-max). W = AB, H = AD.
  - Y squareness: δy = skew · span, where `span` is the distance between the two Y motors (the gantry span setting). skew > 0 means the X-max side sits further along +Y.
  - Z tilt: δz = tilt · span (the Z motors sit the same distance apart). tilt > 0 means the X-max side sits lower.
  - Turning those into `delta` for `splitPulloff` depends on where the switch is: with Y homing negative (switch at Y-min), further +Y is further from the switch, so delta = +δy; with Z homing positive (switch at the top), lower is further from the switch, so delta = +δz. The opposite homing direction flips the sign.

- [ ] **Step 1: Write the failing tests**

`src/lib/calib.test.js`:
```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { skew, tilt, stepsPerMm, splitPulloff, axisRange } from './calib.js'

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`)

test('skew from the diagonals of a rectangle', () => {
  // A 1120 × 2340 rectangle whose X-max side sits 1 mm further along +Y: AC grows, BD shrinks.
  const d = (dx, dy) => Math.hypot(dx, dy)
  const ac = d(1120, 2340 + 1), bd = d(1120, 2340 - 1)
  near(skew({ ac, bd, w: 1120, h: 2340 }), 1 / 1120, 1e-5)
  assert.equal(skew({ ac: 100, bd: 100, w: 60, h: 80 }), 0)
})

test('tilt from two probe heights', () => {
  near(tilt({ zMin: -50, zMax: -49.5, xMin: 50, xMax: 1050 }), 0.0005) // X-max side is lower
  assert.equal(tilt({ zMin: -50, zMax: -50, xMin: 50, xMax: 1050 }), 0)
})

test('steps per mm scales by commanded over measured', () => {
  near(stepsPerMm(50, 1000, 1002), 50 * 1000 / 1002)
})

test('splitPulloff moves the X-max motor by half the delta and the other by the opposite half', () => {
  assert.deepEqual(splitPulloff({ p0: 4, p1: 4, delta: 0.6, motor0AtXmax: false }), [4.3, 3.7])
  assert.deepEqual(splitPulloff({ p0: 4, p1: 4, delta: 0.6, motor0AtXmax: true }), [3.7, 4.3])
  assert.deepEqual(splitPulloff({ p0: 4, p1: 4, delta: -0.6, motor0AtXmax: false }), [3.7, 4.3])
})

test('pull-offs never go below 1 mm: both are raised instead', () => {
  assert.deepEqual(splitPulloff({ p0: 1.2, p1: 1.2, delta: 1, motor0AtXmax: false }), [2, 1])
})

test('axis ranges in machine coordinates for both homing directions', () => {
  assert.deepEqual(axisRange({ maxTravel: 1220, mposMm: 3, positive: false }), { min: 3, max: 1223 })
  assert.deepEqual(axisRange({ maxTravel: 300, mposMm: 3, positive: true }), { min: -297, max: 3 })
})
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm test`
Expected: FAIL with `Cannot find module` for `./calib.js`.

- [ ] **Step 3: Implement `src/lib/calib.js`**

```js
// Calibration maths. Conventions: corners A (X-min,Y-min), B (X-max,Y-min), C (X-max,Y-max), D (X-min,Y-max);
// "delta" is how far the X-max side of the gantry must move to come true, and the two motors split it.
const MIN_PULLOFF = 1 // mm: FluidNC needs some pull-off to release the switch

export const skew = ({ ac, bd, w, h }) => (ac * ac - bd * bd) / (4 * w * h)

export const tilt = ({ zMin, zMax, xMin, xMax }) => (zMax - zMin) / (xMax - xMin)

export const stepsPerMm = (current, commanded, measured) => (current * commanded) / measured

export function splitPulloff({ p0, p1, delta, motor0AtXmax }) {
  // Pull-off moves a motor away from its switch. The X-max side sits `delta` too far from its switch,
  // so its motor pulls off less by half of that and the other motor more, keeping the origin where it is.
  const half = delta / 2
  let n0 = p0 + (motor0AtXmax ? -half : half)
  let n1 = p1 + (motor0AtXmax ? half : -half)
  const lift = MIN_PULLOFF - Math.min(n0, n1)
  if (lift > 0) { n0 += lift; n1 += lift }
  return [round(n0), round(n1)]
}

export const axisRange = ({ maxTravel, mposMm, positive }) =>
  positive ? { min: mposMm - maxTravel, max: mposMm } : { min: mposMm, max: mposMm + maxTravel }

const round = v => Math.round(v * 1000) / 1000
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test`
Expected: PASS, 6 new tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/calib.js src/lib/calib.test.js
git commit -m "Add calibration maths: skew, tilt, steps/mm and pull-off splitting"
```

---
### Task 4: Fake controller: touch plate, flash files, restart, per-axis homing, waits

**Files:**
- Modify: `dev/fake-fluidnc.js`
- Test: `dev/fake-fluidnc.test.js` (add tests)

**Interfaces:**
- Produces, on the fake:
  - **Probing:** `G38.2 Z-<d> F<f>` (relative under `G91`, absolute under `G90`) moves down at `f` until Z reaches the plate at machine `m.plateZ` (default −40), then prints `[PRB:x,y,z:1]` and `ok`. If the move ends above the plate it prints `[PRB:x,y,z:0]`, `ALARM:5`, goes to `Alarm`, then `ok`.
  - **Probe input:** `POST /fake/touch` makes the status report carry `Pn:P` for 800 ms (the user tapping the plate to the bit). `POST /fake/plate?z=<mm>` moves the plate.
  - **Waits:** `G4 P<n>`'s `ok` is sent once every queued move has finished. Bare `G90`/`G91` lines switch the mode.
  - **Machine coordinates:** `G53` on a line makes its targets machine coordinates.
  - **Homing:** `$HX`, `$HY`, `$HZ` home one axis (position 0 on that axis after 1.5 s).
  - **Spindle:** live `M3`/`M4`/`M5` and `S` work like they do inside jobs.
  - **Flash:** a `flash` map holding `config.yaml` (a trimmed LowRider config, below). `$LocalFS/Show=/<name>` prints it line by line then `ok` (`error:` when missing or when not Idle/Alarm). `GET /files?path=/` lists; `POST /files` uploads (same multipart form as `/upload`). `$Config/Filename` answers `$Config/Filename=config.yaml`.
  - **Restart:** `$Bye` replies `ok`, closes every websocket 100 ms later, and resets the machine (Idle, position 0, no job, spindle off), keeping the SD card and flash contents.

- [ ] **Step 1: Write the failing tests**

Add to `dev/fake-fluidnc.test.js` (keep the existing imports; add `import { probeZ } from '../src/lib/probe.js'`):
```js
test('probing finds the plate, the probe input can be touched, and a miss alarms', async () => {
  const server = start(8093)
  const fnc = new FluidNC({ host: 'localhost:8093' })
  try {
    const opened = new Promise(r => { fnc.onConnection = c => c === 'open' && r() })
    fnc.connect()
    await opened
    assert.equal((await fnc.send('$X')).ok, true)
    let sawPin = false
    fnc.onStatus = s => { if (s.pins.includes('P')) sawPin = true }
    await fetch('http://localhost:8093/fake/touch', { method: 'POST' })
    await sleep(300)
    assert.ok(sawPin, 'Pn:P after a touch')
    const r = await probeZ(fnc, { fast: 3000, slow: 600, maxDown: 50 })
    assert.ok(Math.abs(r.z - -40) < 1e-6, `z=${r.z}`)
    await fetch('http://localhost:8093/fake/plate?z=-200', { method: 'POST' })
    await assert.rejects(probeZ(fnc, { fast: 3000, slow: 600, maxDown: 10 }), /No contact/)
    await sleep(100)
    assert.equal(fnc.status.state, 'Alarm')
  } finally {
    fnc.close()
    server.close()
  }
})

test('G4 waits for motion, G53 uses machine coordinates, and $HZ homes only Z', async () => {
  const server = start(8092)
  const fnc = new FluidNC({ host: 'localhost:8092' })
  try {
    const opened = new Promise(r => { fnc.onConnection = c => c === 'open' && r() })
    fnc.connect()
    await opened
    await fnc.send('$X')
    await fnc.send('G10 L20 P0 X-5') // work X0 is now at machine X5
    await fnc.send('G53 G0 X20 F3000')
    const t0 = Date.now()
    assert.equal((await fnc.send('G4 P0')).ok, true)
    assert.ok(Date.now() - t0 > 100, 'G4 waited for the move')
    await sleep(150)
    assert.ok(Math.abs(fnc.status.mpos[0] - 20) < 1e-6, `mpos x=${fnc.status.mpos[0]}`)
    await fnc.send('G0 Z-30')
    await fnc.send('G4 P0')
    const p = fnc.send('$HZ')
    await sleep(1700)
    assert.equal((await p).ok, true)
    assert.ok(Math.abs(fnc.status.mpos[2]) < 1e-6 && Math.abs(fnc.status.mpos[0] - 20) < 1e-6)
  } finally {
    fnc.close()
    server.close()
  }
})

test('flash files: show, filename, upload, and $Bye restarts', async () => {
  const server = start(8091)
  const fnc = new FluidNC({ host: 'localhost:8091' })
  try {
    const opened = new Promise(r => { fnc.onConnection = c => c === 'open' && r() })
    fnc.connect()
    await opened
    assert.deepEqual((await fnc.send('$Config/Filename', { quiet: true })).lines, ['$Config/Filename=config.yaml'])
    const shown = await fnc.send('$LocalFS/Show=/config.yaml', { quiet: true })
    assert.ok(shown.lines.some(l => l.trim() === 'pulloff_mm: 4.000'))
    assert.equal((await fnc.send('$LocalFS/Show=/missing.json', { quiet: true })).ok, false)
    const form = new FormData()
    form.append('/highroller.json', '')
    form.append('/highroller.jsonS', '12')
    form.append('myfile', new Blob(['{"step":10}\n']), '/highroller.json')
    assert.equal((await fetch('http://localhost:8091/files', { method: 'POST', body: form })).status, 200)
    assert.deepEqual((await fnc.send('$LocalFS/Show=/highroller.json', { quiet: true })).lines, ['{"step":10}'])
    const closed = new Promise(r => { fnc.onConnection = c => c === 'closed' && r() })
    assert.equal((await fnc.send('$Bye')).ok, true)
    await closed
  } finally {
    fnc.close()
    server.close()
  }
})
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm test`
Expected: the three new tests FAIL (no `Pn:P`, `G4` answers at once, `$Config/Filename` answers a bare `ok`).

- [ ] **Step 3: Implement**

Make these changes in `dev/fake-fluidnc.js`:

a) Add after `const MAX_RATE = …`:
```js
const HOME_MS = 1500
// Just enough of the stock LowRider config for the app's readers and editors (axes, probe, outputs).
const CONFIG_YAML = `board: Jackpot TMC2209
name: LowRider

axes:
  x:
    steps_per_mm: 50.000
    max_rate_mm_per_min: 9000.000
    acceleration_mm_per_sec2: 200.000
    max_travel_mm: 1220
    soft_limits: false
    homing:
      cycle: 2
      positive_direction: false
      mpos_mm: 3
    motor0:
      limit_neg_pin: gpio.25:high
      pulloff_mm: 4.000

  y:
    steps_per_mm: 50.000
    max_rate_mm_per_min: 9000.000
    acceleration_mm_per_sec2: 200.000
    max_travel_mm: 2440
    soft_limits: false
    homing:
      cycle: 2
      positive_direction: false
      mpos_mm: 3
    motor0:
      limit_neg_pin: gpio.33:high
      pulloff_mm: 4.000
     #B
    motor1:
      limit_neg_pin: gpio.35:high
      pulloff_mm: 4.000

  z:
    steps_per_mm: 200.000
    max_rate_mm_per_min: 900.000
    acceleration_mm_per_sec2: 80.000
    max_travel_mm: 300.000
    soft_limits: false
    homing:
      cycle: 1
      positive_direction: true
      mpos_mm: 3
    motor0:
      limit_pos_pin: gpio.32:high
      pulloff_mm: 4.000
    motor1:
      limit_pos_pin: gpio.34:high
      pulloff_mm: 4.000

probe:
  pin: gpio.36:low
  check_mode_start: true

coolant:
  flood_pin: gpio.2
  mist_pin: gpio.16

user_outputs:
  digital0_pin: gpio.26
  digital1_pin: gpio.27
`
```

b) In `start()`, next to the `sd` map, add:
```js
  const flash = new Map([['config.yaml', Buffer.from(CONFIG_YAML)]]) // the board's flash: config and settings
  let plateZ = -40 // machine Z of the touch plate's top
  let touchUntil = 0 // the probe input reads closed until then (the user tapping the plate to the bit)
  const waiters = [] // G4 replies waiting for motion to finish
```

c) In `status()`, add the probe pin: after the `|A:S` line add
```js
    if (Date.now() < touchUntil) report += '|Pn:P'
```

d) `motion(text, jog, ok)` gains machine-coordinate and probe support. Replace its body's target computation with:
```js
    let abs = jog ? true : m.absolute
    let feed = jog ? null : m.feed
    let rapid = false
    let machineCoords = false
    const from = m.moves.at(-1)?.to ?? m.mpos
    const target = [...from]
    for (const [w, v] of words(text)) {
      if (w === 'G' && v === 90) abs = true
      else if (w === 'G' && v === 91) abs = false
      else if (w === 'G' && v === 0) rapid = true
      else if (w === 'G' && v === 53) machineCoords = true
      else if (w === 'F') feed = v
      else if (AXES.includes(w)) {
        const i = AXES.indexOf(w)
        target[i] = abs ? v + (machineCoords ? 0 : m.wco[i]) : target[i] + v
      }
    }
```
(the rest of `motion` stays the same.)

e) In `line(text, ws)`, after the `const ok = () => reply('ok')` line and before the `$SD/Run` handling, add:
```js
    const up = text.trim().toUpperCase()
    if (up === '$CONFIG/FILENAME') { reply('$Config/Filename=config.yaml'); return ok() }
    const show = /^\$LOCALFS\/SHOW=\/?(.+)$/i.exec(text.trim())
    if (show) {
      if (!['Idle', 'Alarm'].includes(m.state)) return reply('error:8')
      const buf = flash.get(show[1])
      if (!buf) return reply('error:62')
      for (const l of buf.toString().replace(/\n$/, '').split('\n')) reply(l)
      return ok()
    }
    if (up === '$BYE') {
      ok()
      setTimeout(() => {
        for (const c of clients) c.close()
        m.state = 'Idle'; m.mpos = [0, 0, 0]; m.moves = []; m.spindle = 0; job = null
      }, 100)
      return
    }
    const home = /^\$H([XYZ])$/.exec(up)
    if (home) {
      m.state = 'Home'
      status()
      setTimeout(() => { m.mpos[AXES.indexOf(home[1])] = 0; m.state = 'Idle'; status(); ok() }, HOME_MS)
      return
    }
```
and change the existing `$H` branch to use `HOME_MS` instead of the literal `1500`.

f) After the `if (m.state === 'Alarm') return reply('error:9')` line, add:
```js
    if (l === 'G90' || l === 'G91') { m.absolute = l === 'G90'; return ok() } // bare mode switches (the probe routine uses them)
    if (/^G4\b/.test(l)) { waiters.push(ok); return } // answered once motion has finished
    const probe = /G38\.2/.test(l)
    if (probe) {
      const z = words(l).find(([w]) => w === 'Z')?.[1] ?? 0
      const from = m.moves.at(-1)?.to ?? m.mpos
      const target = [...from]
      target[2] = m.absolute ? z + m.wco[2] : from[2] + z
      const feed = words(l).find(([w]) => w === 'F')?.[1] ?? m.feed
      m.moves.push({ to: target, feed: Math.min(feed, MAX_RATE.Z), probe: ok })
      if (m.state === 'Idle') m.state = 'Run'
      return
    }
    for (const [w, v] of words(l)) { // live spindle commands
      if (w === 'S') m.speed = v
      else if (w === 'M' && (v === 3 || v === 4)) m.spindle = m.speed || 1000
      else if (w === 'M' && v === 5) m.spindle = 0
    }
```

g) In the timer, inside the `if (mv && (m.state === 'Run' || m.state === 'Jog'))` block, make the probe stop at the plate. Replace
```js
      if (dist <= stepMm) {
        m.mpos = [...mv.to]
        m.moves.shift()
      } else {
        m.mpos = m.mpos.map((p, i) => p + (d[i] / dist) * stepMm)
      }
```
with
```js
      if (dist <= stepMm) {
        m.mpos = [...mv.to]
        m.moves.shift()
        if (mv.probe) { // reached the end without touching
          broadcast(`<PRB_PLACEHOLDER>`)
          broadcast('ALARM:5')
          m.state = 'Alarm'
          m.moves = []
          mv.probe()
          return status()
        }
      } else {
        m.mpos = m.mpos.map((p, i) => p + (d[i] / dist) * stepMm)
        if (mv.probe && m.mpos[2] <= plateZ) { // touched the plate
          m.mpos[2] = plateZ
          m.moves.shift()
          broadcast(`[PRB:${fmt(m.mpos)}:1]`)
          mv.probe()
        }
      }
```
where `<PRB_PLACEHOLDER>` is the literal template `` [PRB:${fmt(m.mpos)}:0] `` (written as a template string). Then, directly after that block (still inside the timer callback), add:
```js
    if (!m.moves.length) while (waiters.length) waiters.shift()()
```

h) In the HTTP server, before the `/upload` handling, add:
```js
    if (url.pathname === '/fake/touch') { touchUntil = Date.now() + 800; status(); res.writeHead(200); return res.end() }
    if (url.pathname === '/fake/plate') { plateZ = Number(url.searchParams.get('z')); res.writeHead(200); return res.end() }
    if (url.pathname === '/files' && req.method === 'POST') {
      const body = Readable.toWeb(req)
      const form = await new Request(url, { method: 'POST', headers: { 'content-type': req.headers['content-type'] }, body, duplex: 'half' }).formData()
      for (const [, v] of form) if (typeof v !== 'string') flash.set(v.name.replace(/^\//, ''), Buffer.from(await v.arrayBuffer()))
      return json(res, listingOf(flash))
    }
    if (url.pathname === '/files') return json(res, listingOf(flash))
```
and generalise the listing helper: rename `listing()` to `listingOf(map)` taking the map (`[...map].map(...)`), and change the two `/upload` uses to `listingOf(sd)`.

i) Update the startup `console.log` to mention `/files`.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test`
Expected: PASS, 3 new tests; the process exits on its own.

- [ ] **Step 5: Commit**

```bash
git add dev
git commit -m "Fake controller: touch plate and probing, flash files, \$Bye, per-axis homing, G4 waits"
```

---

### Task 5: Flash files, the config on connect, and settings on the board

**Files:**
- Create: `src/lib/flash.js`
- Test: `src/lib/flash.test.js`
- Modify: `src/lib/machine.svelte.js`, `src/lib/settings.svelte.js`, `vite.config.js`

**Interfaces:**
- Consumes: `fnc.send(line, { quiet })`, `parseList` from `files.js`, `getValue` (Task 2), `axisRange` (Task 3), the fake's flash endpoints (Task 4).
- Produces:
  - `readFlash(name, base = ''): Promise<string>`: the file's exact text, over HTTP (`GET /<name>`; amended, see the top). Throws when FluidNC refuses (not idle, missing file: `e.status` 404, unreachable).
  - `writeFlash(name, text, base = ''): Promise<void>`: multipart `POST /files`.
  - `machine.config`: `{ name, text, range }` once loaded; `range` is `{ X: {min,max}, Y: …, Z: … }` in machine coordinates, or `null` if the config lacks the values. Loaded the first time the machine is Idle or Alarm after each connect; `reloadConfig()` re-reads it.
  - `settings`: now also holds `plateMm`, `tapeMm`, `spanMm`, `marginMm`, `yMotor0AtXmax`, `zMotor0AtXmax` (and, after a pass, `lastSkewMm`, `lastTiltMm`). Loaded from `highroller.json` on the board when the config loads (again after every reconnect, when the board's copy wins); saved back (debounced 2 s, and only while the machine is Idle or Alarm with no job) after any change once it has been loaded. localStorage keeps a copy for the moments before the board answers.
- The dev proxy also forwards `/files` and `/fake/`.

- [ ] **Step 1: Write the failing tests**

`src/lib/flash.test.js`:
```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFlash, writeFlash } from './flash.js'
import { FluidNC } from './fluidnc.js'
import { start } from '../../dev/fake-fluidnc.js'

test('writes a flash file over HTTP and reads it back over the websocket', async () => {
  const server = start(8090)
  const fnc = new FluidNC({ host: 'localhost:8090' })
  try {
    const opened = new Promise(r => { fnc.onConnection = c => c === 'open' && r() })
    fnc.connect()
    await opened
    await writeFlash('highroller.json', '{"plateMm":10}\n', 'http://localhost:8090')
    assert.equal(await readFlash(fnc, 'highroller.json'), '{"plateMm":10}\n')
    await assert.rejects(readFlash(fnc, 'nope.txt'), /nope.txt/)
  } finally {
    fnc.close()
    server.close()
  }
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test`
Expected: FAIL with `Cannot find module` for `./flash.js`.

- [ ] **Step 3: Implement `src/lib/flash.js`**

```js
import { parseList } from './files.js'

// Files on the board's flash. Reading goes through the websocket ($LocalFS/Show prints the file, on 3.x and
// 4.x alike, while the machine is idle); writing uses the /files upload that FluidNC's own WebUI uses.
export async function readFlash(fnc, name) {
  const r = await fnc.send(`$LocalFS/Show=/${name}`, { quiet: true })
  if (!r.ok) throw new Error(`Can't read ${name} (${r.error === 'disconnected' ? 'not connected' : `error ${r.error}`})`)
  return r.lines.join('\n') + '\n'
}

export async function writeFlash(name, text, base = '') {
  const path = '/' + name
  const blob = new Blob([text])
  const form = new FormData()
  form.append(path + 'S', String(blob.size)) // before the file part: FluidNC reads it when the upload starts
  form.append('myfile', blob, path)
  const r = await fetch(base + '/files', { method: 'POST', body: form })
  if (!r.ok) throw new Error(`Upload of ${name} failed: HTTP ${r.status}`)
  parseList(await r.json()) // throws on "Upload failed"
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Load the config in `src/lib/machine.svelte.js`**

- Add imports: `import { readFlash } from './flash.js'`, `import { getValue } from './yaml-edit.js'`, `import { axisRange } from './calib.js'`.
- Add `config: null,` to the `machine` state object (after `wifi: null,`).
- In `onStatus`, after `if (s.state !== 'Alarm') machine.alarm = null`, add:
```js
    if (!machine.config && !loadingConfig && (s.state === 'Idle' || s.state === 'Alarm')) reloadConfig()
```
- Add, after `readWifi`:
```js
let loadingConfig = false

// Axis travel in machine coordinates, from the config's homing settings.
function rangesOf(text) {
  const range = {}
  for (const axis of ['X', 'Y', 'Z']) {
    const a = axis.toLowerCase()
    const maxTravel = Number(getValue(text, `axes/${a}/max_travel_mm`))
    const mposMm = Number(getValue(text, `axes/${a}/homing/mpos_mm`) ?? 0)
    const positive = getValue(text, `axes/${a}/homing/positive_direction`) === 'true'
    if (!(maxTravel > 0)) return null
    range[axis] = axisRange({ maxTravel, mposMm, positive })
  }
  return range
}

// The config file is only readable while idle; it is kept until the next reload.
export async function reloadConfig() {
  loadingConfig = true
  try {
    const r = await fnc.send('$Config/Filename', { quiet: true })
    const name = r.lines.find(l => l.startsWith('$Config/Filename='))?.split('=')[1] || 'config.yaml'
    const text = await readFlash(fnc, name)
    machine.config = { name, text, range: rangesOf(text) }
  } catch (e) {
    log(`Config not read: ${e.message}`)
  }
  loadingConfig = false
}
```

- [ ] **Step 6: Rewrite `src/lib/settings.svelte.js`**

```js
import { machine, fnc } from './machine.svelte.js'
import { readFlash, writeFlash } from './flash.js'

// Settings live on the board (highroller.json on its flash) so phone and desktop share them.
// localStorage keeps a copy for the moments before the board has answered.
const FILE = 'highroller.json'
const KEY = 'highroller.settings'
const SAVE_DELAY_MS = 2000
const DEFAULTS = {
  step: 10,
  feedXY: 3000,
  feedZ: 600,
  plateMm: 0.5, // touch plate thickness; V1 Engineering's plate is 0.5 mm
  tapeMm: 0.1, // masking tape thickness, for the calibration dots
  spanMm: 0, // distance between the two Y (and Z) motors; 0 = not set yet
  marginMm: 50, // how far inside the travel the calibration corners sit
  yMotor0AtXmax: false, // which side each twin motor is on
  zMotor0AtXmax: false,
}

function local() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) ?? {}
  } catch {
    return {}
  }
}

export const settings = $state({ ...DEFAULTS, ...local() })
let onBoard = false // true once the board's copy has been read; only then are changes written back
let saveTimer

async function loadFromBoard() {
  try {
    Object.assign(settings, JSON.parse(await readFlash(fnc, FILE)))
  } catch {
    // no file yet (first run) or unreadable: keep what we have and write it on the next change
  }
  onBoard = true
}

export const saveSettings = () => writeFlash(FILE, JSON.stringify(settings, null, 2) + '\n')

$effect.root(() => {
  // Read the board's copy once the config has loaded (both need the machine idle).
  $effect(() => {
    if (machine.config && !onBoard) loadFromBoard()
  })
  $effect(() => {
    const json = JSON.stringify(settings)
    try { localStorage.setItem(KEY, json) } catch {}
    if (!onBoard) return
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => saveSettings().catch(e => console.warn('Settings not saved:', e.message)), SAVE_DELAY_MS)
  })
})
```

- [ ] **Step 7: Extend the dev proxy in `vite.config.js`**

Change the proxy line to:
```js
  server: { proxy: { '/upload': target, '/sd/': target, '/files': target, '/fake/': target } },
```

- [ ] **Step 8: Build and check against the fake**

Run: `npm run build && npm test`
Expected: the build succeeds; all tests pass.

Then, with `npm run fake` and `npm run dev`: after unlocking, the console shows no "Config not read" line; in the browser console, `localStorage.getItem('highroller.settings')` now contains `plateMm`. Changing the jog step writes `highroller.json` to the fake within about 2 s (visible with `curl 'http://localhost:8081/files?path=/'`).

- [ ] **Step 9: Commit**

```bash
git add src/lib/flash.js src/lib/flash.test.js src/lib/machine.svelte.js src/lib/settings.svelte.js vite.config.js
git commit -m "Read the config on connect; keep settings on the board's flash"
```

---
### Task 6: The calibration routine as a script

**Files:**
- Create: `src/lib/calibration.js`
- Test: `src/lib/calibration.test.js`

**Interfaces:**
- Consumes: `skew`, `tilt`, `stepsPerMm`, `splitPulloff` (Task 3); `getValue`, `setValue` (Task 2).
- Produces: `calibrate(io): Promise<Summary>`. `io` is supplied by the UI (Task 7) or a test:
  - `io.send(line)` → `{ ok, error, lines }` (the FluidNC client's `send`).
  - `io.probe()` → `{ z }` in machine coordinates (the probe routine).
  - `io.config` → `{ name, text, range }`; `io.settings` → the settings object (read, and written for `lastSkewMm`, `lastTiltMm`, the motor sides).
  - `io.step({ title, text, arm?, jog? })` → resolves when the user presses Continue (the UI only enables it, when `arm` is set, after the probe input has been seen to close and open; `jog` shows the jog pad).
  - `io.ask({ title, text, fields })` → `{ name: value }`; blank optional fields come back `null`.
  - `io.review({ changes, notes })` → the list of changes the user left ticked, or `null` to stop.
  - `io.apply(newText)` → resolves once the config is written, the board restarted and homed.
  - `io.busy(text)` → shows progress text.
  - Any error (including a refused command after STOP) rejects the promise with a message the UI shows.
- The routine (one pass):
  1. Checks the config has axis ranges and the settings have a gantry span (asks for it if not).
  2. Homes. Corners A, B, C, D sit `marginMm` inside the X and Y travel.
  3. Moves to A at the top of Z; the user jogs down to a few mm above where the plate will sit.
  4. At each corner: tape and plate (armed probe), probe, lift the plate, `M5`, dot (plate thickness + tape thickness below the touch), retract to the travel height (first touch + 10 mm).
  5. Asks for AC, BD and optionally AB, DC, AD, BC.
  6. Works out tilt (average of AB and DC rows), skew, steps/mm; turns them into config changes; flips a motor-side setting if the previous pass made things worse; shows the review.
  7. Applies the ticked changes with one config write and restart, records this pass in the settings, and returns a summary.

- [ ] **Step 1: Write the failing test**

`src/lib/calibration.test.js`:
```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calibrate } from './calibration.js'
import { getValue } from './yaml-edit.js'

const CONFIG = `axes:
  x:
    steps_per_mm: 50.000
    max_travel_mm: 1220
    homing:
      positive_direction: false
      mpos_mm: 3
    motor0:
      pulloff_mm: 4.000
  y:
    steps_per_mm: 50.000
    max_travel_mm: 2440
    homing:
      positive_direction: false
      mpos_mm: 3
    motor0:
      pulloff_mm: 4.000
    motor1:
      pulloff_mm: 4.000
  z:
    steps_per_mm: 200.000
    max_travel_mm: 300.000
    homing:
      positive_direction: true
      mpos_mm: 3
    motor0:
      pulloff_mm: 4.000
    motor1:
      pulloff_mm: 4.000
`
const range = { X: { min: 3, max: 1223 }, Y: { min: 3, max: 2443 }, Z: { min: -297, max: 3 } }

// A scripted machine and user: probes answer in order, questions get fixed answers, everything is recorded.
function scripted({ probes, answers, keep = c => true }) {
  const rec = { sent: [], steps: [], asks: [], review: null, applied: null, busy: [] }
  const settings = { plateMm: 10, tapeMm: 0.1, spanMm: 1200, marginMm: 50, yMotor0AtXmax: false, zMotor0AtXmax: false }
  const io = {
    settings,
    config: { name: 'config.yaml', text: CONFIG, range },
    send: async line => { rec.sent.push(line); return { ok: true, error: null, lines: [] } },
    probe: async () => ({ z: probes.shift() }),
    step: async s => { rec.steps.push(s.title) },
    ask: async q => { rec.asks.push(q); return answers.shift() },
    review: async r => { rec.review = r; return r.changes.filter(keep) },
    apply: async text => { rec.applied = text },
    busy: t => rec.busy.push(t),
  }
  return { io, rec, settings }
}

const d = (dx, dy) => Math.hypot(dx, dy)

test('one pass: probes, dots, measurements, and a single config write with every correction', async () => {
  // X-max side 0.5 mm lower at both rows; rectangle 1120 × 2340 with the X-max side 1 mm further along +Y; X reads 1 mm long.
  const { io, rec } = scripted({
    probes: [-40, -39.5, -39.5, -40],
    answers: [{ ac: d(1120, 2341), bd: d(1120, 2339), ab: 1121, dc: 1121, ad: 2340, bc: 2340 }],
  })
  const summary = await calibrate(io)

  // Corners in order, each at the travel height, then the dot sequence
  const moves = rec.sent.filter(l => l.startsWith('G53 G0 X'))
  assert.deepEqual(moves, ['G53 G0 X53 Y53', 'G53 G0 X1173 Y53', 'G53 G0 X1173 Y2393', 'G53 G0 X53 Y2393'])
  assert.equal(rec.sent[0], '$H')
  const a = rec.sent.indexOf('G53 G0 X53 Y53')
  assert.deepEqual(rec.sent.slice(a + 1, a + 9), ['G4 P0', 'M5', 'G91', 'G0 Z2', 'G90', 'G53 G1 Z-50.1 F100', 'G53 G0 Z-30', 'G4 P0'])
  assert.ok(rec.sent.includes('G53 G1 Z-49.6 F100')) // corner B's dot, 0.5 mm higher

  // The numbers
  assert.ok(Math.abs(summary.tiltMm - 0.5357) < 0.001, `tilt ${summary.tiltMm}`)
  assert.ok(Math.abs(summary.skewMm - 1.0714) < 0.001, `skew ${summary.skewMm}`)
  const paths = rec.review.changes.map(c => c.path)
  assert.deepEqual(paths, ['axes/z/motor0/pulloff_mm', 'axes/z/motor1/pulloff_mm', 'axes/y/motor0/pulloff_mm', 'axes/y/motor1/pulloff_mm', 'axes/x/steps_per_mm'])
  const applied = rec.applied
  assert.equal(getValue(applied, 'axes/z/motor0/pulloff_mm'), '4.268')
  assert.equal(getValue(applied, 'axes/z/motor1/pulloff_mm'), '3.732')
  assert.equal(getValue(applied, 'axes/y/motor0/pulloff_mm'), '4.536')
  assert.equal(getValue(applied, 'axes/y/motor1/pulloff_mm'), '3.464')
  assert.equal(getValue(applied, 'axes/x/steps_per_mm'), '49.955')
  assert.equal(getValue(applied, 'axes/y/steps_per_mm'), '50.000') // sides matched: untouched
  assert.equal(io.settings.lastSkewMm.toFixed(3), '1.071')
})

test('unticked changes are not applied, and skipped side measurements leave steps/mm alone', async () => {
  const { io, rec } = scripted({
    probes: [-40, -40, -40, -40],
    answers: [{ ac: d(1120, 2341), bd: d(1120, 2339), ab: null, dc: null, ad: null, bc: null }],
    keep: c => c.path.startsWith('axes/y/motor'),
  })
  await calibrate(io)
  assert.deepEqual(rec.review.changes.map(c => c.path), ['axes/y/motor0/pulloff_mm', 'axes/y/motor1/pulloff_mm'])
  assert.equal(getValue(rec.applied, 'axes/y/motor1/pulloff_mm'), '3.464')
  assert.equal(getValue(rec.applied, 'axes/x/steps_per_mm'), '50.000')
})

test('a pass that made squareness worse flips the motor-side setting', async () => {
  const { io, rec, settings } = scripted({
    probes: [-40, -40, -40, -40],
    answers: [{ ac: d(1120, 2342), bd: d(1120, 2338), ab: null, dc: null, ad: null, bc: null }],
  })
  settings.lastSkewMm = 1.0 // last time the skew was 1 mm; now it is 2 mm, the same way
  await calibrate(io)
  assert.equal(settings.yMotor0AtXmax, true)
  assert.ok(rec.review.notes.some(n => /swapped/.test(n)))
  assert.equal(getValue(rec.applied, 'axes/y/motor0/pulloff_mm'), '2.929') // now motor0 is the X-max motor
})

test('stops cleanly when the user cancels at the review', async () => {
  const { io, rec } = scripted({ probes: [-40, -40, -40, -40], answers: [{ ac: 100, bd: 100, ab: null, dc: null, ad: null, bc: null }] })
  io.review = async () => null
  const summary = await calibrate(io)
  assert.equal(summary.applied, false)
  assert.equal(rec.applied, null)
})

test('a refused command aborts with its message', async () => {
  const { io } = scripted({ probes: [], answers: [] })
  io.send = async line => ({ ok: line !== '$H', error: 'reset', lines: [] })
  await assert.rejects(calibrate(io), /\$H failed: reset/)
})
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm test`
Expected: FAIL with `Cannot find module` for `./calibration.js`.

- [ ] **Step 3: Implement `src/lib/calibration.js`**

```js
import { skew, tilt, stepsPerMm, splitPulloff } from './calib.js'
import { getValue, setValue } from './yaml-edit.js'

// One calibration pass, written as a script. The UI (or a test) supplies `io`: machine commands, the probe,
// and the manual steps. Four V-bit dots on tape give Z tilt (from the probes), squareness (the diagonals)
// and X/Y steps per mm (the sides); every correction is applied with one config write and one restart.
const DOT_FEED = 100 // mm/min, pushing the V-bit into the tape
const TRAVEL_ABOVE_MM = 10 // travel height above the first touch
const WORSE = 1.2 // a pass that leaves more than this much of the previous error made it worse

const r3 = v => Math.round(v * 1000) / 1000
const fmt = v => r3(v).toFixed(3) // config values keep three decimals
const num = v => String(r3(v)) // G-code numbers: no trailing zeros

export async function calibrate(io) {
  const { settings: s, config } = io
  if (!config?.range) throw new Error('The config has no axis travel (max_travel_mm / homing) to work from')
  const g = async line => {
    const r = await io.send(line)
    if (!r.ok) throw new Error(`${line} failed: ${r.error}`)
  }
  if (!(s.spanMm > 0)) {
    const a = await io.ask({ title: 'Gantry span', text: 'Distance between the two Y motors (and the two Z motors), in mm.', fields: [{ name: 'spanMm', label: 'Span', unit: 'mm' }] })
    if (!(a.spanMm > 0)) throw new Error('A gantry span is needed')
    s.spanMm = Number(a.spanMm)
  }

  const { X, Y, Z } = config.range
  const xMin = X.min + s.marginMm, xMax = X.max - s.marginMm, yMin = Y.min + s.marginMm, yMax = Y.max - s.marginMm
  const corners = [
    { name: 'A', x: xMin, y: yMin },
    { name: 'B', x: xMax, y: yMin },
    { name: 'C', x: xMax, y: yMax },
    { name: 'D', x: xMin, y: yMax },
  ]

  await io.step({
    title: 'Before you start',
    text: 'Fit a V-bit and make sure the router is off. You will need four pieces of masking tape, the touch plate and its clip, and calipers or a tape measure. Dots go at the four corners of a ' + `${xMax - xMin} × ${yMax - yMin} mm rectangle.`,
  })
  io.busy('Homing…')
  await g('$H')

  let travelZ = Z.max
  for (const c of corners) {
    io.busy(`Moving to corner ${c.name}…`)
    await g(`G53 G0 Z${num(travelZ)}`)
    await g(`G53 G0 X${c.x} Y${c.y}`)
    await g('G4 P0')
    if (c.name === 'A') {
      await io.step({ title: 'Corner A: set the height', text: 'Jog the bit down until it is a few millimetres above where the plate will sit, then continue.', jog: true })
    }
    await io.step({
      title: `Corner ${c.name}: tape and plate`,
      text: 'Stick a piece of tape under the bit. Put the touch plate on the tape and attach the clip to the bit. Tap the plate against the bit so the app sees the contact, then press Probe.',
      arm: true,
    })
    io.busy('Probing…')
    c.z = (await io.probe()).z
    await io.step({ title: `Corner ${c.name}: make the dot`, text: 'Lift the plate off the tape. Keep the clip on. Press Continue to push the bit into the tape.' })
    await g('M5')
    await g('G91')
    await g('G0 Z2')
    await g('G90')
    await g(`G53 G1 Z${num(c.z - s.plateMm - s.tapeMm)} F${DOT_FEED}`)
    if (c.name === 'A') travelZ = c.z + TRAVEL_ABOVE_MM
    await g(`G53 G0 Z${num(travelZ)}`)
    await g('G4 P0')
  }
  await g(`G53 G0 Z${Z.max}`)

  const [A, B, C, D] = corners
  const W = xMax - xMin, H = yMax - yMin
  const m = await io.ask({
    title: 'Measure the dots',
    text: `Measure between the dot centres. The diagonals give squareness; the sides are optional and give steps per mm. The rectangle was commanded as ${W} × ${H} mm.`,
    fields: [
      { name: 'ac', label: 'Diagonal A–C', unit: 'mm' },
      { name: 'bd', label: 'Diagonal B–D', unit: 'mm' },
      { name: 'ab', label: 'Side A–B (X, front)', unit: 'mm', optional: true },
      { name: 'dc', label: 'Side D–C (X, back)', unit: 'mm', optional: true },
      { name: 'ad', label: 'Side A–D (Y, left)', unit: 'mm', optional: true },
      { name: 'bc', label: 'Side B–C (Y, right)', unit: 'mm', optional: true },
    ],
  })

  // Tilt: the X-max side lower by this much across the gantry span (average of the two rows)
  const tiltMm = s.spanMm * (tilt({ zMin: A.z, zMax: B.z, xMin: A.x, xMax: B.x }) + tilt({ zMin: D.z, zMax: C.z, xMin: D.x, xMax: C.x })) / 2
  // Skew: the X-max side further along +Y by this much across the span
  const skewMm = s.spanMm * skew({ ac: m.ac, bd: m.bd, w: W, h: H })

  const notes = []
  if (s.lastSkewMm != null && Math.abs(skewMm) > WORSE * Math.abs(s.lastSkewMm) && Math.sign(skewMm) === Math.sign(s.lastSkewMm)) {
    s.yMotor0AtXmax = !s.yMotor0AtXmax
    notes.push('The last pass made squareness worse, so the Y motor sides have been swapped.')
  }
  if (s.lastTiltMm != null && Math.abs(tiltMm) > WORSE * Math.abs(s.lastTiltMm) && Math.sign(tiltMm) === Math.sign(s.lastTiltMm)) {
    s.zMotor0AtXmax = !s.zMotor0AtXmax
    notes.push('The last pass made the tilt worse, so the Z motor sides have been swapped.')
  }

  // Pull-off: `delta` is how much too far from its switch the X-max side sits. Lower means further from a top
  // switch; further +Y means further from a Y-min switch. The opposite homing direction flips the sign.
  const homesPositive = axis => getValue(config.text, `axes/${axis}/homing/positive_direction`) === 'true'
  const changes = []
  const pulloffs = (axis, delta, motor0AtXmax, what) => {
    const p0 = Number(getValue(config.text, `axes/${axis}/motor0/pulloff_mm`))
    const p1 = Number(getValue(config.text, `axes/${axis}/motor1/pulloff_mm`))
    if (!(p0 >= 0 && p1 >= 0)) return notes.push(`No twin-motor pull-off found for ${axis.toUpperCase()}; ${what} not corrected.`)
    const [n0, n1] = splitPulloff({ p0, p1, delta, motor0AtXmax })
    for (const [motor, old, now] of [['motor0', p0, n0], ['motor1', p1, n1]]) {
      if (fmt(old) !== fmt(now)) changes.push({ path: `axes/${axis}/${motor}/pulloff_mm`, label: `${axis.toUpperCase()} ${motor} pull-off`, old: fmt(old), new: fmt(now), apply: true })
    }
  }
  pulloffs('z', (homesPositive('z') ? 1 : -1) * tiltMm, s.zMotor0AtXmax, 'tilt')
  pulloffs('y', (homesPositive('y') ? -1 : 1) * skewMm, s.yMotor0AtXmax, 'squareness')

  const scale = (axis, commanded, a, b) => {
    if (!(a > 0 && b > 0)) return
    const cur = Number(getValue(config.text, `axes/${axis}/steps_per_mm`))
    const now = stepsPerMm(cur, commanded, (a + b) / 2)
    if (fmt(cur) !== fmt(now)) changes.push({ path: `axes/${axis}/steps_per_mm`, label: `${axis.toUpperCase()} steps per mm`, old: fmt(cur), new: fmt(now), apply: true })
  }
  scale('x', W, m.ab, m.dc)
  scale('y', H, m.ad, m.bc)

  const summary = { tiltMm: r3(tiltMm), skewMm: r3(skewMm), changes, applied: false }
  const chosen = await io.review({
    changes,
    notes: [
      `Z tilt: the X-max side is ${fmt(Math.abs(tiltMm))} mm ${tiltMm >= 0 ? 'lower' : 'higher'} across the gantry.`,
      `Squareness: the X-max side is ${fmt(Math.abs(skewMm))} mm ${skewMm >= 0 ? 'ahead' : 'behind'} across the gantry.`,
      ...notes,
    ],
  })
  if (!chosen || !chosen.length) return summary

  let text = config.text
  for (const c of chosen) text = setValue(text, c.path, c.new)
  io.busy('Writing the config and restarting…')
  await io.apply(text)
  s.lastSkewMm = r3(skewMm)
  s.lastTiltMm = r3(tiltMm)
  summary.applied = true
  summary.changes = chosen
  return summary
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test`
Expected: PASS, 5 new tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/calibration.js src/lib/calibration.test.js
git commit -m "Add the calibration routine: four dots, measurements, one config write"
```

---
### Task 7: Zeroing helpers on the Jog tab

**Files:**
- Modify: `src/components/Dro.svelte`

**Interfaces:**
- Consumes: `probeZ` (Task 1), `machine.config.range` and `machine.status.pins` (Task 5), `settings.plateMm` (Task 5), `send`, `fnc`.
- Produces three buttons under the position readout:
  - **Probe Z0:** enabled once the probe input has been seen to close and open (the user taps the plate to the bit). Runs the probe routine, sets work Z so that the stock top is zero (`G10 L20 P0 Z<plate thickness>` at the contact point), then lifts 5 mm.
  - **Go to XY0:** first raises to work Z 10 if the bit is lower (clear of the stock without climbing to the top of travel), then `G0 X0 Y0`.
  - **Raise Z:** `G53 G0 Z<top>`.
  - Each needs the machine Idle and connected; errors show in a line under the buttons.
  - **Home all / Home X / Home Y / Home Z:** a row of smaller buttons under those three, sending `$H`, `$HX`, `$HY`, `$HZ`. Enabled while connected and Idle *or Alarm* (homing is the way out of the boot alarm); the top bar's alarm banner keeps its own Home button.

- [ ] **Step 1: Edit `src/components/Dro.svelte`**

Replace the `<script>` block with:
```svelte
<script>
  import { machine, send, fnc } from '../lib/machine.svelte.js'
  import { settings } from '../lib/settings.svelte.js'
  import { probeZ } from '../lib/probe.js'

  const AXES = ['X', 'Y', 'Z']
  const idle = $derived(machine.conn === 'open' && machine.status.state === 'Idle')
  const top = $derived(machine.config?.range?.Z.max)
  let busy = $state('')
  let error = $state('')
  // The Probe button arms only after the probe input has closed and opened again: proof the clip is on.
  let armed = $state(false)
  let seenClosed = false
  $effect(() => {
    const p = machine.status.pins.includes('P')
    if (p) seenClosed = true
    else if (seenClosed) armed = true
    if (machine.conn !== 'open') { seenClosed = false; armed = false }
  })

  async function run(label, fn) {
    busy = label
    error = ''
    try {
      await fn()
    } catch (e) {
      error = e.message
    }
    busy = ''
  }

  const probe = () => run('Probing…', async () => {
    armed = false
    seenClosed = false
    await probeZ(fnc)
    await send(`G10 L20 P0 Z${settings.plateMm}`) // the bit sits on the plate: the stock top is one plate below
    await send('G91')
    await send('G0 Z5')
    await send('G90')
  })
  const goXY0 = () => run('Moving…', async () => {
    const z = machine.status.wpos?.[2]
    if (z != null && z < 10) await send('G0 Z10') // clear the stock (work Z0 is its top) without climbing to the top of travel
    await send('G0 X0 Y0')
  })
  const raise = () => run('Raising…', () => send(`G53 G0 Z${top}`))
  // Homing is allowed in Alarm too: it is how the machine leaves the boot alarm.
  const canHome = $derived(machine.conn === 'open' && (machine.status.state === 'Idle' || machine.status.state === 'Alarm'))
  const home = axis => run(`Homing ${axis || 'all'}…`, () => send(axis ? `$H${axis}` : '$H'))
</script>
```

After the `{/each}` inside the `.dro` panel, add:
```svelte
  <div class="helpers">
    <button disabled={!idle || !armed || !!busy} onclick={probe} title="Put the plate under the bit, clip on, tap the plate to the bit, then press">Probe Z0</button>
    <button disabled={!idle || !!busy || top == null} onclick={goXY0}>Go to XY0</button>
    <button disabled={!idle || !!busy || top == null} onclick={raise}>Raise Z</button>
  </div>
  <div class="homes">
    <button disabled={!canHome || !!busy} onclick={() => home('')}>Home all</button>
    <button disabled={!canHome || !!busy} onclick={() => home('X')}>Home X</button>
    <button disabled={!canHome || !!busy} onclick={() => home('Y')}>Home Y</button>
    <button disabled={!canHome || !!busy} onclick={() => home('Z')}>Home Z</button>
  </div>
  {#if busy}<p class="note">{busy}</p>{/if}
  {#if !armed && idle && !busy}<p class="note">To probe: plate under the bit, clip on, tap the plate to the bit.</p>{/if}
  {#if error}<p class="note err">{error}</p>{/if}
```

Add to the `<style>`:
```css
  .helpers { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-top: 4px; }
  .homes { display: grid; grid-template-columns: 1.4fr repeat(3, 1fr); gap: 6px; }
  .homes button { min-height: 44px; padding: 0 6px; font-size: 13px; } /* smaller than the jog buttons, still a finger-sized target */
  .note { margin: 0; font-size: 13px; color: var(--muted); }
  .err { color: var(--bad); }
```

- [ ] **Step 2: Build and check against the fake**

Run: `npm run build` (no new warnings). Then with the fake and dev server:
- Unlock. "Probe Z0" is disabled with the hint shown. `curl -X POST localhost:8081/fake/touch` → the button enables.
- Press it: the console shows the probe moves; Z work position reads 0.500 at the contact (plate thickness) and the bit lifts 5 mm (work Z 5.500).
- "Go to XY0" and "Raise Z" move as described.
- Restart the fake (it boots in Alarm): the Home buttons are enabled while the others are not; "Home X" sends `$HX` (the console shows it, the status goes Home then Idle); "Home all" sends `$H`.

- [ ] **Step 3: Commit**

```bash
git add src/components/Dro.svelte
git commit -m "Add Probe Z0, Go to XY0, Raise Z and home buttons to the Jog tab"
```

---

### Task 8: Tools tab, settings form and the Calibrate dialog

**Files:**
- Create: `src/components/Tools.svelte`, `src/components/Calibrate.svelte`
- Modify: `src/App.svelte`

**Interfaces:**
- Consumes: `calibrate(io)` (Task 6), `probeZ` (Task 1), `readFlash`/`writeFlash` and `reloadConfig` (Task 5), `settings`, `machine`, `fnc`, `send`, `stop`, `JogPad`.
- Produces:
  - A **Tools** tab (phone) / column section (desktop) with: a Calibrate card and button; a Settings form (plate thickness, tape thickness, gantry span, corner margin, which motor is on the X-max side for Y and for Z).
  - `<Calibrate />`: a full-screen `<dialog>` that runs `calibrate(io)`. Its header has the title and a STOP button; its body shows the current step (text, optional jog pad, optional armed Probe button), question form, review list with checkboxes, progress, or the result. Cancel closes it; STOP calls the app's `stop()` and the routine aborts with "Stopped".
  - `io.apply(text, config)` in the dialog (amended): re-read the config and refuse if it changed or the edit lost the file's shape, `writeFlash('<name>.bak', oldText)` (only if no `.bak` is on the flash), `writeFlash(name, text)`, `send('$Bye')`, wait until the connection drops and comes back and the machine is Idle or Alarm, `send('$H')`, then `reloadConfig()`.

- [ ] **Step 1: Write `src/components/Tools.svelte`**

```svelte
<script>
  import { machine } from '../lib/machine.svelte.js'
  import { settings } from '../lib/settings.svelte.js'
  import Calibrate from './Calibrate.svelte'

  let calibrating = $state(false)
  const num = (key, e) => (settings[key] = Number(e.currentTarget.value))
</script>

<div class="panel tool">
  <h2>Calibrate</h2>
  <p>Four V-bit dots on tape, one measuring session, one restart: Z tilt, squareness and steps per mm.</p>
  <button class="go" disabled={!machine.config || machine.status.state !== 'Idle'} onclick={() => (calibrating = true)}>Start calibration</button>
  {#if !machine.config}<p class="muted">Waiting for the machine's config (it is read while idle).</p>{/if}
</div>

<div class="panel form">
  <h2>Settings</h2>
  <label>Touch plate thickness <input type="number" step="0.01" value={settings.plateMm} onchange={e => num('plateMm', e)} /> mm</label>
  <label>Tape thickness <input type="number" step="0.01" value={settings.tapeMm} onchange={e => num('tapeMm', e)} /> mm</label>
  <label>Gantry span (between the Y motors) <input type="number" step="1" value={settings.spanMm} onchange={e => num('spanMm', e)} /> mm</label>
  <label>Corner margin inside the travel <input type="number" step="1" value={settings.marginMm} onchange={e => num('marginMm', e)} /> mm</label>
  <label><input type="checkbox" bind:checked={settings.yMotor0AtXmax} /> Y motor0 is on the X-max side</label>
  <label><input type="checkbox" bind:checked={settings.zMotor0AtXmax} /> Z motor0 is on the X-max side</label>
  <p class="muted">Not sure which side a motor is on? Leave it. If a pass makes things worse, the next pass swaps it for you.</p>
</div>

{#if calibrating}<Calibrate onclose={() => (calibrating = false)} />{/if}

<style>
  .tool, .form { display: grid; gap: 8px; }
  h2 { margin: 0; font-size: 18px; }
  p { margin: 0; font-size: 14px; }
  .muted { color: var(--muted); }
  .go { min-height: 52px; font-size: 17px; font-weight: 700; color: white; background: var(--accent); border-color: var(--accent); }
  label { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 14px; }
  input[type='number'] { width: 90px; min-height: 44px; padding: 0 8px; font-size: 16px; border: 1px solid var(--line); border-radius: 10px; background: var(--bg); }
  input[type='checkbox'] { width: 22px; height: 22px; }
</style>
```

- [ ] **Step 2: Write `src/components/Calibrate.svelte`**

```svelte
<script>
  import { onMount } from 'svelte'
  import { machine, fnc, send, stop, reloadConfig } from '../lib/machine.svelte.js'
  import { settings } from '../lib/settings.svelte.js'
  import { probeZ } from '../lib/probe.js'
  import { readFlash, writeFlash } from '../lib/flash.js'
  import { calibrate } from '../lib/calibration.js'
  import JogPad from './JogPad.svelte'

  let { onclose } = $props()
  let dialog
  // What the routine is showing right now: { kind: 'busy'|'step'|'ask'|'review'|'done'|'error', ... }
  let view = $state({ kind: 'busy', text: 'Starting…' })
  let answers = $state({})
  let ticked = $state([])
  let resolve = null // settles the pending io call

  // Probe arming for steps with `arm`: the probe input must close and open again.
  let seenClosed = false
  let armed = $state(false)
  $effect(() => {
    const p = machine.status.pins.includes('P')
    if (p) seenClosed = true
    else if (seenClosed) armed = true
  })

  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const idleOrAlarm = () => machine.conn === 'open' && (machine.status.state === 'Idle' || machine.status.state === 'Alarm')

  let backedUp = false
  const io = {
    settings,
    get config() { return machine.config },
    send,
    probe: () => probeZ(fnc),
    busy: text => (view = { kind: 'busy', text }),
    step: s => new Promise(r => { seenClosed = false; armed = false; resolve = r; view = { kind: 'step', ...s } }),
    ask: q => new Promise(r => { answers = {}; resolve = r; view = { kind: 'ask', ...q } }),
    review: r => new Promise(res => { ticked = r.changes.map(() => true); resolve = res; view = { kind: 'review', ...r } }),
    async apply(text) {
      const { name, text: old } = machine.config
      if (!backedUp) { await writeFlash(`${name}.bak`, old); backedUp = true }
      await writeFlash(name, text)
      await send('$Bye')
      view = { kind: 'busy', text: 'Restarting the controller…' }
      const t0 = Date.now()
      while (machine.conn === 'open' && Date.now() - t0 < 5000) await sleep(100)
      while (!idleOrAlarm() && Date.now() - t0 < 60000) await sleep(200)
      if (!idleOrAlarm()) throw new Error('The controller did not come back after the restart')
      machine.config = null
      view = { kind: 'busy', text: 'Homing…' }
      const r = await send('$H')
      if (!r.ok) throw new Error(`$H failed: ${r.error}`)
      await reloadConfig()
    },
  }

  onMount(() => {
    dialog.showModal()
    calibrate(io)
      .then(summary => (view = { kind: 'done', summary }))
      .catch(e => (view = { kind: 'error', text: e.message }))
  })

  function next() {
    const r = resolve
    resolve = null
    if (view.kind === 'ask') {
      const out = {}
      for (const f of view.fields) {
        const v = answers[f.name]
        out[f.name] = v === undefined || v === '' ? null : Number(v)
      }
      r(out)
    } else if (view.kind === 'review') r(view.changes.filter((_, i) => ticked[i]))
    else r()
  }
  const cancel = () => { resolve?.(null); onclose() }
  async function stopAll() {
    await stop() // the routine's next command is refused and it reports "Stopped"
    cancel()
  }
  const askReady = $derived(view.kind === 'ask' && view.fields.every(f => f.optional || Number(answers[f.name]) > 0))
</script>

<dialog bind:this={dialog} oncancel={e => { e.preventDefault(); cancel() }}>
  <header>
    <strong>{view.title ?? 'Calibrate'}</strong>
    <span class="state">{machine.status.state}</span>
    <button class="stop" onpointerdown={e => { e.preventDefault(); stopAll() }} onclick={e => e.detail === 0 && stopAll()}>STOP</button>
  </header>

  <section>
    {#if view.kind === 'busy'}
      <p>{view.text}</p>
    {:else if view.kind === 'step'}
      <p>{view.text}</p>
      {#if view.jog}<JogPad />{/if}
      {#if view.arm && !armed}<p class="muted">Waiting for the plate to touch the bit…</p>{/if}
      <button class="go" disabled={view.arm && !armed} onclick={next}>{view.arm ? 'Probe' : 'Continue'}</button>
    {:else if view.kind === 'ask'}
      <p>{view.text}</p>
      {#each view.fields as f}
        <label>{f.label}{f.optional ? ' (optional)' : ''} <input type="number" step="0.01" inputmode="decimal" bind:value={answers[f.name]} /> {f.unit}</label>
      {/each}
      <button class="go" disabled={!askReady} onclick={next}>Continue</button>
    {:else if view.kind === 'review'}
      {#each view.notes as n}<p>{n}</p>{/each}
      {#if view.changes.length}
        {#each view.changes as c, i}
          <label class="change"><input type="checkbox" bind:checked={ticked[i]} /> {c.label}: <span class="mono">{c.old} → {c.new}</span></label>
        {/each}
        <button class="go" onclick={next}>Apply, restart and home</button>
      {:else}
        <p>Nothing to change.</p>
      {/if}
    {:else if view.kind === 'done'}
      <p>{view.summary.applied ? 'Applied. Put fresh tape on the same spots and run again to check the result.' : 'Nothing was changed.'}</p>
      <p class="mono">Tilt {view.summary.tiltMm} mm · Skew {view.summary.skewMm} mm</p>
    {:else if view.kind === 'error'}
      <p class="err">{view.text}</p>
    {/if}
  </section>

  <footer>
    <button onclick={cancel}>{view.kind === 'done' || view.kind === 'error' ? 'Close' : 'Cancel'}</button>
  </footer>
</dialog>

<style>
  dialog { width: min(100vw, 560px); max-width: 100vw; height: 100vh; max-height: 100vh; margin: 0 auto; padding: 0; border: 0; color: var(--text); background: var(--bg); }
  dialog::backdrop { background: rgb(0 0 0 / 0.5); }
  header { position: sticky; top: 0; display: flex; align-items: center; gap: 10px; padding: 10px 12px; padding-top: calc(10px + env(safe-area-inset-top)); background: var(--panel); border-bottom: 1px solid var(--line); }
  .state { padding: 4px 12px; border-radius: 999px; background: var(--btn); font-weight: 700; }
  .stop { margin-left: auto; min-height: 52px; padding: 0 24px; font-size: 18px; font-weight: 800; color: white; background: var(--bad); border-color: var(--bad); touch-action: none; }
  section { display: grid; gap: 12px; padding: 16px 12px; }
  footer { padding: 12px; }
  p { margin: 0; font-size: 16px; line-height: 1.4; }
  .muted { color: var(--muted); }
  .err { color: var(--bad); }
  .go { min-height: 56px; font-size: 18px; font-weight: 700; color: white; background: var(--ok); border-color: var(--ok); }
  label { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 15px; }
  .change { padding: 6px 0; }
  input[type='number'] { width: 120px; min-height: 44px; padding: 0 8px; font-size: 18px; border: 1px solid var(--line); border-radius: 10px; background: var(--panel); }
  input[type='checkbox'] { width: 22px; height: 22px; }
  @media (min-width: 900px) { dialog { height: auto; max-height: 90vh; margin: 5vh auto; border-radius: 14px; } }
</style>
```

- [ ] **Step 3: Add the Tools tab to `src/App.svelte`**

- Add `import Tools from './components/Tools.svelte'`.
- Change `TABS` to `[['jog', 'Jog'], ['job', 'Job'], ['tools', 'Tools'], ['more', 'More']]`.
- Add a section between the job and more sections:
```svelte
  <section class:off={tab !== 'tools'}>
    <Tools />
  </section>
```
- Tab bar: `grid-template-columns: repeat(4, 1fr)`.
- Desktop: the Tools section shares the third column with the console. Change the desktop media query to:
```css
  @media (min-width: 900px) {
    main { grid-template-columns: minmax(340px, 420px) minmax(0, 1fr) minmax(300px, 400px); padding-bottom: 12px; }
    main > section:nth-child(3), main > section:nth-child(4) { grid-column: 3; }
    .tabs { display: none; }
  }
```
and give the console a smaller height on desktop by changing `Console.svelte`'s desktop rule from `calc(100vh - 110px)` to `45vh`.

- [ ] **Step 4: Build, then run the routine against the fake (the controller does this step)**

`npm run build` must succeed. Then with the fake and dev server, on the Tools tab:
1. Set the gantry span to 1200 in Settings. Press Start calibration. The dialog opens with "Before you start"; Continue homes (1.5 s) and moves to corner A.
2. The jog step shows the pad; Continue.
3. "Corner A: tape and plate": the Probe button is disabled until `curl -X POST localhost:8081/fake/touch`; then Probe runs the probe, and "make the dot" appears; Continue makes the dot and moves on to B.
4. Repeat for B, C, D (touch each time).
5. Enter AC 2594.4, BD 2593.6 (and leave the sides blank). The review lists the Y pull-off changes (and Z ones if the probes differed); Apply writes the files, the fake restarts (the app reconnects), homes, and the dialog shows "Applied".
6. `curl 'localhost:8081/files?path=/'` lists `config.yaml` and `config.yaml.bak`; `$LocalFS/Show=/config.yaml` in the console shows the new pull-offs.
7. STOP during a move closes the routine with "Stopped"/a refused-command message, and the machine is Idle.

- [ ] **Step 5: Commit**

```bash
git add src/components/Tools.svelte src/components/Calibrate.svelte src/App.svelte src/components/Console.svelte
git commit -m "Add the Tools tab with settings and the Calibrate dialog"
```

---

### Task 9: Preview in machine coordinates, with the travel outline

**Files:**
- Modify: `src/components/Preview.svelte`, `src/App.svelte`

**Interfaces:**
- Consumes: `machine.status.mpos`, `machine.status.wpos`, `machine.status.wco` (from step 1's status parser: work = machine − wco) and `machine.config.range` (Task 5).
- Produces: `<Preview job current mpos wpos wco range />`. Everything is drawn in machine coordinates: the toolpath (work coordinates in the file) shifted by `wco`, the tool at `mpos`, and a dashed outline of the X/Y travel when `range` is known. Red/green still follow work Z. The view opens fitted to the travel rectangle; a double-tap or double-click toggles between fitting the table and fitting the job.

- [ ] **Step 1: Edit `src/components/Preview.svelte`**

a) Replace the props line and its comment with:
```js
  // Drawn in machine coordinates: the file's work coordinates shifted by the work offset `wco`, the tool at
  // `mpos`. `wpos` supplies the work Z for the red/green rule; `range` is the X/Y travel, if known.
  let { job = null, current = -1, mpos = [0, 0, 0], wpos = [0, 0, 0], wco = [0, 0, 0], range = null } = $props()
```

b) After the `sx`/`sy` helpers add:
```js
  const jx = x => sx(x + wco[0]) // a job (work) coordinate on screen
  const jy = y => sy(y + wco[1])
```

c) In `drawBase`, replace `if (!job) return` with:
```js
    if (range) { // the machine's reach
      ctx.setLineDash([6, 4])
      ctx.strokeStyle = colors.path
      ctx.lineWidth = 1
      ctx.strokeRect(sx(range.X.min), sy(range.Y.max), (range.X.max - range.X.min) * view.scale, (range.Y.max - range.Y.min) * view.scale)
      ctx.setLineDash([])
    }
    if (!job) return
```
and change the two `moveTo`/`lineTo` lines in `drawBase` to use `jx`/`jy`:
```js
        ctx.moveTo(jx(p[i * 3]), jy(p[i * 3 + 1]))
        ctx.lineTo(jx(p[i * 3 + 3]), jy(p[i * 3 + 4]))
```

d) In `drawTrail`, change its `moveTo`/`lineTo` lines the same way (`jx`/`jy`).

e) In `drawDot`, replace
```js
    const below = pos[2] < 0
    const x = sx(pos[0]), y = sy(pos[1])
```
with
```js
    const below = wpos[2] < 0
    const x = sx(mpos[0]), y = sy(mpos[1])
```
and change its `ctx.moveTo(sx(p[current * 3]), sy(p[current * 3 + 1]))` to `ctx.moveTo(jx(p[current * 3]), jy(p[current * 3 + 1]))`.

f) Replace the `fit` function with:
```js
  // Fit the travel rectangle, or the job (a double-tap toggles). Falls back to whichever exists, then to 100 mm.
  let fitMode = 'table'
  function fit() {
    const jb = job && job.bounds.minX <= job.bounds.maxX
      ? { minX: job.bounds.minX + wco[0], maxX: job.bounds.maxX + wco[0], minY: job.bounds.minY + wco[1], maxY: job.bounds.maxY + wco[1] }
      : null
    const tb = range ? { minX: range.X.min, maxX: range.X.max, minY: range.Y.min, maxY: range.Y.max } : null
    const b = (fitMode === 'table' ? tb ?? jb : jb ?? tb) ?? { minX: 0, minY: 0, maxX: 100, maxY: 100 }
    const w = Math.max(b.maxX - b.minX, 1), h = Math.max(b.maxY - b.minY, 1)
    view.scale = 0.9 * Math.min(size.w / w, size.h / h)
    view.ox = size.w / 2 - ((b.minX + b.maxX) / 2) * view.scale
    view.oy = size.h / 2 + ((b.minY + b.maxY) / 2) * view.scale
    redraw()
  }
  function toggleFit() {
    fitMode = fitMode === 'table' ? 'job' : 'table'
    fit()
  }
```

g) Replace the three effects with:
```js
  // A new file or a newly known travel: refit.
  $effect(() => {
    job
    range
    if (size.w) fit()
  })
  // A changed work offset moves the drawn toolpath (only when the values really changed: the array is renewed often).
  let drawnWco = ''
  $effect(() => {
    const w = wco.join(',')
    if (size.w && w !== drawnWco) {
      drawnWco = w
      redraw()
    }
  })
  // Progress: add newly finished segments to the trail (or start over if it went backwards).
  $effect(() => {
    current
    if (size.w && !raf) drawTrail(current < drawnTo ? -1 : drawnTo)
  })
  $effect(() => {
    mpos
    wpos
    current
    if (size.w && !raf) drawDot()
  })
```

h) In the markup, change `ondblclick={fit}` to `ondblclick={toggleFit}`, and the hint text to `Load a file to preview it here. Dashed line: the machine's reach.` only when `range` exists:
```svelte
  {#if !job}<p class="hint">{range ? 'Load a file to see it on the table' : 'Load a file to preview it here'}</p>{/if}
```

- [ ] **Step 2: Mount it with the new props in `src/App.svelte`**

Replace the `<Preview … />` line with:
```svelte
    <Preview job={job.data} current={job.current} mpos={machine.status.mpos} wpos={machine.status.wpos} wco={machine.status.wco} range={machine.config?.range} />
```

- [ ] **Step 3: Build and check against the fake (the controller does this step)**

`npm run build` must succeed with no new warnings. Then with the fake and dev server, after unlocking:
- The Job tab shows a dashed rectangle (the fake's config: X 3–1223, Y 3–2443) fitted to the view, with the green dot at the machine origin.
- Load `square.nc`: it is drawn near the origin, small. Double-click fits the job; double-click again fits the table.
- In the console, `G0 X100 Y200`, then press Zero on X and Y: the toolpath jumps so its origin sits under the dot (machine 100, 200). Run the job: the dot and trail follow it there.

- [ ] **Step 4: Commit**

```bash
git add src/components/Preview.svelte src/App.svelte
git commit -m "Draw the preview in machine coordinates with the travel outline"
```

---

### Task 10: Double-click a coordinate to move that axis

**Files:**
- Modify: `src/components/Dro.svelte` (as left by Task 7)

**Interfaces:**
- Consumes: `send`, `machine.status.wpos/mpos`, the `idle` and `run()` helpers Task 7 added.
- Produces: double-click (or double-tap) on the large work number turns it into an input pre-filled with the current value; Enter or **Go** sends `G0 <axis><value>`; Escape cancels. The small machine number does the same with `G53 G0 <axis><value>`. Only while idle.

- [ ] **Step 1: Edit `src/components/Dro.svelte`**

Add to the `<script>` block, after the `raise` helper:
```js
  // Double-click a number to type a destination for that axis: Enter or Go moves there, Escape cancels.
  let edit = $state(null) // { i, machineCoords, value }
  const focus = el => el.focus()
  function startEdit(i, machineCoords) {
    if (!idle || busy) return
    edit = { i, machineCoords, value: (machineCoords ? machine.status.mpos[i] : machine.status.wpos[i]).toFixed(3) }
  }
  function go() {
    const v = Number(edit.value)
    if (!Number.isFinite(v)) return
    const line = `${edit.machineCoords ? 'G53 ' : ''}G0 ${AXES[edit.i]}${v}`
    edit = null
    run('Moving…', () => send(line))
  }
  function editKey(e) {
    if (e.key === 'Enter') go()
    else if (e.key === 'Escape') edit = null
  }
```

Replace the row markup inside `{#each AXES as axis, i}` with:
```svelte
    <div class="row">
      <span class="axis">{axis}</span>
      {#if edit?.i === i}
        <span class="editor">
          <input class="mono" type="number" step="0.001" inputmode="decimal" bind:value={edit.value} onkeydown={editKey} use:focus />
          <button class="go" onclick={go}>Go</button>
        </span>
        <span class="mach">{edit.machineCoords ? 'machine' : 'work'}</span>
      {:else}
        <button class="plain work mono" ondblclick={() => startEdit(i, false)} title="Double-click to move here">{machine.status.wpos[i]?.toFixed(3)}</button>
        <button class="plain mach mono" ondblclick={() => startEdit(i, true)} title="Machine position. Double-click to move here">{machine.status.mpos[i]?.toFixed(3)}</button>
      {/if}
      <button disabled={!idle} onclick={() => send(`G10 L20 P0 ${axis}0`)}>Zero</button>
    </div>
```

Add to the `<style>`:
```css
  .plain { padding: 0; border: 0; background: none; border-radius: 6px; }
  .plain:active { background: var(--btn-active); }
  .editor { display: flex; gap: 6px; align-items: center; }
  .editor input { flex: 1; min-width: 0; min-height: 44px; padding: 0 8px; font-size: 22px; border: 1px solid var(--accent); border-radius: 10px; background: var(--bg); }
  .editor .go { color: white; background: var(--ok); border-color: var(--ok); }
```
(The existing `.work` and `.mach` rules keep their sizes and alignment; `.plain` only strips the button chrome.)

- [ ] **Step 2: Build and check against the fake (the controller does this step)**

`npm run build` must succeed with no new warnings (buttons, not spans, carry the double-click handlers, so no a11y warning). With the fake, after unlocking: double-click the X work number, type 50, Enter → the console shows `G0 X50` and X reads 50.000. Double-click the small machine number for Y, type 10, Go → `G53 G0 Y10`. Escape closes the editor without moving.

- [ ] **Step 3: Commit**

```bash
git add src/components/Dro.svelte
git commit -m "Double-click a coordinate to move that axis to a typed destination"
```

---

### Task 11: Tap the preview to send the router there

**Files:**
- Modify: `src/components/Preview.svelte` (as left by Task 9), `src/App.svelte`

**Interfaces:**
- Consumes: the Task 9 preview (machine coordinates, `range`), `send`, `machine.status`.
- Produces: `<Preview … canGo onGo />`. A tap or click (not a drag or pinch) drops a crosshair at that machine position and shows a "Go to X… Y…" button; pressing it calls `onGo(x, y)`. Tapping the crosshair again clears it; tapping elsewhere moves it. Taps outside the travel outline are ignored. `canGo` (idle, no job) gates both the crosshair and the button; the crosshair clears when `canGo` turns false. App.svelte sends `G53 G0 X… Y…` (XY only, at the current Z).

- [ ] **Step 1: Edit `src/components/Preview.svelte`**

a) Add `canGo = false, onGo = null` to the props: `let { job = null, current = -1, mpos = [0, 0, 0], wpos = [0, 0, 0], wco = [0, 0, 0], range = null, canGo = false, onGo = null } = $props()`.

b) After the `jx`/`jy` helpers add the inverse and the target state:
```js
  const mx = px => (px - view.ox) / view.scale // screen → machine
  const my = py => (view.oy - py) / view.scale
  let target = $state(null) // { x, y } machine coordinates of the tapped spot
  const TAP_PX = 8 // a press that moves less than this is a tap
```

c) In `drawDot`, before the tool circle (`ctx.beginPath()` / `ctx.arc(...)`), draw the crosshair:
```js
    if (target && canGo) {
      const tx = sx(target.x), ty = sy(target.y)
      ctx.beginPath()
      ctx.moveTo(tx - 10, ty); ctx.lineTo(tx + 10, ty)
      ctx.moveTo(tx, ty - 10); ctx.lineTo(tx, ty + 10)
      ctx.strokeStyle = colors.accent
      ctx.lineWidth = 2
      ctx.stroke()
    }
```
and add `accent: v('--accent')` to the `colors` object in `onMount`.

d) Pointer handling: replace `onpointerdown` and `onpointerup` with:
```js
  let press = null // where a single pointer went down, to tell a tap from a drag
  function onpointerdown(e) {
    box.setPointerCapture(e.pointerId)
    pointers.set(e.pointerId, local(e))
    press = pointers.size === 1 ? { id: e.pointerId, at: local(e) } : null
  }
  function onpointerup(e) {
    const p = pointers.get(e.pointerId)
    pointers.delete(e.pointerId)
    if (press?.id !== e.pointerId || !p) return
    const [x0, y0] = press.at
    press = null
    if (Math.hypot(p[0] - x0, p[1] - y0) > TAP_PX) return
    tap(p)
  }
  function onpointercancel(e) {
    pointers.delete(e.pointerId)
    press = null
  }
  function tap([px, py]) {
    if (!canGo) return
    if (target && Math.hypot(sx(target.x) - px, sy(target.y) - py) < 16) { // tapping the crosshair clears it
      target = null
      return
    }
    const x = mx(px), y = my(py)
    if (range && (x < range.X.min || x > range.X.max || y < range.Y.min || y > range.Y.max)) return // outside the reach
    target = { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 }
  }
  function goToTarget() {
    const t = target
    target = null
    onGo?.(t.x, t.y)
  }
```
Note `onpointermove` must also cancel a press that turned into a pinch: at the top of the `after.length === 2` branch add `press = null`.

e) Effects: add
```js
  $effect(() => { if (!canGo) target = null })
  $effect(() => {
    target
    if (size.w && !raf) drawDot()
  })
```

f) Markup: change `onpointercancel={onpointerup}` to `onpointercancel={onpointercancel}`, and add inside the `.preview` div, before the hint:
```svelte
  {#if target && canGo}
    <button class="goto" onclick={goToTarget}>Go to X {target.x} Y {target.y}</button>
  {/if}
```
with the style:
```css
  .goto { position: absolute; left: 50%; bottom: 12px; transform: translateX(-50%); min-height: 48px; padding: 0 18px; font-weight: 700; color: white; background: var(--accent); border-color: var(--accent); }
```

- [ ] **Step 2: Wire it in `src/App.svelte`**

Replace the `<Preview … />` line with:
```svelte
    <Preview
      job={job.data}
      current={job.current}
      mpos={machine.status.mpos}
      wpos={machine.status.wpos}
      wco={machine.status.wco}
      range={machine.config?.range}
      canGo={machine.conn === 'open' && machine.status.state === 'Idle' && !machine.status.sd}
      onGo={(x, y) => send(`G53 G0 X${x} Y${y}`)}
    />
```
(`send` is already imported in App.svelte? If not, add it to the import from `./lib/machine.svelte.js`.)

- [ ] **Step 3: Build and check against the fake (the controller does this step)**

`npm run build` must succeed. With the fake, after unlocking: a click inside the dashed rectangle shows a crosshair and the "Go to X … Y …" button; pressing it moves the dot there (console: `G53 G0 X… Y…`); clicking the crosshair clears it; dragging does not create one; a click outside the rectangle does nothing; while a job runs, no crosshair appears.

- [ ] **Step 4: Commit**

```bash
git add src/components/Preview.svelte src/App.svelte
git commit -m "Tap the preview to send the router to that spot"
```

---

### Task 12: Job progress by time, with a time-left estimate that learns

**Files:**
- Modify: `src/lib/track.js`, `src/lib/track.test.js`, `src/lib/job.svelte.js`, `src/components/Job.svelte`

**Interfaces:**
- Consumes: the job shape (`pts`, `time`), `job.current`, `machine.status.sd/wpos`.
- Produces:
  - `along(job, i, pos): number` — how far along segment `i` the tool is, 0..1 (1 for a zero-length segment, 0 when `i < 0`).
  - `progress(job, i, u, elapsed, ratio): { fraction, left, ratio, learning }` — `fraction` is estimated time done ÷ total (progress by time, not by file bytes); `left` is the remaining estimate scaled by `ratio`, the smoothed real-time ÷ estimated-time factor (null, i.e. 1, until 30 s of estimated time has run; then an exponential average moving a tenth of the way per update); `learning` is true while the ratio is still unknown.
  - `job.along` (set with `job.current` by the follower). `remaining()` is removed.
  - The Job panel shows the time-based percent, the elapsed time, and the time left, marked `~` while learning and rounded to 10 s once over two minutes. Without parsed G-code it falls back to FluidNC's byte percent.
- Why: FluidNC's `SD:` percent is the file read position, which runs ahead of the cut and measures bytes, not time; and the previous time-left switched formulas at 30 s and reacted to every blip, so it rose and fell.

- [ ] **Step 1: Write the failing tests**

In `src/lib/track.test.js`, change the import to `import { currentSegment, along, progress } from './track.js'`, delete the `remaining time …` test, and add:
```js
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
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --disable-warning=ExperimentalWarning --test src/lib/track.test.js`
Expected: FAIL (`along`/`progress` are not exported).

- [ ] **Step 3: Implement in `src/lib/track.js`**

Delete `remaining` and append:
```js
// How far along segment i the tool is (0..1), for smooth progress inside long moves.
export function along(job, i, [x, y, z]) {
  if (i < 0) return 0
  const p = job.pts
  const ax = p[i * 3], ay = p[i * 3 + 1], az = p[i * 3 + 2]
  const dx = p[i * 3 + 3] - ax, dy = p[i * 3 + 4] - ay, dz = p[i * 3 + 5] - az
  const len2 = dx * dx + dy * dy + dz * dz
  return len2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy + (z - az) * dz) / len2)) : 1
}

// Progress by estimated time, and a time-left estimate that learns how fast the job really runs.
// `ratio` (real time ÷ estimated time) is carried between calls, smoothed, and unknown until enough has run.
const LEARN_AFTER_S = 30
const SMOOTH = 0.1

export function progress(job, i, u, elapsed, ratio) {
  const total = job.time.at(-1) ?? 0
  const start = i > 0 ? job.time[i - 1] : 0
  const done = i < 0 ? 0 : start + u * (job.time[i] - start)
  if (done > LEARN_AFTER_S && elapsed > 0) {
    const r = elapsed / done
    ratio = ratio == null ? r : ratio + SMOOTH * (r - ratio)
  }
  return { fraction: total ? done / total : 0, left: Math.max(0, (total - done) * (ratio ?? 1)), ratio, learning: ratio == null }
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --disable-warning=ExperimentalWarning --test src/lib/track.test.js`
Expected: PASS, 9 tests.

- [ ] **Step 5: Track `along` in `src/lib/job.svelte.js`**

- Import: `import { currentSegment, along } from './track.js'`.
- Add `along: 0,` to the `job` state object (after `current: -1,`).
- In the follower, after `job.current = currentSegment(job.data, s.sd.percent, s.wpos, job.current)`, add:
```js
      job.along = along(job.data, job.current, s.wpos)
```
- Where a job starts (`job.current = -1` in the `!wasRunning` branch) also set `job.along = 0`.

- [ ] **Step 6: Show it in `src/components/Job.svelte`**

- Import `progress` instead of `remaining`: `import { progress } from '../lib/track.js'`.
- Replace the `onMount` block and the `total`/`left` deriveds with:
```js
  let est = $state(null) // the latest progress estimate, updated once a second while a job runs
  onMount(() => {
    refresh()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  })
  function tick() {
    now = Date.now()
    if (!job.data || !machine.status.sd || !job.startedAt) {
      est = null
      return
    }
    est = progress(job.data, job.current, job.along, (now - job.startedAt) / 1000, est?.ratio ?? null)
  }
  const total = $derived(job.data?.time.at(-1) ?? 0)
  const fraction = $derived(est?.fraction ?? (s.sd ? s.sd.percent / 100 : 0))
  const eta = sec => (sec > 120 ? Math.round(sec / 10) * 10 : Math.round(sec)) // steadier once it is minutes
```
- Replace the progress block in the markup with:
```svelte
  {#if running}
    <progress max="1" value={fraction}></progress>
    <div class="times mono">
      <span>{Math.round(fraction * 100)}%</span>
      <span>{clock(elapsed)} gone</span>
      <span>{est ? `${est.learning ? '~' : ''}${clock(eta(est.left))} left` : '…'}</span>
    </div>
  {/if}
```

- [ ] **Step 7: Build and check against the fake (the controller does this step)**

`npm run build` must succeed. Run a job on the fake: the percent climbs smoothly with the cut (not in jumps as the file is read), the time left starts with `~`, and after 30 s of estimated time it settles rather than rising and falling.

- [ ] **Step 8: Commit**

```bash
git add src/lib/track.js src/lib/track.test.js src/lib/job.svelte.js src/components/Job.svelte
git commit -m "Show job progress by time and a time-left estimate that learns the real speed"
```

---

### Task 13: In-app confirmation dialog

**Files:**
- Create: `src/lib/confirm.svelte.js`, `src/components/ConfirmDialog.svelte`
- Modify: `src/components/Job.svelte` (as left by Task 12), `src/App.svelte` (as left by Task 11)

**Interfaces:**
- Produces:
  - `confirm({ title, text?, ok?, danger? }): Promise<boolean>` from `src/lib/confirm.svelte.js`, plus `pending` ($state holding the open request) and `settle(answer)`.
  - `<ConfirmDialog />`, mounted once in App.svelte: a native `<dialog>` styled with the app's tokens; Cancel, backdrop click and Escape resolve `false`; the OK button (green, or red when `danger`) resolves `true`.
  - Job.svelte's Run and Delete use it instead of the browser's `window.confirm`.

- [ ] **Step 1: Write `src/lib/confirm.svelte.js`**

```js
// An in-app confirmation. `confirm({ title, text, ok })` resolves true when the user presses the OK button.
export const pending = $state({ req: null })

export function confirm({ title, text = '', ok = 'OK', danger = false }) {
  return new Promise(resolve => {
    pending.req = { title, text, ok, danger, resolve }
  })
}

export function settle(answer) {
  const r = pending.req
  pending.req = null
  r?.resolve(answer)
}
```

- [ ] **Step 2: Write `src/components/ConfirmDialog.svelte`**

```svelte
<script>
  import { pending, settle } from '../lib/confirm.svelte.js'

  let dialog
  $effect(() => {
    if (pending.req) dialog.showModal()
    else if (dialog?.open) dialog.close()
  })
</script>

<dialog bind:this={dialog} oncancel={e => { e.preventDefault(); settle(false) }} onclick={e => e.target === dialog && settle(false)}>
  {#if pending.req}
    <div class="box">
      <h2>{pending.req.title}</h2>
      {#if pending.req.text}<p>{pending.req.text}</p>{/if}
      <div class="actions">
        <button onclick={() => settle(false)}>Cancel</button>
        <button class:danger={pending.req.danger} class:go={!pending.req.danger} onclick={() => settle(true)}>{pending.req.ok}</button>
      </div>
    </div>
  {/if}
</dialog>

<style>
  dialog { width: min(92vw, 420px); padding: 0; border: 1px solid var(--line); border-radius: 14px; color: var(--text); background: var(--panel); }
  dialog::backdrop { background: rgb(0 0 0 / 0.5); }
  .box { display: grid; gap: 12px; padding: 20px; }
  h2 { margin: 0; font-size: 18px; }
  p { margin: 0; font-size: 15px; line-height: 1.4; color: var(--muted); }
  .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .actions button { min-height: 48px; font-weight: 700; }
  .go { color: white; background: var(--ok); border-color: var(--ok); }
  .danger { color: white; background: var(--bad); border-color: var(--bad); }
</style>
```
(The backdrop click works because the dialog has no padding: a click on the box lands on a child, a click outside lands on the dialog itself.)

- [ ] **Step 3: Use it in `src/components/Job.svelte`**

- Add `import { confirm as ask } from '../lib/confirm.svelte.js'`.
- Replace the Run button's handler `onclick={() => confirm(`Run ${job.name}? Check the bit and work zero first.`) && run()}` with:
```svelte
onclick={async () => (await ask({ title: `Run ${job.name}?`, text: 'Check the bit, the work zero, and that the area is clear.', ok: 'Run' })) && run()}
```
- Replace the delete button's handler `onclick={() => confirm(`Delete ${f.name} from the SD card?`) && remove(f.name)}` with:
```svelte
onclick={async () => (await ask({ title: `Delete ${f.name}?`, text: 'It is removed from the SD card.', ok: 'Delete', danger: true })) && remove(f.name)}
```

- [ ] **Step 4: Mount it in `src/App.svelte`**

Add `import ConfirmDialog from './components/ConfirmDialog.svelte'` and put `<ConfirmDialog />` on the line after `<TopBar />`.

- [ ] **Step 5: Build and check against the fake (the controller does this step)**

`npm run build` must succeed with no new warnings. Pressing Run shows the in-app dialog (title, text, Cancel, green Run); Escape, the backdrop and Cancel do nothing; Run starts the job. The delete ✕ shows a red Delete button and removes the file.

- [ ] **Step 6: Commit**

```bash
git add src/lib/confirm.svelte.js src/components/ConfirmDialog.svelte src/components/Job.svelte src/App.svelte
git commit -m "Replace browser confirm() with an in-app dialog"
```

---

### Task 14: SD card browser with folders

**Files:**
- Modify: `src/lib/files.js`, `src/lib/files.test.js`, `src/lib/job.svelte.js`, `src/components/Job.svelte`, `dev/fake-fluidnc.js`, `dev/fake-fluidnc.test.js`
- Create: `src/components/FileBrowser.svelte`

**Interfaces:**
- Paths are relative to the card's root with no leading slash: `''` is the root, `'jobs'` a folder, `'jobs/part.nc'` a file. `job.name` holds the open file's path; FluidNC's `SD:/sd/jobs/part.nc` maps to it through `baseName`.
- `sdFiles(base)` becomes: `list(dir = '')`, `mkdir(dir, name)` (FluidNC's `action=createdir`), `remove(dir, name, isDir = false)` (`action=delete` / `action=deletedir`), `download(path)` (text, for the preview), `url(path)` (the `/sd/…` link for saving a copy), `upload(file, dir = '', onProgress)`. FluidNC lists a folder with `/upload?path=/jobs/`, creates and deletes `filename` inside `path`, takes the upload's full path from the part's file name (`/jobs/part.nc`), and serves `/sd/jobs/part.nc`. Moving and renaming files is deferred (TODO).
- `job`: `dir` (the browser's current folder), `files` (that folder's entries). `refresh(dir)`, `mkdir(dir, name)`, `upload(file, dir)`, `remove(dir, name, isDir)`, `load(path, size?, text?)` keep their guards from the fix wave (`idleNoJob`, `badName`, overwrite confirmation).
- `<FileBrowser onclose />`: a `<dialog>` showing the current folder (path line, Up, folders first, then files with sizes), a selected entry, **Open** (loads the selected file and closes), **Upload here** (with progress), **New folder** (reveals a name box and a Create button), **Download** (saves a copy of the selected file through the `/sd/…` link; FluidNC 3.x refuses it while the machine moves), **Delete** (asks first), **Close**. Opened from the Job panel's **Open…** button; the panel itself shows only the open file.
- The fake's SD card gains folders: `GET /upload?path=/&action=createdir&filename=jobs` creates one; listings are per folder; `deletedir` removes a folder and its contents; uploads into a folder that does not exist fail with `"Upload failed"`.

- [ ] **Step 1: Write the failing tests**

`src/lib/files.test.js`: replace the third test ("lists, downloads and deletes files on the fake controller") with:
```js
test('folders: list, upload into, download from and delete in a folder on the fake controller', async () => {
  const server = start(8095)
  try {
    const sd = sdFiles('http://localhost:8095')
    assert.deepEqual(await sd.mkdir('', 'jobs'), [{ name: 'jobs', size: -1, dir: true }])
    assert.equal(sd.url('jobs/a.nc'), 'http://localhost:8095/sd/jobs/a.nc')
    const form = new FormData() // the same request upload() sends from the browser, into the folder
    form.append('/jobs/a.ncS', '5')
    form.append('myfile', new Blob(['G0 X1']), '/jobs/a.nc')
    assert.equal((await fetch('http://localhost:8095/upload', { method: 'POST', body: form })).status, 200)
    assert.deepEqual(await sd.list('jobs'), [{ name: 'a.nc', size: 5, dir: false }])
    assert.equal(await sd.download('jobs/a.nc'), 'G0 X1')
    assert.deepEqual(await sd.remove('jobs', 'a.nc'), [])
    assert.deepEqual(await sd.remove('', 'jobs', true), [])
  } finally {
    server.close()
  }
})
```

`dev/fake-fluidnc.test.js`: add
```js
test('the SD card has folders: per-folder listings, deletedir, and uploads need the folder', async () => {
  const server = start(8089)
  try {
    const list = async dir => (await (await fetch(`http://localhost:8089/upload?path=${encodeURIComponent('/' + (dir ? dir + '/' : ''))}`)).json()).files.map(f => `${f.name}:${f.size}`)
    await fetch('http://localhost:8089/upload?path=%2F&action=createdir&filename=jobs')
    const up = async (path, text) => { const f = new FormData(); f.append(path + 'S', String(text.length)); f.append('myfile', new Blob([text]), path); return (await (await fetch('http://localhost:8089/upload', { method: 'POST', body: f })).json()).status }
    assert.equal(await up('/jobs/a.nc', 'G0 X1'), 'Ok')
    assert.equal(await up('/nope/b.nc', 'G0 X1'), 'Upload failed')
    assert.deepEqual(await list(''), ['jobs:-1'])
    assert.deepEqual(await list('jobs'), ['a.nc:5'])
    await fetch('http://localhost:8089/upload?path=%2F&action=deletedir&filename=jobs')
    assert.deepEqual(await list(''), [])
  } finally {
    server.close()
  }
})
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm test` — the two new tests FAIL (the fake has no folders; `list(dir)` ignores its argument).

- [ ] **Step 3: Teach the fake about folders (`dev/fake-fluidnc.js`)**

- Next to `const sd = new Map()` add `const dirs = new Set() // folders on the fake SD card, as paths without slashes at either end`.
- Helpers:
```js
  const norm = p => (p ?? '/').replace(/^\/+|\/+$/g, '') // '/jobs/' → 'jobs', '/' → ''
  const parent = p => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
  const entriesOf = dir => [
    ...[...dirs].filter(d => parent(d) === dir).map(d => ({ name: d.slice(dir ? dir.length + 1 : 0), shortname: d, size: -1, datetime: '' })),
    ...[...sd].filter(([p]) => parent(p) === dir).map(([p, buf]) => ({ name: p.slice(dir ? dir.length + 1 : 0), shortname: p, size: buf.length, datetime: '' })),
  ]
```
- Replace `listingOf(sd)` uses for `/upload` with a listing built from `entriesOf(norm(url.searchParams.get('path')))` and the same footer fields; keep `listingOf(flash)` for `/files`.
- `/upload` GET actions, with `dir = norm(path)` and `name = url.searchParams.get('filename')`: `createdir` → `dirs.add(dir ? `${dir}/${name}` : name)`; `delete` → `sd.delete(dir ? `${dir}/${name}` : name)`; `deletedir` → remove that folder, every folder under it and every file under it. Status strings as FluidNC: `"<name> created"`, `"<name> deleted"`, else `"Ok"`.
- `/upload` POST: for each file part, `const p = v.name.replace(/^\//, '')`; if `parent(p)` is not `''` and not in `dirs`, respond with the listing whose `status` is `"Upload failed"` and store nothing; else store under `p`.
- `/sd/<path>` already decodes the whole remainder: keep.

- [ ] **Step 4: `src/lib/files.js`**

Replace `sdFiles` with:
```js
export function sdFiles(base = '') {
  async function get(url) {
    const r = await fetch(base + url)
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r
  }
  const q = encodeURIComponent
  const dirParam = dir => q('/' + (dir ? dir + '/' : '')) // FluidNC wants /jobs/ for a folder
  const dirPath = (dir, name) => '/' + (dir ? dir + '/' : '') + name
  return {
    list: async (dir = '') => parseList(await (await get(`/upload?path=${dirParam(dir)}`)).json()),
    mkdir: async (dir, name) => parseList(await (await get(`/upload?path=${dirParam(dir)}&action=createdir&filename=${q(name)}`)).json()),
    url: path => `${base}/sd/${path.split('/').map(q).join('/')}`, // for a download link; 3.x refuses it while moving
    remove: async (dir, name, isDir = false) =>
      parseList(await (await get(`/upload?path=${dirParam(dir)}&action=${isDir ? 'deletedir' : 'delete'}&filename=${q(name)}`)).json()),
    download: async path => (await get(`/sd/${path.split('/').map(q).join('/')}`)).text(),
    // XHR rather than fetch, because only XHR reports upload progress
    upload: (file, dir = '', onProgress = () => {}) =>
      new Promise((resolve, reject) => {
        const path = dirPath(dir, file.name)
        const form = new FormData()
        form.append(path + 'S', String(file.size)) // before the file: FluidNC reads it when the upload starts
        form.append('myfile', file, path)
        const xhr = new XMLHttpRequest()
        xhr.open('POST', base + '/upload')
        xhr.upload.onprogress = e => e.lengthComputable && onProgress(e.loaded / e.total)
        xhr.onload = () => {
          if (xhr.status !== 200) return reject(new Error(`Upload failed: HTTP ${xhr.status}`))
          try {
            resolve(parseList(JSON.parse(xhr.responseText)))
          } catch (e) {
            reject(e)
          }
        }
        xhr.onerror = () => reject(new Error('Upload failed: network error'))
        xhr.send(form)
      }),
  }
}
```
and change the header comment's `ponytail:` line to `// ponytail: no move or rename yet (TODO).`

- [ ] **Step 5: `src/lib/job.svelte.js`**

- Add `dir: ''` to the `job` state.
- `refresh(dir = job.dir)`: `job.files = await sd.list(dir); job.dir = dir` (error handling as before).
- `upload(file, dir = job.dir)`: keep the fix wave's guards; call `sd.upload(file, dir, p => …)`, then `load(dirPath, file.size, await file.text())` where the path is `dir ? `${dir}/${file.name}` : file.name`; the overwrite check looks at `job.files` (the current folder).
- `remove(dir, name, isDir = false)`: `job.files = await sd.remove(dir, name, isDir)`.
- `mkdir(dir, name)`: refuse a `badName(name)` or a name containing `/` with `job.error`; otherwise `job.files = await sd.mkdir(dir, name)` (errors into `job.error`).
- export `sdUrl = path => sd.url(path)` for the browser's Download link.
- `load(path, size, text)`: unchanged apart from the parameter name; the cache key is the path.
- `run()`: unchanged (`$SD/Run=/${job.name}` is now a full path).

- [ ] **Step 6: `src/components/FileBrowser.svelte`**

```svelte
<script>
  import { onMount } from 'svelte'
  import { machine } from '../lib/machine.svelte.js'
  import { job, refresh, load, upload, remove, mkdir, badName, sdUrl } from '../lib/job.svelte.js'
  import { confirm as ask } from '../lib/confirm.svelte.js'

  let { onclose } = $props()
  let dialog
  let picker
  let selected = $state(null) // entry in the current folder
  let newFolder = $state(null) // the name being typed, or null when the box is hidden
  const busy = $derived(machine.conn !== 'open' || machine.status.state !== 'Idle' || job.running || job.upload !== null)
  const entries = $derived([...job.files].sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name)))
  const pathOf = e => (job.dir ? `${job.dir}/${e.name}` : e.name)
  const size = n => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`)

  onMount(() => {
    dialog.showModal()
    refresh(job.dir)
  })
  async function go(dir) {
    selected = null
    await refresh(dir)
  }
  const up = () => go(job.dir.includes('/') ? job.dir.slice(0, job.dir.lastIndexOf('/')) : '')
  function tap(e) {
    if (e.dir) go(pathOf(e))
    else selected = e
  }
  async function open() {
    if (!selected || selected.dir) return
    await load(pathOf(selected), selected.size)
    onclose()
  }
  async function del() {
    const e = selected
    if (!e) return
    if (!(await ask({ title: `Delete ${e.name}?`, text: e.dir ? 'The folder and everything in it is removed from the SD card.' : 'It is removed from the SD card.', ok: 'Delete', danger: true }))) return
    selected = null
    await remove(job.dir, e.name, e.dir)
  }
  function pick(ev) {
    const file = ev.currentTarget.files[0]
    ev.currentTarget.value = ''
    if (file) upload(file, job.dir)
  }
  async function create() {
    const name = newFolder.trim()
    if (!name) return
    await mkdir(job.dir, name)
    if (!job.error) newFolder = null
  }
</script>

<dialog bind:this={dialog} oncancel={e => { e.preventDefault(); onclose() }}>
  <header>
    <button onclick={up} disabled={!job.dir}>↑ Up</button>
    <span class="path mono">/{job.dir}</span>
    <button onclick={onclose}>Close</button>
  </header>
  <section>
    {#each entries as e (e.name)}
      <button class="entry" class:on={selected === e} class:dir={e.dir} class:bad={!e.dir && badName(pathOf(e))} ondblclick={() => !e.dir && selected === e && open()} onclick={() => tap(e)} title={!e.dir && badName(pathOf(e)) ? 'FluidNC cannot run this name: rename it' : ''}>
        <span class="name">{e.dir ? '📁 ' : ''}{e.name}</span>
        {#if !e.dir}<span class="muted mono">{size(e.size)}</span>{/if}
      </button>
    {:else}
      <p class="muted">Empty folder.</p>
    {/each}
    {#if job.upload !== null}<progress max="1" value={job.upload}></progress>{/if}
    {#if newFolder !== null}
      <div class="newfolder">
        <input type="text" placeholder="Folder name" bind:value={newFolder} onkeydown={e => { if (e.key === 'Enter') create(); else if (e.key === 'Escape') newFolder = null }} />
        <button class="go" onclick={create}>Create</button>
      </div>
    {/if}
    {#if job.error}<p class="err">{job.error}</p>{/if}
  </section>
  <footer>
    <button disabled={busy} onclick={() => picker.click()}>Upload here</button>
    <input type="file" accept=".nc,.gcode,.ngc,.tap,.cnc,.txt" hidden bind:this={picker} onchange={pick} />
    <button disabled={busy} onclick={() => (newFolder = newFolder === null ? '' : null)}>New folder</button>
    {#if selected && !selected.dir}<a class="button" href={sdUrl(pathOf(selected))} download={selected.name}>Download</a>{/if}
    <button disabled={busy || !selected} onclick={del}>Delete</button>
    <button class="go" disabled={busy || !selected || selected.dir || badName(pathOf(selected))} onclick={open}>Open</button>
  </footer>
</dialog>

<style>
  dialog { width: min(100vw, 560px); max-width: 100vw; height: 100vh; max-height: 100vh; margin: 0 auto; padding: 0; border: 0; display: grid; grid-template-rows: auto 1fr auto; color: var(--text); background: var(--bg); }
  dialog:not([open]) { display: none; }
  dialog::backdrop { background: rgb(0 0 0 / 0.5); }
  header, footer { display: flex; gap: 8px; align-items: center; padding: 10px 12px; background: var(--panel); border-bottom: 1px solid var(--line); }
  footer { border-bottom: 0; border-top: 1px solid var(--line); }
  .path { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; color: var(--muted); }
  section { overflow-y: auto; display: grid; align-content: start; gap: 4px; padding: 8px 12px; }
  .entry { display: grid; grid-template-columns: 1fr auto; gap: 8px; min-height: 48px; text-align: left; }
  .entry.on { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 15%, var(--btn)); }
  .entry.bad .name { color: var(--muted); text-decoration: line-through; }
  .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .muted { margin: 0; font-size: 13px; color: var(--muted); }
  .err { margin: 0; color: var(--bad); }
  .go { margin-left: auto; color: white; background: var(--ok); border-color: var(--ok); }
  .newfolder { display: grid; grid-template-columns: 1fr auto; gap: 8px; }
  .newfolder input { min-height: 44px; padding: 0 10px; font-size: 16px; border: 1px solid var(--accent); border-radius: 10px; background: var(--panel); }
  .newfolder .go { margin-left: 0; }
  a.button { display: inline-flex; align-items: center; min-height: 44px; padding: 0 14px; border: 1px solid var(--line); border-radius: 10px; background: var(--btn); color: inherit; text-decoration: none; }
  footer { flex-wrap: wrap; }
  @media (min-width: 900px) { dialog { height: 80vh; max-height: 80vh; margin: 10vh auto; border-radius: 14px; } }
</style>
```

- [ ] **Step 7: `src/components/Job.svelte`**

- Import `FileBrowser` and add `let browsing = $state(false)`.
- Remove the whole `.files` block (file head, upload progress, the list and its empty state), the `picker`/`pick` code and the `upload`/`remove`/`refresh` imports that are no longer used (keep `load`/`run`/`pause`/`resume`).
- Replace the `.head` block with:
```svelte
  <div class="head">
    <div>
      <strong>{job.name || 'No file open'}</strong>
      {#if job.data}<span class="muted"> · about {clock(total)}</span>{/if}
    </div>
    <button disabled={!idle || job.running} onclick={() => (browsing = true)}>Open…</button>
  </div>
  {#if browsing}<FileBrowser onclose={() => (browsing = false)} />{/if}
```
- Drop the now-unused `.files`, `.filehead`, `.file`, `.name` styles. `onMount` no longer calls `refresh()`.

- [ ] **Step 8: Build, tests, browser check (the controller does the browser part)**

`npm test` (all passing, process exits) and `npm run build` (no new warnings; compile-check FileBrowser.svelte directly). With the fake: open the browser, New folder → `jobs` → Create, enter `jobs`, upload there, open the file (the panel shows `jobs/<name>`), Run works (`$SD/Run=/jobs/<name>`), the progress follows; Download saves a copy; Delete asks and removes; Up returns to the root.

- [ ] **Step 9: Commit**

```bash
git add src/lib/files.js src/lib/files.test.js src/lib/job.svelte.js src/components/Job.svelte src/components/FileBrowser.svelte dev
git commit -m "SD card browser with folders; the Job panel shows only the open file"
```

---

### Task 15: On the machine (done by the user, hands near the e-stop)

- [ ] **Step 1: Probe Z0.** With the plate on the stock and the clip on: tap, Probe Z0, and check the work Z reads the plate thickness at contact, then 5 mm higher.
- [ ] **Step 2: A calibration pass.** Set the gantry span. Tape at the four corners. Run the routine and measure. Before pressing Apply, compare the review's numbers with what you'd expect; untick anything doubtful. After the restart and home, check `config.yaml.bak` exists on the flash (More → Console: `$LocalFS/List`).
- [ ] **Step 3: A second pass** with fresh tape to confirm the error shrank. If it grew, the next pass swaps the motor-side setting by itself.
- [ ] **Step 4: Restore if needed.** From the console: `$LocalFS/Delete=/config.yaml`, then upload `config.yaml.bak` as `config.yaml` with the stock WebUI, then `$Bye`.
