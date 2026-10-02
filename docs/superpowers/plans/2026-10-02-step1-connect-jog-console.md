# HighRoller Step 1: Connect, Readout, Jog, Console — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A HighRoller web app that connects to FluidNC over its websocket, shows live position, jogs safely by tap or hold, zeroes axes, raises STOP, explains alarms, and has a raw console. A fake FluidNC server makes development possible without the machine.

**Architecture:**
- **Protocol:** `src/lib/` holds plain-JS modules: a status parser, a websocket client with a one-line-at-a-time command queue, and a jogger. They can be tested in Node with no browser.
- **App state:** one Svelte 5 module (`machine.svelte.js`) wraps the client as reactive state.
- **UI:** four small components (top bar, readout, jog pad, console) build a page that works on phones and desktops.
- **Fake machine:** `dev/fake-fluidnc.js` speaks enough of FluidNC's protocol to drive the UI.

**Tech Stack:** Svelte 5, Vite, vite-plugin-singlefile, Node 22 `node:test`, `ws` (dev only).

**Spec:** `docs/superpowers/specs/2026-10-02-highroller-design.md`. This plan is build-order step 1, plus the per-axis "Zero here" buttons.

## Global Constraints

- **Language and libraries:**
  - Svelte 5 with runes, plus Vite.
  - Plain JavaScript, no TypeScript.
  - No UI library and no runtime dependencies.
  - Dev dependencies: `vite`, `@sveltejs/vite-plugin-svelte`, `svelte`, `vite-plugin-singlefile`, `ws`.
- **Build output:** one file, `dist/index.html.gz` (singlefile build, then `gzip -9`). Target under 100 KB.
- **Tests:**
  - `node --test` only (Node ≥ 22). No test framework.
  - Each test file sits beside its module as `*.test.js`.
- **Protocol boundary:** only `src/lib/fluidnc.js` sends to or reads from the websocket.
- **Safety:**
  - Never queue motion while disconnected: `send()` refuses at once.
  - Hold-to-jog keeps at most about 0.35 s of motion queued.
  - STOP is always on screen.
- **FluidNC facts** (verified in source, see the spec's "Talking to FluidNC"):
  - Websocket: 4.x at `ws://host/`, 3.x at `ws://host:81/` (subprotocol `arduino`).
  - Output arrives as binary frames; text frames are control messages and are ignored.
  - Real-time bytes are sent as one-character strings; codes ≥ 0x80 go out as UTF-8.
  - `$RI=100` turns on auto-reporting, but reports only come while moving or when something changes.
- **UI:**
  - Touch targets at least 44 px, jog buttons at least 72 px.
  - Light and dark themes follow `prefers-color-scheme`.
  - Phone layout below 900 px wide, dashboard layout at 900 px and above.
- **Comments:** short, and only where they explain why. Mark deliberate simplifications with a `ponytail:` comment that names the limit.

## File Structure

| File | Responsibility |
|---|---|
| `package.json`, `vite.config.js`, `index.html`, `.gitignore` | Project scaffold and single-file build |
| `src/main.js` | Mounts the app |
| `src/app.css` | Theme tokens and base element styles |
| `src/lib/status.js` | `parseStatus()`, `EMPTY`, `ALARMS` (plain-language alarm text) |
| `src/lib/fluidnc.js` | `FluidNC` class: connect and reconnect, framing, command queue, real-time bytes, watchdog |
| `src/lib/jog.js` | `createJogger()`: tap steps and hold-to-jog runway |
| `src/lib/machine.svelte.js` | Reactive `machine` state, shared `fnc` and `jogger`, `send()`, `stop()` |
| `src/lib/settings.svelte.js` | Per-device settings (step, jog speeds) saved in localStorage |
| `src/App.svelte` | Layout: top bar, Jog and More sections, phone tab bar |
| `src/components/TopBar.svelte` | Connection badge, machine state, STOP, alarm and reconnect banners |
| `src/components/Dro.svelte` | Work and machine position, per-axis Zero |
| `src/components/JogPad.svelte` | Step sizes, XY pad and Z rocker, tap and hold, keyboard, speed sliders |
| `src/components/Console.svelte` | Log of machine output plus a command input |
| `dev/fake-fluidnc.js` | Pretend FluidNC on port 8081 for development |

---

### Task 1: Scaffold and status-report parser

**Files:**
- Create: `package.json`, `vite.config.js`, `index.html`, `.gitignore`, `src/main.js`, `src/app.css`, `src/App.svelte`
- Create: `src/lib/status.js`
- Test: `src/lib/status.test.js`

**Interfaces:**
- Produces:
  - `parseStatus(line: string, prev?: Status): Status`
  - `EMPTY: Status`
  - `ALARMS: Record<number, string>`
  - The `Status` object has these fields:

    | Field | Type | Notes |
    |---|---|---|
    | `state` | string | |
    | `sub` | number or null | |
    | `mpos` | number[] | machine position |
    | `wpos` | number[] | work position |
    | `wco` | number[] | work offset |
    | `feed` | number | |
    | `spindle` | number | |
    | `ov` | [feed%, rapid%, spindle%] | overrides |
    | `acc` | string | `'S'`, `'C'`, `'F'`, `'M'` flags |
    | `pins` | string | e.g. `'P'` for probe |
    | `sd` | `{percent, file}` or null | job progress |

- [ ] **Step 1: Write the scaffold files**

`package.json`:
```json
{
  "name": "highroller",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite --host",
    "build": "vite build && gzip -9kf dist/index.html",
    "test": "node --test",
    "fake": "node dev/fake-fluidnc.js"
  }
}
```

`vite.config.js`:
```js
import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { viteSingleFile } from 'vite-plugin-singlefile'

// One self-contained index.html, so the board's flash only needs one file.
export default defineConfig({
  plugins: [svelte(), viteSingleFile()],
})
```

`index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="theme-color" content="#1a1d23" />
    <title>HighRoller</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
```

`.gitignore`:
```
node_modules
dist
```

`src/main.js`:
```js
import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'

mount(App, { target: document.getElementById('app') })
```

`src/app.css`:
```css
:root {
  --bg: #f4f5f7;
  --panel: #ffffff;
  --text: #16181d;
  --muted: #6b7280;
  --line: #d9dce1;
  --btn: #e9ecf1;
  --btn-active: #d4d9e1;
  --accent: #2563eb;
  --ok: #16a34a;
  --warn: #d97706;
  --bad: #dc2626;
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #111317;
    --panel: #1a1d23;
    --text: #e8eaee;
    --muted: #8b93a1;
    --line: #2b3039;
    --btn: #262a32;
    --btn-active: #343a45;
    --accent: #60a5fa;
  }
}
* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; background: var(--bg); color: var(--text); }
body { overscroll-behavior: none; }
button {
  font: inherit;
  color: inherit;
  background: var(--btn);
  border: 1px solid var(--line);
  border-radius: 10px;
  min-height: 44px;
  padding: 0 14px;
  cursor: pointer;
  touch-action: manipulation;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
}
button:active { background: var(--btn-active); }
button:disabled { opacity: 0.45; cursor: default; }
input { font: inherit; color: inherit; }
.mono { font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace; font-variant-numeric: tabular-nums; }
.panel { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 12px; }
```

`src/App.svelte` (placeholder, replaced in Task 5):
```svelte
<h1>HighRoller</h1>
```

- [ ] **Step 2: Install dev dependencies**

Run: `npm install -D vite @sveltejs/vite-plugin-svelte svelte vite-plugin-singlefile ws`
Expected: `package.json` gains a `devDependencies` block, and `node_modules/` exists.

- [ ] **Step 3: Write the failing tests**

`src/lib/status.test.js`:
```js
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
```

- [ ] **Step 4: Run the tests and confirm they fail**

Run: `npm test`
Expected: FAIL with `Cannot find module` for `./status.js`.

- [ ] **Step 5: Implement `src/lib/status.js`**

```js
// Parses FluidNC status reports, e.g.
// <Idle|MPos:1.000,2.000,3.000|FS:0,0|WCO:0.000,0.000,0.000|Ov:100,100,100|A:SF|Pn:P|SD:12.50,/sd/job.nc>
// WCO and Ov (with A) only come now and then, so they carry over from the previous report.

export const EMPTY = {
  state: 'Unknown',
  sub: null,
  mpos: [0, 0, 0],
  wpos: [0, 0, 0],
  wco: [0, 0, 0],
  feed: 0,
  spindle: 0,
  ov: [100, 100, 100],
  acc: '',
  pins: '',
  sd: null,
}

const nums = s => s.split(',').map(Number)

export function parseStatus(line, prev = EMPTY) {
  const fields = line.slice(1, line.lastIndexOf('>')).split('|')
  const [state, sub] = fields[0].split(':')
  const s = { ...prev, state, sub: sub === undefined ? null : Number(sub), pins: '', sd: null }
  let pos = null
  let isWork = false
  for (const f of fields.slice(1)) {
    const i = f.indexOf(':')
    const key = f.slice(0, i)
    const val = f.slice(i + 1)
    if (key === 'MPos') pos = nums(val)
    else if (key === 'WPos') { pos = nums(val); isWork = true }
    else if (key === 'WCO') s.wco = nums(val)
    else if (key === 'FS') [s.feed, s.spindle] = nums(val)
    else if (key === 'Ov') { s.ov = nums(val); s.acc = '' } // A: only ever follows Ov
    else if (key === 'A') s.acc = val
    else if (key === 'Pn') s.pins = val
    else if (key === 'SD') {
      const c = val.indexOf(',')
      s.sd = { percent: Number(val.slice(0, c)), file: val.slice(c + 1) }
    }
  }
  if (pos) {
    const wco = pos.map((_, k) => s.wco[k] ?? 0)
    s.mpos = isWork ? pos.map((v, k) => v + wco[k]) : pos
    s.wpos = isWork ? pos : pos.map((v, k) => v - wco[k])
  }
  return s
}

// Plain-language reasons for FluidNC ALARM:n codes (names from FluidNC Protocol.cpp).
export const ALARMS = {
  1: 'A limit switch was hit while moving. Position may be off, so home again.',
  2: 'That move would go past the edge of the machine (soft limit).',
  3: 'Reset while moving. Position may be off, so home again.',
  4: 'The probe was already touching when probing started. Check the plate is clear of the bit.',
  5: 'The probe never touched. Is the plate under the bit and the clip attached?',
  6: 'Homing was interrupted by a reset.',
  7: 'Homing stopped because the safety door opened.',
  8: 'Homing could not back off the switch. Check the switch, or raise pulloff_mm.',
  9: 'Homing could not find the switch. Check the switch and its wiring.',
  10: 'Spindle control error.',
  11: 'An input (e-stop, limit or control pin) was on at startup.',
  12: 'Homing hit an ambiguous switch.',
  13: 'Hard stop.',
  14: 'Not homed yet. Home the machine, or unlock if you know where it is.',
  15: 'The controller is still starting up.',
  16: 'The I/O expander reset.',
  17: 'G-code error.',
  18: 'The probe ran into a limit switch.',
}
```

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `npm test`
Expected: PASS, 7 tests.

- [ ] **Step 7: Confirm the single-file build works**

Run: `npm run build && ls -l dist`
Expected: `dist/index.html` and `dist/index.html.gz` exist, and there is no `dist/assets/` directory.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json vite.config.js index.html .gitignore src
git commit -m "Scaffold Svelte app and FluidNC status-report parser"
```

---

### Task 2: FluidNC websocket client

**Files:**
- Create: `src/lib/fluidnc.js`
- Test: `src/lib/fluidnc.test.js`

**Interfaces:**
- Consumes: `parseStatus`, `EMPTY` from `src/lib/status.js`.
- Produces: `class FluidNC`:
  - Constructor: `new FluidNC({ host, WebSocket?, onStatus?, onLine?, onConnection? })`
    - `host` is like `'fluidnc.local'` or `'localhost:8081'`.
    - Callbacks:
      - `onStatus(status)` for each status report;
      - `onLine(line)` for every non-status line;
      - `onConnection(state)`, where state is `'connecting' | 'open' | 'closed'`.
  - `.connect()` and `.close()`.
  - `.send(line): Promise<{ ok: boolean, error: number|string|null, lines: string[] }>`.
    - Never rejects.
    - The `error` value is a number from `error:N`, or the string `'disconnected'`, `'reset'` or `'cancelled'`.
  - `.realtime(code: number)`: sends a single real-time byte immediately.
  - `.reset()`: sends Ctrl-X and fails everything pending with `'reset'`.
  - `.dropQueued(match: (line) => boolean)`: cancels queued commands that haven't been sent yet.
  - `.status`: the last parsed status.

- [ ] **Step 1: Write the failing tests**

`src/lib/fluidnc.test.js`:
```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FluidNC } from './fluidnc.js'

