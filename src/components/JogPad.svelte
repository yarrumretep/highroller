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
