<script>
  import { machine } from '../lib/machine.svelte.js'
  import { settings } from '../lib/settings.svelte.js'
  import { job, upload, refresh, noJob } from '../lib/job.svelte.js'
  import { flatness, zeroBlocked, zeroAt } from '../lib/flatness.svelte.js'
  import { resultLines } from '../lib/flatnessProbe.js'
  import { surfacingGcode, surfacingName } from '../lib/surfacing.js'

  // onopen: the surfacing file is open in the Job panel, so show it
  let { onstart, onflatten, onopen } = $props()
  // A blank, invalid or negative field keeps the previous value rather than becoming 0 (or negative).
  const num = (key, e) => {
    const v = e.currentTarget.value
    const n = Number(v)
    if (v === '' || !Number.isFinite(n) || n < 0) { e.currentTarget.value = settings[key]; return }
    settings[key] = n
  }
  const r3 = v => Math.round(v * 1000) / 1000
  const canStart = $derived(!!machine.config && machine.status.state === 'Idle' && machine.conn === 'open')

  let zeroed = $state('')
  $effect(() => { flatness.last; zeroed = '' }) // a new map: its zero has not been set yet

  const cut = $state({ diameter: 25.4, stepoverPct: 40, depth: 0.5, depthPerPass: 0.5, feed: 2500, plungeFeed: 300, safeZ: 5 })
  $effect(() => { const d = flatness.last?.report.depth; if (d > 0) cut.depth = d }) // a new map's depth, until it is edited
  const FIELDS = [
    ['diameter', 'Cutter diameter', 'mm', 0.1],
    ['stepoverPct', 'Stepover', '%', 1],
    ['depth', 'Depth from the highest point', 'mm', 0.05],
    ['depthPerPass', 'Depth per pass', 'mm', 0.05],
    ['feed', 'Feed', 'mm/min', 100],
    ['plungeFeed', 'Plunge feed', 'mm/min', 10],
    ['safeZ', 'Safe height', 'mm', 1],
  ]

  // Machine coordinates: the probed rectangle, else the travel less the margin
  const area = $derived.by(() => {
    if (flatness.last) return flatness.last.area
    const r = machine.config?.range
    if (!r) return null
    const m = settings.marginMm
    return { xMin: r.X.min + m, xMax: r.X.max - m, yMin: r.Y.min + m, yMax: r.Y.max - m }
  })
  const W = $derived(area ? r3(area.xMax - area.xMin) : 0)
  const H = $derived(area ? r3(area.yMax - area.yMin) : 0)
  const blocked = $derived.by(() => {
    const range = machine.config?.range
    if (!range || !area) return "Waiting for the machine's config (it is read while idle)"
    if (machine.conn !== 'open') return 'Not connected'
    if (!noJob()) return 'Wait until the job has finished'
    if (!FIELDS.every(([k]) => cut[k] > 0) || cut.stepoverPct > 100) return 'Every field needs a number above 0 (stepover up to 100 %)'
    if (!(W > 0 && H > 0)) return 'The area is empty: lower the margin'
    // Each row overhangs the area by the cutter's radius at both ends
    const rad = cut.diameter / 2
    if (area.xMin - rad < range.X.min || area.xMax + rad > range.X.max) return `The cutter would run past the X travel: raise the margin to at least ${Math.ceil(rad)} mm${flatness.last ? ' and probe again' : ''}`
    return ''
  })
  let making = $state(false)
  let failed = $state('') // why the last Create did not open the file (the Job panel is on another tab on a phone)

  async function create() {
    making = true
    failed = ''
    try {
      const a = { xMin: 0, xMax: W, yMin: 0, yMax: H }
      const name = surfacingName({ ...a, depth: cut.depth })
      const file = new File([surfacingGcode({ ...a, ...cut })], name, { type: 'text/plain' })
      const before = job.data
      job.error = ''
      await refresh('') // the root's listing, so a file of the same name is asked about before it is replaced
      await upload(file, '') // which opens it in the Job panel once it is up
      if (job.name === name && job.data !== before) onopen?.()
      else failed = job.error // empty when a replace was declined
    } finally {
      making = false
    }
  }