class FakeWS {
  static all = []
  constructor(url, protocols) {
    this.url = url
    this.protocols = protocols
    this.sent = []
    this.readyState = 0
    FakeWS.all.push(this)
  }
  send(data) { this.sent.push(data) }
  close() { this.readyState = 3 }
  // test helpers
  open() { this.readyState = 1; this.onopen?.() }
  rx(text) { this.onmessage?.({ data: new TextEncoder().encode(text).buffer }) }
  drop() { this.readyState = 3; this.onclose?.() }
}

// MockTimers jumps Date to the end of a tick (timers scheduled during it don't run),
// so walk the clock forward in small steps.
const advance = (t, ms) => { for (let i = 0; i < ms; i += 50) t.mock.timers.tick(50) }

function setup(t, host = 'cnc.local') {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'] })
  FakeWS.all = []
  const events = { status: [], lines: [], conn: [] }
  const fnc = new FluidNC({
    host,
    WebSocket: FakeWS,
    onStatus: s => events.status.push(s),
    onLine: l => events.lines.push(l),
    onConnection: c => events.conn.push(c),
  })
  fnc.connect()
  return { fnc, events, ws: () => FakeWS.all.at(-1) }
}

test('connects to port 80 first and turns on auto-reporting', t => {
  const { ws, events } = setup(t)
  assert.equal(ws().url, 'ws://cnc.local/')
  assert.equal(ws().binaryType, 'arraybuffer')
  ws().open()
  assert.deepEqual(events.conn, ['connecting', 'open'])
  assert.deepEqual(ws().sent, ['$RI=100\n'])
})

test('falls back to the FluidNC 3.x port 81 when port 80 never opens', t => {
  const { ws } = setup(t)
  ws().drop()
  advance(t, 500)
  assert.equal(ws().url, 'ws://cnc.local:81/')
  assert.deepEqual(ws().protocols, ['arduino'])
})

test('a host with an explicit port only uses that address', t => {
  const { ws } = setup(t, 'localhost:8081')
  ws().drop()
  advance(t, 500)
  assert.equal(ws().url, 'ws://localhost:8081/')
})

