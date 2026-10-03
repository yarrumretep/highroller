<script>
  import { machine } from '../lib/machine.svelte.js'
  import { settings } from '../lib/settings.svelte.js'

  let { onstart } = $props()
  // A blank, invalid or negative field keeps the previous value rather than becoming 0 (or negative).
  const num = (key, e) => {
    const v = e.currentTarget.value
    const n = Number(v)
    if (v === '' || !Number.isFinite(n) || n < 0) { e.currentTarget.value = settings[key]; return }
    settings[key] = n
  }
</script>

<div class="panel tool">
  <h2>Calibrate</h2>
  <p>Four V-bit dots on tape, one measuring session, one restart: Z tilt, squareness and steps per mm.</p>
  <button class="go" disabled={!machine.config || machine.status.state !== 'Idle' || machine.conn !== 'open'} onclick={onstart}>Start calibration</button>
  {#if !machine.config}<p class="muted">Waiting for the machine's config (it is read while idle).</p>{/if}
</div>

<div class="panel form">
  <h2>Settings</h2>
  <label>Touch plate thickness <input type="number" min="0" step="0.01" value={settings.plateMm} onchange={e => num('plateMm', e)} /> mm</label>
  <label>Tape thickness <input type="number" min="0" step="0.01" value={settings.tapeMm} onchange={e => num('tapeMm', e)} /> mm</label>
  <label>Gantry span (0 = use the X travel) <input type="number" min="0" step="1" value={settings.spanMm} onchange={e => num('spanMm', e)} /> mm</label>
  <label>Corner margin inside the travel <input type="number" min="0" step="1" value={settings.marginMm} onchange={e => num('marginMm', e)} /> mm</label>
  <p class="muted">If a pass makes things worse, the next pass swaps the motor side for you.</p>
</div>

<style>
  .tool, .form { display: grid; gap: 8px; }
  h2 { margin: 0; font-size: 18px; }
  p { margin: 0; font-size: 14px; }
  .muted { color: var(--muted); }
  .go { min-height: 52px; font-size: 17px; font-weight: 700; color: white; background: var(--accent); border-color: var(--accent); }
  label { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 14px; }
  input[type='number'] { width: 90px; min-height: 44px; padding: 0 8px; font-size: 16px; border: 1px solid var(--line); border-radius: 10px; background: var(--bg); }
</style>