</script>

<div class="panel tool">
  <h2>Calibrate</h2>
  <p>Four V-bit dots on tape, one measuring session, one restart: Z tilt, squareness and steps per mm.</p>
  <button class="go" disabled={!canStart} onclick={onstart}>Start calibration</button>
  {#if !machine.config}<p class="muted">Waiting for the machine's config (it is read while idle).</p>{/if}
</div>

<div class="panel tool">
  <h2>Flatness</h2>
  <p>The touch plate at a grid of points: how far the table tilts, how far it is from flat, and how deep a surfacing pass must cut.</p>
  <button class="go" disabled={!canStart} onclick={onflatten}>Probe the table</button>
  {#if flatness.last}
    {@const l = resultLines(flatness.last.report)}
    <p class="muted">Probed at {new Date(flatness.last.at).toLocaleTimeString()}, {flatness.last.grid.cols} × {flatness.last.grid.rows} points:</p>
    <p>{l.tilt}</p>
    <p>{l.flatness}</p>
    <p><strong>{l.verdict}</strong></p>
    <p class="muted">Work X0 Y0 at the probed area's corner, Z0 on the table at the highest point: <span class="mono">{flatness.last.zeroLine}</span></p>
    <button disabled={!!zeroBlocked()} title={zeroBlocked()} onclick={async () => (zeroed = await zeroAt(flatness.last.zeroLine))}>Zero at the highest point</button>
    {#if zeroed}<p>{zeroed}</p>{/if}
  {/if}
</div>

<div class="panel form">
  <h2>Surfacing pass</h2>
  {#each FIELDS as [key, label, unit, step]}
    <label>{label} <input type="number" min="0" {step} bind:value={cut[key]} /> {unit}</label>
  {/each}
  {#if area}
    <p>Area {W} × {H} mm{flatness.last ? ' (the probed area)' : ' (the travel less the margin)'}.
      {#if flatness.last}Work X0 Y0 at the area's corner, Z0 at the highest point: use Zero at the highest point first.
      {:else}Work X0 Y0 at the area's corner (machine X{r3(area.xMin)} Y{r3(area.yMin)}), Z0 at the highest point: probe the table first, or set the zero by hand.{/if}
      The file stops before the first cut so the router can be switched on; Resume starts it.</p>
  {/if}
  <button class="go" disabled={!!blocked || making} onclick={create}>Create and open</button>
  {#if blocked}<p class="muted">{blocked}</p>{/if}
  {#if making}<p class="muted">Uploading to the SD card…</p>{/if}
  {#if failed}<p class="err">{failed}</p>{/if}
</div>

<div class="panel form">
  <h2>Settings</h2>
  <label>Touch plate thickness <input type="number" min="0" step="0.01" value={settings.plateMm} onchange={e => num('plateMm', e)} /> mm</label>
  <label>Tape thickness <input type="number" min="0" step="0.01" value={settings.tapeMm} onchange={e => num('tapeMm', e)} /> mm</label>
  <label>Dot depth below the tape <input type="number" min="0" step="0.1" value={settings.dotMm ?? 0.3} onchange={e => num('dotMm', e)} /> mm</label>
  <label>Gantry span (0 = use the X travel) <input type="number" min="0" step="1" value={settings.spanMm} onchange={e => num('spanMm', e)} /> mm</label>
  <label>Corner margin inside the travel <input type="number" min="0" step="1" value={settings.marginMm} onchange={e => num('marginMm', e)} /> mm</label>
  <p class="muted">If a pass makes things worse, the next pass swaps the motor side for you.</p>
</div>

<style>
  .tool, .form { display: grid; gap: 8px; }
  h2 { margin: 0; font-size: 18px; }
  p { margin: 0; font-size: 14px; }
  .muted { color: var(--muted); }
  .err { color: var(--bad); }
  .go { min-height: 52px; font-size: 17px; font-weight: 700; color: white; background: var(--accent); border-color: var(--accent); }
  label { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 14px; }
  input[type='number'] { width: 90px; min-height: 44px; padding: 0 8px; font-size: 16px; border: 1px solid var(--line); border-radius: 10px; background: var(--bg); }
</style>