test('reassembles lines split across frames and routes status reports', t => {
  const { ws, events } = setup(t)
  ws().open()
  ws().rx('<Idle|MPos:1,2,3|FS:0,0|WC')
  ws().rx('O:0,0,0>\r\n[MSG:INFO: hi]\r\n')
  assert.equal(events.status.length, 1)
  assert.deepEqual(events.status[0].wpos, [1, 2, 3])
  assert.deepEqual(events.lines, ['[MSG:INFO: hi]'])
})

test('ignores text control frames', t => {
  const { ws, events } = setup(t)
  ws().open()
  ws().onmessage({ data: 'currentID:3' })
  assert.deepEqual(events.lines, [])
})

test('sends one command at a time and resolves with its output', async t => {
  const { fnc, ws } = setup(t)
  ws().open()
  ws().rx('ok\n') // answers $RI=100
  const a = fnc.send('$Config/Filename')
  const b = fnc.send('G0 X1')
  assert.deepEqual(ws().sent.slice(1), ['$Config/Filename\n'])
  ws().rx('<Idle|MPos:0,0,0|FS:0,0>\n$Config/Filename=config.yaml\nok\n')
  assert.deepEqual(await a, { ok: true, error: null, lines: ['$Config/Filename=config.yaml'] })
  assert.deepEqual(ws().sent.slice(1), ['$Config/Filename\n', 'G0 X1\n'])
  ws().rx('error:20\n')
  assert.deepEqual(await b, { ok: false, error: 20, lines: [] })
})

test('real-time bytes go out immediately, even with a command in flight', t => {
  const { fnc, ws } = setup(t)
  ws().open() // $RI=100 is in flight, unanswered
  fnc.realtime(0x21)
  fnc.realtime(0x85)
  assert.deepEqual(ws().sent, ['$RI=100\n', '!', '\x85'])
})

test('refuses commands while disconnected instead of queueing motion', async t => {
  const { fnc } = setup(t)
  assert.deepEqual(await fnc.send('G0 X1'), { ok: false, error: 'disconnected', lines: [] })
})

test('a dropped link fails pending commands and reconnects to the same address', async t => {
  const { fnc, ws } = setup(t)
  ws().open()
  const p = fnc.send('G0 X1')
  ws().drop()
  assert.equal((await p).error, 'disconnected')
  advance(t, 500)
  assert.equal(FakeWS.all.length, 2)
  assert.equal(ws().url, 'ws://cnc.local/')
})

test('polls with ? when quiet and drops a link that stays silent', t => {
  const { ws } = setup(t)
  ws().open()
  const first = ws()
  advance(t, 500)
  assert.ok(first.sent.includes('?'))
  advance(t, 3500)
  assert.equal(first.readyState, 3)
  assert.equal(FakeWS.all.length, 2)
})

test('reset sends Ctrl-X and fails everything pending', async t => {
  const { fnc, ws } = setup(t)
  ws().open()
  const p = fnc.send('G0 X100')
  fnc.reset()
  assert.equal(ws().sent.at(-1), '\x18')
  assert.equal((await p).error, 'reset')
})

test('dropQueued cancels matching commands that have not been sent', async t => {
  const { fnc, ws } = setup(t)
  ws().open() // $RI=100 in flight
  const j1 = fnc.send('$J=G91 X1 F100')
  const g = fnc.send('G0 X1')
  const j2 = fnc.send('$J=G91 X1 F100')
  fnc.dropQueued(l => l.startsWith('$J='))
  assert.equal((await j1).error, 'cancelled')
  assert.equal((await j2).error, 'cancelled')
  ws().rx('ok\n')
  assert.equal(ws().sent.at(-1), 'G0 X1\n')
  ws().rx('ok\n')
  assert.equal((await g).ok, true)
})
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm test`
Expected: FAIL with `Cannot find module` for `./fluidnc.js`.

- [ ] **Step 3: Implement `src/lib/fluidnc.js`**

```js
import { parseStatus, EMPTY } from './status.js'

const OPEN = 1 // WebSocket.OPEN

// Talks to FluidNC over its websocket: one command line in flight at a time,
// real-time bytes straight through, status reports parsed as they arrive.
export class FluidNC {
  constructor({ host, WebSocket = globalThis.WebSocket, onStatus = () => {}, onLine = () => {}, onConnection = () => {} }) {
    // FluidNC 4.x serves the websocket on port 80, 3.x on port 81.
    // ponytail: an explicit port in host (dev server, fake) skips the 3.x fallback.
    this.urls = host.includes(':') ? [`ws://${host}/`] : [`ws://${host}/`, `ws://${host}:81/`]
    this.WebSocket = WebSocket
    this.onStatus = onStatus
    this.onLine = onLine
    this.onConnection = onConnection
    this.status = EMPTY
    this.queue = []
    this.inflight = null
    this.ws = null
    this.urlIndex = 0
    this.retryMs = 500
  }

  connect() {
    this.wanted = true
    this._open()
  }

  close() {
    this.wanted = false
    this._drop()
  }

  // Resolves with { ok, error, lines } when FluidNC answers ok or error:N. Never rejects.
  // Refuses at once when not connected, so motion is never queued for later.
  send(line) {
    if (this.ws?.readyState !== OPEN) return Promise.resolve({ ok: false, error: 'disconnected', lines: [] })
    return new Promise(resolve => {
      this.queue.push({ line, resolve, lines: [] })
      this._pump()
    })
  }

  // Codes >= 0x80 go out UTF-8 encoded; FluidNC decodes UTF-8 before acting on them.
  realtime(code) {
    if (this.ws?.readyState === OPEN) this.ws.send(String.fromCharCode(code))
  }

  // FluidNC drops everything on a soft reset, so nothing pending will be answered.
  reset() {
    this.realtime(0x18)
    this._failAll('reset')
  }

  // Cancels queued (not yet sent) commands, e.g. leftover jog moves.
  dropQueued(match) {
    const keep = []
    for (const c of this.queue) {
      if (match(c.line)) c.resolve({ ok: false, error: 'cancelled', lines: [] })
      else keep.push(c)
    }
    this.queue = keep
  }

  _open() {
    const url = this.urls[this.urlIndex]
    const ws = url.endsWith(':81/') ? new this.WebSocket(url, ['arduino']) : new this.WebSocket(url)
    ws.binaryType = 'arraybuffer'
    this.ws = ws
    this.opened = false
    this.buf = ''
    this.decoder = new TextDecoder()
    this.onConnection('connecting')
    ws.onopen = () => {
      this.opened = true
      this.retryMs = 500
      this.lastRx = Date.now()
      this.onConnection('open')
      this.timer = setInterval(() => this._watch(), 250)
      this.send('$RI=100')
    }
    ws.onmessage = e => this._receive(e.data)
    ws.onclose = () => this._closed()
  }

  _watch() {
    const quiet = Date.now() - this.lastRx
    if (quiet > 3000) this._drop() // dead link, e.g. a phone that slept: start over
    else if (quiet > 250) this.realtime(0x3f) // '?': FluidNC only auto-reports while moving
  }

  _drop() {
    const ws = this.ws
    if (!ws) return
    ws.onopen = ws.onmessage = ws.onclose = null
    try { ws.close() } catch {}
    this._closed()
  }

  _closed() {
    clearInterval(this.timer)
    const wasOpen = this.opened
    this.ws = null
    this.opened = false
    this._failAll('disconnected')
    this.onConnection('closed')
    if (!this.wanted) return
    if (!wasOpen) this.urlIndex = (this.urlIndex + 1) % this.urls.length // try the other port
    setTimeout(() => this.wanted && !this.ws && this._open(), this.retryMs)
    this.retryMs = Math.min(this.retryMs * 2, 5000)
  }

