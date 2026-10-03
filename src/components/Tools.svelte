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