  _receive(data) {
    this.lastRx = Date.now()
    if (typeof data === 'string') return // control frames: currentID, PING, ...
    this.buf += this.decoder.decode(data, { stream: true })
    let i
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).replace(/\r$/, '')
      this.buf = this.buf.slice(i + 1)
      if (line) this._line(line)
    }
  }

  _line(line) {
    if (line.startsWith('<')) {
      this.status = parseStatus(line, this.status)
      this.onStatus(this.status)
      return
    }
    this.onLine(line)
    const c = this.inflight
    if (!c) return
    if (line === 'ok' || line.startsWith('error:')) {
      this.inflight = null
      c.resolve({ ok: line === 'ok', error: line === 'ok' ? null : Number(line.slice(6)), lines: c.lines })
      this._pump()
    } else {
      c.lines.push(line)
    }
  }

  _pump() {
    if (this.inflight || !this.queue.length || this.ws?.readyState !== OPEN) return
    this.inflight = this.queue.shift()
    this.ws.send(this.inflight.line + '\n')
  }

  _failAll(error) {
    const all = this.inflight ? [this.inflight, ...this.queue] : this.queue
    this.inflight = null
    this.queue = []
    for (const c of all) c.resolve({ ok: false, error, lines: c.lines })
  }
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test`
Expected: PASS, 19 tests (7 status + 12 fluidnc).

- [ ] **Step 5: Commit**

```bash
git add src/lib/fluidnc.js src/lib/fluidnc.test.js
git commit -m "Add FluidNC websocket client with command queue, fallback port and watchdog"
```

---

### Task 3: Jogger (tap steps and hold-to-jog runway)

**Files:**
- Create: `src/lib/jog.js`
- Test: `src/lib/jog.test.js`

**Interfaces:**
- Consumes: from a `FluidNC` instance, `send(line)`, `realtime(code)` and `dropQueued(match)`.
- Produces: `createJogger(fnc, now?: () => number)`, which returns `{ step(axis, mm, feed), start(axis, dir, feed), stop() }`.
  - `axis` is `'X' | 'Y' | 'Z'`, `dir` is `1 | -1`, and `feed` is in mm/min.

- [ ] **Step 1: Write the failing tests**

`src/lib/jog.test.js`:
```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createJogger } from './jog.js'

function fakeFnc() {
  const f = { sent: [], rt: [], pending: [], drops: [] }
  f.send = line => new Promise(resolve => { f.sent.push(line); f.pending.push(resolve) })
  f.realtime = code => f.rt.push(code)
  f.dropQueued = match => f.drops.push(match)
  return f
}

const flush = () => new Promise(r => setImmediate(r))

test('a tap sends one jog move of the step size', () => {
  const f = fakeFnc()
  createJogger(f).step('X', -10, 3000)
  assert.deepEqual(f.sent, ['$J=G91 G21 X-10 F3000'])
})

test('holding keeps 0.1 s moves queued at least 0.25 s ahead', t => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] })
  const f = fakeFnc()
  const j = createJogger(f)
  j.start('Y', 1, 3000) // 3000 mm/min = 5 mm per 0.1 s
  assert.deepEqual(f.sent, Array(3).fill('$J=G91 G21 Y5 F3000'))
  t.mock.timers.tick(50)
  assert.equal(f.sent.length, 3) // still 250 ms ahead
  t.mock.timers.tick(50)
  assert.equal(f.sent.length, 4) // down to 200 ms: topped up
  j.stop()
})

test('release drops queued jog moves, cancels the jog and stops sending', t => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] })
  const f = fakeFnc()
  const j = createJogger(f)
  j.start('Z', -1, 600)
  assert.equal(f.sent[0], '$J=G91 G21 Z-1 F600')
  j.stop()
  assert.deepEqual(f.rt, [0x85])
  assert.equal(f.drops.length, 1)
  assert.equal(f.drops[0]('$J=G91 G21 Z-1 F600'), true)
  assert.equal(f.drops[0]('G0 X1'), false)
  const n = f.sent.length
  t.mock.timers.tick(500)
  assert.equal(f.sent.length, n)
})

test('a move accepted after release gets a second cancel', async t => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] })
  const f = fakeFnc()
  const j = createJogger(f)
  j.start('X', 1, 3000)
  j.stop()
  f.pending[0]({ ok: true, error: null, lines: [] }) // it was already in flight
  await flush()
  assert.deepEqual(f.rt, [0x85, 0x85])
})

test('moves accepted while still holding do not cancel', async t => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] })
  const f = fakeFnc()
  const j = createJogger(f)
  j.start('X', 1, 3000)
  f.pending[0]({ ok: true, error: null, lines: [] })
  await flush()
  assert.deepEqual(f.rt, [])
  j.stop()
})

test('stop without a hold does nothing', () => {
  const f = fakeFnc()
  createJogger(f).stop()
  assert.deepEqual(f.rt, [])
})
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm test`
Expected: FAIL with `Cannot find module` for `./jog.js`.

- [ ] **Step 3: Implement `src/lib/jog.js`**

```js
// Jogging. A tap moves one step. Holding keeps a short runway of small jog moves queued
// in FluidNC, so if the link drops the machine stops within a fraction of a second
// instead of running to the end of travel.
const CHUNK_MS = 100 // travel time per jog move
const AHEAD_MS = 250 // top up whenever less than this much motion is queued
const JOG_CANCEL = 0x85

export function createJogger(fnc, now = () => Date.now()) {
  let hold = null

  const jog = (axis, mm, feed) => fnc.send(`$J=G91 G21 ${axis}${+mm.toFixed(3)} F${Math.round(feed)}`)

  function start(axis, dir, feed) {
    stop()
    const h = { until: now() }
    const tick = () => {
      const t = now()
      h.until = Math.max(h.until, t)
      while (h.until - t < AHEAD_MS) {
        jog(axis, (dir * feed * CHUNK_MS) / 60000, feed).then(r => {
          // This move may have reached FluidNC just after the release's cancel: cancel again.
          if (r.ok && hold === null) fnc.realtime(JOG_CANCEL)
        })
        h.until += CHUNK_MS
      }
    }
    hold = h
    tick()
    h.timer = setInterval(tick, 50)
  }

  function stop() {
    if (!hold) return
    clearInterval(hold.timer)
    hold = null
    fnc.dropQueued(line => line.startsWith('$J='))
    fnc.realtime(JOG_CANCEL)
  }

  return { step: jog, start, stop }
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test`
Expected: PASS, 25 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/jog.js src/lib/jog.test.js
git commit -m "Add jogger: tap steps and hold-to-jog with a short safety runway"
```

---

### Task 4: Fake FluidNC server for development

**Files:**
- Create: `dev/fake-fluidnc.js`
- Test: `dev/fake-fluidnc.test.js` (an integration test that runs the real `FluidNC` client against the fake)

**Interfaces:**
- Consumes: `FluidNC` from `src/lib/fluidnc.js` (the test only).
- Produces: `start(port = 8081): { close() }`. Running `npm run fake` starts it on `PORT` or 8081.
- Behaviour:
  - Starts in `Alarm` state.
  - `$X` unlocks and `$H` "homes" over 1.5 s.
  - Handles `$RI=n`, `$J=…`, G0/G1 with G90/G91, and `G10 L20 P0/P1`.
  - Real-time: `?`, `!`, `~`, Ctrl-X, `0x85`, and the override bytes `0x90`–`0x9D`.
  - Output goes out as binary frames ending in `\r\n`. It sends a `currentID:0` text frame on connect.

- [ ] **Step 1: Write the failing test**

`dev/fake-fluidnc.test.js`:
```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { start } from './fake-fluidnc.js'
import { FluidNC } from '../src/lib/fluidnc.js'

const sleep = ms => new Promise(r => setTimeout(r, ms))

test('the app client can unlock, jog and see the new position', async () => {
  const server = start(8099)
  const fnc = new FluidNC({ host: 'localhost:8099' })
  const opened = new Promise(r => { fnc.onConnection = c => c === 'open' && r() })
  fnc.connect()
  await opened
  assert.equal((await fnc.send('$X')).ok, true)
  assert.equal((await fnc.send('$J=G91 G21 X5 F3000')).ok, true)
  await sleep(400)
  assert.equal(fnc.status.state, 'Idle')
  assert.ok(Math.abs(fnc.status.mpos[0] - 5) < 1e-6, `x=${fnc.status.mpos[0]}`)
  assert.equal((await fnc.send('G10 L20 P0 X0')).ok, true)
  await sleep(300)
  assert.ok(Math.abs(fnc.status.wpos[0]) < 1e-6)
  fnc.close()
  server.close()
})

test('feed override bytes change the reported override', async () => {
  const server = start(8098)
  const fnc = new FluidNC({ host: 'localhost:8098' })
  const opened = new Promise(r => { fnc.onConnection = c => c === 'open' && r() })
  fnc.connect()
  await opened
  fnc.realtime(0x91) // +10 %
  fnc.realtime(0x93) // +1 %
  fnc.realtime(0x3f)
  await sleep(200)
  assert.deepEqual(fnc.status.ov, [111, 100, 100])
  fnc.close()
  server.close()
})
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm test`
Expected: FAIL with `Cannot find module` for `./fake-fluidnc.js`.

- [ ] **Step 3: Implement `dev/fake-fluidnc.js`**

```js
// A pretend FluidNC for UI work without the machine. It speaks just enough of the protocol:
// binary output frames, status reports, jogging, G0/G1 moves, work offsets, overrides and alarms.
// ponytail: grows only as features need it (probing, SD jobs and files come with later steps).
import { WebSocketServer } from 'ws'
import { pathToFileURL } from 'node:url'

const RAPID = 5000 // mm/min
const TICK = 20 // ms
const AXES = 'XYZ'

export function start(port = 8081) {
  const m = { state: 'Alarm', mpos: [0, 0, 0], wco: [0, 0, 0], ov: [100, 100, 100], moves: [], absolute: true, feed: 1000 }
  let client = null
  let ri = 0
  let lastReport = 0

  const out = text => client?.send(Buffer.from(text + '\r\n'), { binary: true })
  const ok = () => out('ok')
  const fmt = v => v.map(n => n.toFixed(3)).join(',')
  const status = () => {
    lastReport = Date.now()
    const feed = m.moves.length && !m.state.startsWith('Hold') ? m.moves[0].feed : 0
    out(`<${m.state}|MPos:${fmt(m.mpos)}|FS:${feed},0|WCO:${fmt(m.wco)}|Ov:${m.ov.join(',')}>`)
  }
  const words = text => [...text.matchAll(/([A-Z])\s*(-?\d*\.?\d+)/g)].map(([, w, v]) => [w, Number(v)])
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

  function motion(text, jog) {
    let abs = jog ? true : m.absolute
    let feed = jog ? null : m.feed
    let rapid = false
    const target = [...(m.moves.at(-1)?.to ?? m.mpos)]
    for (const [w, v] of words(text)) {
      if (w === 'G' && v === 90) abs = true
      else if (w === 'G' && v === 91) abs = false
      else if (w === 'G' && v === 0) rapid = true
      else if (w === 'F') feed = v
      else if (AXES.includes(w)) {
        const i = AXES.indexOf(w)
        target[i] = abs ? v + m.wco[i] : target[i] + v
      }
    }
    if (!jog) {
      m.absolute = abs
      if (feed) m.feed = feed
    }
    m.moves.push({ to: target, feed: rapid ? RAPID : feed ?? m.feed, jog, rapid })
    if (m.state === 'Idle') m.state = jog ? 'Jog' : 'Run'
    ok()
  }

  function line(text) {
    const l = text.trim().toUpperCase()
    if (!l) return
    if (l.startsWith('$RI=')) { ri = Number(l.slice(4)); status(); return ok() }
    if (l === '$X') { m.state = 'Idle'; out('[MSG:INFO: Caution: Unlocked]'); return ok() }
    if (l === '$H') {
      m.state = 'Home'
      status()
      setTimeout(() => { m.mpos = [0, 0, 0]; m.state = 'Idle'; status(); ok() }, 1500)
      return
    }
    if (m.state === 'Alarm') return out('error:9') // G-code locked out during alarm
    if (l.startsWith('$J=')) return motion(l.slice(3), true)
    if (/^G10\s*L20\s*P[01]/.test(l)) {
      for (const [w, v] of words(l.replace(/^G10\s*L20\s*P[01]/, ''))) {
        if (AXES.includes(w)) m.wco[AXES.indexOf(w)] = m.mpos[AXES.indexOf(w)] - v
      }
      status()
      return ok()
    }
    if (/^(G9[01]\s*)?G[01]\b/.test(l)) return motion(l, false)
    ok()
  }

  function realtime(c) {
    const code = c.codePointAt(0)
    if (c === '?') return status()
    if (c === '!') {
      if (m.state === 'Jog') { m.moves = []; m.state = 'Idle' } // a hold during a jog cancels it
      else if (m.state === 'Run') m.state = 'Hold:0'
      return status()
    }
    if (c === '~') { if (m.state === 'Hold:0') m.state = 'Run'; return status() }
    if (code === 0x18) {
      const wasMoving = m.state === 'Run' || m.state === 'Jog'
      m.moves = []
      if (m.state !== 'Alarm') m.state = wasMoving ? 'Alarm' : 'Idle'
      out("Grbl 4.1 [FluidNC fake, '$' for help]")
      if (wasMoving) out('ALARM:3')
      return status()
    }
    if (code === 0x85) { if (m.state === 'Jog') { m.moves = []; m.state = 'Idle' } return status() }
    const [f, r, s] = m.ov
    const ov = {
      0x90: [100, r, s], 0x91: [f + 10, r, s], 0x92: [f - 10, r, s], 0x93: [f + 1, r, s], 0x94: [f - 1, r, s],
      0x95: [f, 100, s], 0x96: [f, 50, s], 0x97: [f, 25, s],
      0x99: [f, r, 100], 0x9a: [f, r, s + 10], 0x9b: [f, r, s - 10], 0x9c: [f, r, s + 1], 0x9d: [f, r, s - 1],
    }[code]
    if (ov) m.ov = [clamp(ov[0], 10, 200), ov[1], clamp(ov[2], 10, 200)]
  }

  const timer = setInterval(() => {
    const mv = m.moves[0]
    if (mv && (m.state === 'Run' || m.state === 'Jog')) {
      const pct = mv.jog ? 100 : mv.rapid ? m.ov[1] : m.ov[0]
      const stepMm = ((mv.feed * pct) / 100 / 60000) * TICK
      const d = mv.to.map((t, i) => t - m.mpos[i])
      const dist = Math.hypot(...d)
      if (dist <= stepMm) {
        m.mpos = [...mv.to]
        m.moves.shift()
      } else {
        m.mpos = m.mpos.map((p, i) => p + (d[i] / dist) * stepMm)
      }
      if (!m.moves.length) { m.state = 'Idle'; status() }
    }
    if (ri && (m.state === 'Run' || m.state === 'Jog' || m.state === 'Home') && Date.now() - lastReport >= ri) status()
  }, TICK)

  const wss = new WebSocketServer({ port })
  wss.on('connection', ws => {
    client?.close() // one client at a time is plenty for a fake
    client = ws
    ws.send('currentID:0') // text control frame, as FluidNC sends
    let buf = ''
    ws.on('message', data => {
      for (const c of data.toString()) { // UTF-8 decoded: override bytes arrive as single characters
        if ('?!~\x18'.includes(c) || c.codePointAt(0) >= 0x80) realtime(c)
        else if (c === '\n') { line(buf); buf = '' }
        else if (c !== '\r') buf += c
      }
    })
    ws.on('close', () => { if (client === ws) client = null })
  })

  return {
    close() {
      clearInterval(timer)
      for (const ws of wss.clients) ws.terminate()
      wss.close()
    },
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 8081)
  start(port)
  console.log(`Fake FluidNC on ws://localhost:${port}/`)
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test`
Expected: PASS, 27 tests.

- [ ] **Step 5: Commit**

```bash
git add dev
git commit -m "Add fake FluidNC server with an end-to-end client test"
```

---

### Task 5: App state, top bar, position readout and console

**Files:**
- Create: `src/lib/machine.svelte.js`, `src/lib/settings.svelte.js`
- Create: `src/components/TopBar.svelte`, `src/components/Dro.svelte`, `src/components/Console.svelte`
- Modify: `src/App.svelte` (replace the placeholder)

**Interfaces:**
- Consumes:
  - `FluidNC` (Task 2) and `createJogger` (Task 3).
  - `EMPTY` and `ALARMS` (Task 1).
- Produces:
  - `machine`: a `$state` object `{ conn, everOpen, status, alarm, log }`.
  - `fnc` (a FluidNC instance) and `jogger`.
  - `send(line)`: echoes the line to the console log, then sends it.
  - `stop()`: feed hold, wait until motion stops (at most 1 s), then soft reset.
  - `settings`: a `$state` object `{ step, feedXY, feedZ }`, saved in localStorage.

- [ ] **Step 1: Write `src/lib/settings.svelte.js`**

```js
// ponytail: per-device localStorage until the board file API lands (build step 2);
// then these move to highroller.json on the board so phone and desktop share them.
const KEY = 'highroller.settings'
const DEFAULTS = { step: 10, feedXY: 3000, feedZ: 600 }

function load() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY)) }
  } catch {
    return { ...DEFAULTS }
  }
}

export const settings = $state(load())

$effect.root(() => {
  $effect(() => {
    const json = JSON.stringify(settings)
    try { localStorage.setItem(KEY, json) } catch {}
  })
})
```

- [ ] **Step 2: Write `src/lib/machine.svelte.js`**

```js
import { FluidNC } from './fluidnc.js'
import { EMPTY } from './status.js'
import { createJogger } from './jog.js'

const LOG_MAX = 500

export const machine = $state({ conn: 'connecting', everOpen: false, status: EMPTY, alarm: null, log: [] })

function log(line) {
  machine.log.push(line)
  if (machine.log.length > LOG_MAX) machine.log.splice(0, machine.log.length - LOG_MAX)
}

export const fnc = new FluidNC({
  // On the board, talk to the board. On the dev server: VITE_FLUIDNC_HOST, or the fake on :8081.
  host: import.meta.env.VITE_FLUIDNC_HOST || (import.meta.env.DEV ? `${location.hostname}:8081` : location.host),
  onStatus: s => {
    machine.status = s
    if (s.state !== 'Alarm') machine.alarm = null
  },
  onLine: line => {
    const m = /^ALARM:(\d+)/.exec(line)
    if (m) machine.alarm = Number(m[1])
    log(line)
  },
  onConnection: c => {
    machine.conn = c
    if (c === 'open') machine.everOpen = true
  },
})
fnc.connect()

export const jogger = createJogger(fnc)

// Commands the user asked for are echoed into the console.
export function send(line) {
  log('> ' + line)
  return fnc.send(line)
}

const moving = s => s.state === 'Run' || s.state === 'Jog' || (s.state === 'Hold' && s.sub !== 0)

// Hold first so the machine decelerates and keeps its position, then reset.
export async function stop() {
  jogger.stop()
  fnc.realtime(0x21) // '!'
  const t0 = Date.now()
  while (moving(machine.status) && Date.now() - t0 < 1000) await new Promise(r => setTimeout(r, 50))
  fnc.reset()
}
```

- [ ] **Step 3: Write `src/components/TopBar.svelte`**

```svelte
<script>
  import { machine, stop, send } from '../lib/machine.svelte.js'
  import { ALARMS } from '../lib/status.js'

  const state = $derived(machine.status.state)
  const tone = $derived(
    state === 'Alarm' ? 'bad'
    : state === 'Hold' || state === 'Door' ? 'warn'
    : state === 'Run' || state === 'Jog' || state === 'Home' ? 'ok'
    : ''
  )
</script>

<header>
  <span class="conn" class:open={machine.conn === 'open'}>
    {machine.conn === 'open' ? 'Connected' : machine.everOpen ? 'Reconnecting…' : 'Connecting…'}
  </span>
  <span class="state {tone}">{machine.conn === 'open' ? state : '–'}</span>
  <button class="stop" onclick={stop}>STOP</button>
</header>

{#if machine.conn !== 'open' && machine.everOpen}
  <div class="banner warn">Lost connection, reconnecting. A running job carries on without the app.</div>
{/if}

{#if machine.conn === 'open' && state === 'Alarm'}
  <div class="banner bad">
    <span>{ALARMS[machine.alarm] ?? 'The machine is in alarm.'}</span>
    <span class="actions">
      <button onclick={() => send('$H')}>Home</button>
      <button onclick={() => send('$X')}>Unlock</button>
    </span>
  </div>
{/if}

<style>
  header {
    position: sticky;
    top: 0;
    z-index: 10;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    padding-top: calc(10px + env(safe-area-inset-top));
    background: var(--panel);
    border-bottom: 1px solid var(--line);
  }
  .conn { display: flex; align-items: center; gap: 6px; font-size: 14px; color: var(--muted); }
  .conn::before { content: ''; width: 10px; height: 10px; border-radius: 50%; background: var(--warn); }
  .conn.open::before { background: var(--ok); }
  .state { font-weight: 700; padding: 4px 12px; border-radius: 999px; background: var(--btn); }
  .state.ok { background: var(--ok); color: white; }
  .state.warn { background: var(--warn); color: white; }
  .state.bad { background: var(--bad); color: white; }
  .stop {
    margin-left: auto;
    min-height: 52px;
    padding: 0 28px;
    font-size: 18px;
    font-weight: 800;
    letter-spacing: 0.06em;
    color: white;
    background: var(--bad);
    border-color: var(--bad);
  }
  .stop:active { background: #991b1b; }
  .banner { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 10px 12px; color: white; }
  .banner.warn { background: var(--warn); }
  .banner.bad { background: var(--bad); }
  .actions { display: flex; gap: 8px; margin-left: auto; }
  .actions button { color: white; background: rgb(255 255 255 / 0.2); border-color: rgb(255 255 255 / 0.5); }
</style>
```

- [ ] **Step 4: Write `src/components/Dro.svelte`**

```svelte
<script>
  import { machine, send } from '../lib/machine.svelte.js'

  const AXES = ['X', 'Y', 'Z']
  const idle = $derived(machine.conn === 'open' && machine.status.state === 'Idle')
</script>

<div class="panel dro">
  {#each AXES as axis, i}
    <div class="row">
      <span class="axis">{axis}</span>
      <span class="work mono">{machine.status.wpos[i]?.toFixed(3)}</span>
      <span class="mach mono" title="Machine position">{machine.status.mpos[i]?.toFixed(3)}</span>
      <button disabled={!idle} onclick={() => send(`G10 L20 P0 ${axis}0`)}>Zero</button>
    </div>
  {/each}
</div>

<style>
  .dro { display: grid; gap: 6px; }
  .row { display: grid; grid-template-columns: 28px 1fr auto auto; align-items: center; gap: 10px; }
  .axis { font-size: 22px; font-weight: 800; color: var(--accent); }
  .work { font-size: clamp(28px, 8vw, 40px); font-weight: 700; text-align: right; }
  .mach { min-width: 72px; font-size: 13px; color: var(--muted); text-align: right; }
</style>
```

- [ ] **Step 5: Write `src/components/Console.svelte`**

```svelte
<script>
  import { machine, send } from '../lib/machine.svelte.js'

  let line = $state('')
  let box

  $effect(() => {
    machine.log.length // scroll down whenever lines arrive
    box.scrollTop = box.scrollHeight
  })

  function submit(e) {
    e.preventDefault()
    const cmd = line.trim()
    if (!cmd) return
    send(cmd)
    line = ''
  }
</script>

<div class="panel console">
  <div class="log mono" bind:this={box}>
    {#each machine.log as l}
      <div class:sent={l.startsWith('> ')} class:err={/^(error|ALARM)/.test(l)}>{l}</div>
    {/each}
  </div>
  <form onsubmit={submit}>
    <input class="mono" bind:value={line} placeholder="G-code or $ command" autocapitalize="off" autocomplete="off" spellcheck="false" />
    <button disabled={machine.conn !== 'open'}>Send</button>
  </form>
</div>

<style>
  .console { display: grid; grid-template-rows: 1fr auto; gap: 8px; height: 60vh; }
  .log { overflow-y: auto; font-size: 13px; line-height: 1.45; white-space: pre-wrap; word-break: break-all; }
  .sent { color: var(--accent); }
  .err { color: var(--bad); }
  form { display: grid; grid-template-columns: 1fr auto; gap: 8px; }
  input { min-height: 44px; padding: 0 10px; font-size: 16px; border: 1px solid var(--line); border-radius: 10px; background: var(--bg); }
  @media (min-width: 900px) { .console { height: calc(100vh - 110px); } }
</style>
```

- [ ] **Step 6: Replace `src/App.svelte`**

```svelte
<script>
  import TopBar from './components/TopBar.svelte'
  import Dro from './components/Dro.svelte'
  import Console from './components/Console.svelte'

  let tab = $state('jog')
</script>

<TopBar />

<main>
  <section class:off={tab !== 'jog'}>
    <Dro />
  </section>
  <section class:off={tab !== 'more'}>
    <Console />
  </section>
</main>

<nav class="tabs">
  <button class:on={tab === 'jog'} onclick={() => (tab = 'jog')}>Jog</button>
  <button class:on={tab === 'more'} onclick={() => (tab = 'more')}>More</button>
</nav>

<style>
  main { display: grid; gap: 12px; padding: 12px 12px 84px; }
  section { display: grid; gap: 12px; align-content: start; min-width: 0; }
  .tabs {
    position: fixed;
    inset: auto 0 0 0;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    padding: 8px 12px calc(8px + env(safe-area-inset-bottom));
    background: var(--panel);
    border-top: 1px solid var(--line);
  }
  .tabs .on { color: white; background: var(--accent); border-color: var(--accent); }
  @media (max-width: 899px) { .off { display: none; } }
  @media (min-width: 900px) {
    main { grid-template-columns: minmax(360px, 440px) 1fr; padding-bottom: 12px; }
    .tabs { display: none; }
  }
</style>
```

- [ ] **Step 7: Build to catch compile errors**

Run: `npm run build`
Expected: the build succeeds with no Svelte errors.

- [ ] **Step 8: Check against the fake in a browser**

Run, in two terminals: `npm run fake` and `npm run dev`. Open `http://localhost:5173`.

Expected:
- **Connection and alarm:** the badge shows "Connected". The state shows `Alarm`, and the red banner reads "The machine is in alarm." with Home and Unlock buttons.
- **Console:** on More (on a phone) or the right column (on desktop), typing `$X` and pressing Send prints `> $X`, then `[MSG:INFO: Caution: Unlocked]`, then `ok`. The banner disappears and the state shows `Idle`.
- **Moving:** sending `G0 X10` makes the X readout count up to 10.000.
- **Zero:** pressing Zero on X shows X as 0.000, while the machine position stays at 10.000.
- **STOP:** sending `G1 X300 F600` and then pressing STOP halts X short of 300, and the state returns to `Idle` without an alarm.
- **Reconnecting:** stopping the fake (Ctrl-C) shows "Reconnecting…" and the banner. Restarting the fake brings back "Connected" within about 5 s.

- [ ] **Step 9: Commit**

```bash
git add src
git commit -m "Add machine state, top bar with STOP and alarms, position readout and console"
```

---

### Task 6: Jog pad (tap, hold, keyboard, speeds)

**Files:**
- Create: `src/components/JogPad.svelte`
- Modify: `src/App.svelte` (add `<JogPad />` under `<Dro />`)

**Interfaces:**
- Consumes: `machine` and `jogger` from `machine.svelte.js`, and `settings` from `settings.svelte.js`.
- Produces: the `<JogPad />` component.

- [ ] **Step 1: Write `src/components/JogPad.svelte`**

```svelte
<script>
  import { machine, jogger } from '../lib/machine.svelte.js'
  import { settings } from '../lib/settings.svelte.js'

  const STEPS = [0.1, 1, 10, 100]
  const HOLD_MS = 300 // shorter presses are taps (one step)
  const KEYS = {
    ArrowLeft: ['X', -1],
    ArrowRight: ['X', 1],
    ArrowUp: ['Y', 1],
    ArrowDown: ['Y', -1],
    PageUp: ['Z', 1],
    PageDown: ['Z', -1],
  }

  const ready = $derived(machine.conn === 'open' && (machine.status.state === 'Idle' || machine.status.state === 'Jog'))

  // One press at a time: tap = one step, hold = run until release.
  let press = null

  function down(axis, dir) {
    if (!ready || press) return
    const feed = axis === 'Z' ? settings.feedZ : settings.feedXY
    const p = { held: false, tap: () => jogger.step(axis, dir * settings.step, feed) }
    p.timer = setTimeout(() => { p.held = true; jogger.start(axis, dir, feed) }, HOLD_MS)
    press = p
  }

  function up() {
    const p = press
    if (!p) return
    press = null
    clearTimeout(p.timer)
    if (p.held) jogger.stop()
    else p.tap()
  }

  // A cancelled touch, lost focus or hidden page stops motion and never fires a tap.
  function cancel() {
    const p = press
    if (!p) return
    press = null
    clearTimeout(p.timer)
    if (p.held) jogger.stop()
  }

  // Alarm or disconnect mid-hold: stop. (Jog buttons are never `disabled`, which would swallow pointerup.)
  $effect(() => { if (!ready) cancel() })

  const pointer = (axis, dir) => ({
    onpointerdown: e => { e.currentTarget.setPointerCapture(e.pointerId); down(axis, dir) },
    onpointerup: up,
    onpointercancel: cancel,
    oncontextmenu: e => e.preventDefault(),
  })

  function keydown(e) {
    if (e.target.closest?.('input, textarea')) return
    if (e.key === '[' || e.key === ']') {
      const i = STEPS.indexOf(settings.step) + (e.key === ']' ? 1 : -1)
      settings.step = STEPS[Math.max(0, Math.min(STEPS.length - 1, i))]
      return
    }
    const k = KEYS[e.key]
    if (!k) return
    e.preventDefault()
    if (!e.repeat) down(...k)
  }

  function keyup(e) {
    if (KEYS[e.key]) up()
  }
</script>

<svelte:window onkeydown={keydown} onkeyup={keyup} onblur={cancel} />
<svelte:document onvisibilitychange={cancel} />

<div class="panel pad">
  <div class="steps">
    {#each STEPS as s}
      <button class:on={settings.step === s} onclick={() => (settings.step = s)}>{s}</button>
    {/each}
  </div>

  <div class="grid" class:off={!ready}>
    <span></span>
    <button class="arrow" {...pointer('Y', 1)}>Y+</button>
    <span></span>
    <button class="arrow z" {...pointer('Z', 1)}>Z+</button>

    <button class="arrow" {...pointer('X', -1)}>X−</button>
    <span class="hint">{settings.step} mm<br />hold to run</span>
    <button class="arrow" {...pointer('X', 1)}>X+</button>
    <span></span>

    <span></span>
    <button class="arrow" {...pointer('Y', -1)}>Y−</button>
    <span></span>
    <button class="arrow z" {...pointer('Z', -1)}>Z−</button>
  </div>

  <label>XY speed <input type="range" min="100" max="6000" step="100" bind:value={settings.feedXY} /><span class="mono">{settings.feedXY}</span></label>
  <label>Z speed <input type="range" min="50" max="1500" step="50" bind:value={settings.feedZ} /><span class="mono">{settings.feedZ}</span></label>
</div>

<style>
  .pad { display: grid; gap: 12px; }
  .steps { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
  .steps .on { color: white; background: var(--accent); border-color: var(--accent); }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr) 0.9fr; gap: 8px; }
  .grid.off { opacity: 0.45; }
  .arrow { min-height: 72px; font-size: 20px; font-weight: 700; touch-action: none; }
  .z { background: color-mix(in srgb, var(--accent) 18%, var(--btn)); }
  .hint { display: grid; place-items: center; font-size: 12px; text-align: center; color: var(--muted); }
  label { display: grid; grid-template-columns: 72px 1fr 52px; align-items: center; gap: 8px; font-size: 14px; color: var(--muted); }
</style>
```

- [ ] **Step 2: Add the pad to `src/App.svelte`**

Change the import block and the jog section to:
```svelte
  import TopBar from './components/TopBar.svelte'
  import Dro from './components/Dro.svelte'
  import JogPad from './components/JogPad.svelte'
  import Console from './components/Console.svelte'
```
```svelte
  <section class:off={tab !== 'jog'}>
    <Dro />
    <JogPad />
  </section>
```

- [ ] **Step 3: Build**

Run: `npm run build && ls -l dist/index.html.gz`
Expected: the build succeeds and `index.html.gz` is under 100 KB.

- [ ] **Step 4: Check against the fake in a browser (desktop and phone width)**

Run `npm run fake` and `npm run dev`, then open `http://localhost:5173` and press Unlock.

Expected:
- **Tap:** with step 10 selected, tapping X+ moves X by exactly 10.000.
- **Hold:** holding Y+ for about 2 s moves Y steadily. On release the motion stops at once and the state returns to `Idle`.
- **Keyboard:**
  - Arrow keys tap X and Y; holding an arrow key runs.
  - PgUp and PgDn move Z.
  - `[` and `]` change the highlighted step.
  - Keys typed into the console input do not jog.
- **Disconnect mid-hold:** holding a jog button and then stopping the fake keeps the button from sticking. After reconnecting, the machine is not jogging.
- **Phone width:** at 375 px wide (browser device mode), the Jog tab shows the readout, the step buttons, a 3×3 XY pad with a Z column, and the speed sliders, with no sideways scrolling. Long-pressing a jog button shows no context menu or text selection.

- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "Add jog pad: tap steps, hold-to-run, keyboard jogging and speed sliders"
```

---

### Task 7: First contact with the real machine (done by the user, hands near the e-stop)

The sandbox can't reach the board, so the user runs these steps. Nothing here changes code unless a check fails.

- [ ] **Step 1: Find the firmware version**

In the stock WebUI console, or in HighRoller's console in Step 2, run `$Build/Info` and note the FluidNC version. This decides the file endpoints for build-order step 2 (WebDAV on 4.x, `/upload` and `/files` on 3.x).

- [ ] **Step 2: Point the dev server at the board**

Run: `VITE_FLUIDNC_HOST=192.168.40.174 npm run dev`, then open `http://localhost:5173`.

Expected:
- The badge shows "Connected".
- The state matches the machine.
- The console shows replies to `$X`, or Home works.

- [ ] **Step 3: Check jogging and STOP on the machine**

Expected:
- A tap at a 1 mm step moves 1 mm.
- Holding at a low XY speed (around 600) moves smoothly and stops on release.
- STOP during a slow `G1 X50 F300` halts without an alarm.
- Turning Wi-Fi off on the computer mid-hold stops the machine within about half a second.

- [ ] **Step 4: Optional, try it from the board itself**

1. Run `npm run build`.
2. Upload `dist/index.html.gz` as `highroller.html.gz` with the stock WebUI's flash file manager.
3. Open `http://192.168.40.174/highroller.html` on a phone.

Expected: same behaviour as Step 2. The stock WebUI at `/` is untouched.

---

## Carry-forward from step 1's reviews

These items came out of the reviews and need handling in later build steps.

**Step 2, start here:**
- **Make STOP testable.** Move the STOP sequence out of `machine.svelte.js` into a plain `src/lib` function, and test it with fake timers: hold first, wait through `Run`, `Jog` and `Hold:1`, reset on `Hold:0` or `Idle`, give up after 2 s. Give the fake a `Hold:1` phase of about 200 ms.
- **Decide what STOP means during a job.** It now fires the moment it is pressed, so an accidental brush also aborts a running job. Consider making the press a feed hold (resumable), and keep the reset for a second press or a confirm.
- **Keep the protocol in one place.** Add `fnc.hold()`, `fnc.resume()` and `fnc.jogCancel()`, so real-time byte values live only in `fluidnc.js`.
- **Treat override values as read-only.** Override maths must not mutate `status.ov`, because snapshots share that array. Also mark `EMPTY`'s `wco` and `ov` as unknown until the first report arrives.
- **Track pointers per press.** Store the `pointerId` in the jog press, and ignore buttons other than the main one.
- **Keep app commands out of the console.** Don't echo the app's own query replies (`$/axes/…`) there.

**Steps 3–4 (probing and calibration chain commands):**
- **Per-command options.** Add `send(line, { quiet, timeoutMs })` with a per-command reply timeout.
- **Ignore stale replies after a reset.** Ignore `ok` and `error` replies until FluidNC's `Grbl …` startup line arrives.
- **Reconnecting after `$Bye`.** Remember which websocket address last worked and add a connect timeout, so a reboot isn't retried on the wrong port.

**Task 7 additions (on the real machine):**
- **Firmware version:** run `$Build/Info`, and check that the first status report includes WCO and Ov.
- **Wi-Fi drop:** turn Wi-Fi off during a hold at the Z slider's maximum, moving Z+ (away from the work). The machine should stop within about a second.
- **STOP on the phone:** try press-and-slide and long-press.
- **STOP at full speed:** STOP during a full-speed G0 should end at Idle with no alarm.
- **Output pins:** note which spare outputs the Jackpot has (needed for build step 5).
