<script>
  import Sheet from './Sheet.svelte'
  import { machine, send } from '../lib/machine.svelte.js'
  import { job, upload, refresh, noJob } from '../lib/job.svelte.js'
  import { flatness, stale } from '../lib/flatness.svelte.js'
  import { surfacingGcode, surfacingName } from '../lib/surfacing.js'
  import { unhomedNote } from '../lib/homing.js'

  // cut: the fields, owned by the caller so they outlive the panel; onopen: the file is open in the Job panel, show it
  let { cut, onopen, onclose } = $props()
  const r3 = v => Math.round(v * 1000) / 1000
  const FIELDS = [
    ['diameter', 'Cutter diameter', 'mm', 0.1],
    ['stepoverPct', 'Stepover', '%', 1],
    ['depth', 'Depth from the highest point', 'mm', 0.05],
    ['depthPerPass', 'Depth per pass', 'mm', 0.05],
    ['feed', 'Feed', 'mm/min', 100],
    ['plungeFeed', 'Plunge feed', 'mm/min', 10],
    ['safeZ', 'Safe height', 'mm', 1],
  ]

  // The whole reachable table, in machine coordinates: the travel inset by the cutter's radius + 1 mm on every side,
  // so a row's overshoot of one radius past each end stays inside the travel.
  const area = $derived.by(() => {
    const r = machine.config?.range
    if (!r || !(cut.diameter > 0)) return null
    const inset = cut.diameter / 2 + 1
    return { xMin: r3(r.X.min + inset), xMax: r3(r.X.max - inset), yMin: r3(r.Y.min + inset), yMax: r3(r.Y.max - inset) }
  })
  const W = $derived(area ? r3(area.xMax - area.xMin) : 0)
  const H = $derived(area ? r3(area.yMax - area.yMin) : 0)
  const originLine = $derived(area ? `G10 L2 P1 X${area.xMin} Y${area.yMin}` : '') // work X0 Y0 at the cut's corner; Z0 is left alone
  const blocked = $derived.by(() => {
    if (!machine.config?.range) return "Waiting for the machine's config (it is read while idle)"
    if (machine.conn !== 'open') return 'Not connected'
    if (!noJob()) return 'Wait until the job has finished'
    if (machine.status.state !== 'Idle') return `Wait for Idle (now ${machine.status.state})`
    if (flatness.last && stale(flatness.last)) return stale(flatness.last)
    if (!FIELDS.every(([k]) => cut[k] > 0) || cut.stepoverPct > 100) return 'Every field needs a number above 0 (stepover up to 100 %)'
    if (!(W > 0 && H > 0)) return 'The cutter is too wide for the travel'
    return ''
  })
  let making = $state(false)
  let failed = $state('') // why the last Create did not open the file

  async function create() {
    making = true
    failed = ''
    try {
      const a = { xMin: 0, xMax: W, yMin: 0, yMax: H }
      const name = surfacingName({ ...a, depth: cut.depth })
      // The file carries its own origin line too, so it cuts at this corner even if it is reopened later
      const file = new File([surfacingGcode({ ...a, ...cut, origin: { x: area.xMin, y: area.yMin } })], name, { type: 'text/plain' })
      if (machine.status.state !== 'Idle') return (failed = `Wait for Idle (now ${machine.status.state})`)
      // First the origin, so the Job preview shows the file where it will cut
      const r = await send(originLine)
      if (!r.ok) return (failed = `${originLine} failed: ${r.error}`)
      const moved = `Work X0 Y0 is now at the cut's corner (${originLine}). ` // from here on, say so if Create does not finish
      const before = job.data
      job.error = ''
      await refresh('') // the root's listing, so a file of the same name is asked about before it is replaced
      if (job.error) return (failed = moved + job.error) // no upload against a listing that could not be read
      await upload(file, '') // which opens it in the Job panel once it is up
      if (job.name === name && job.data !== before) { onopen?.(); onclose() }
      else failed = moved + (job.error || "Not replaced: the SD card's file was kept.")
    } catch (e) {
      failed = e.message
    } finally {
      making = false
    }
  }
</script>

<Sheet title="Surfacing pass" {onclose}>
  {#each FIELDS as [key, label, unit, step]}
    <label>{label} <input type="number" min="0" {step} bind:value={cut[key]} /> {unit}</label>
  {/each}
  {#if area}
    <p>Area {W} × {H} mm, the whole table the cutter can reach. Create sets work X0 Y0 at its corner (Z0 is yours: Zero Z at the highest point, or Probe Z0), sends <span class="mono">{originLine}</span>, uploads the file and opens it. The file stops before the first cut so the router can be switched on; Resume starts it.</p>
  {/if}
  <button class="go" disabled={!!blocked || making} onclick={create}>Create and open</button>
  {#if blocked}<p class="muted">{blocked}</p>{:else if unhomedNote(machine.homed, 'XY')}<p class="muted">{unhomedNote(machine.homed, 'XY')} The corner is in machine coordinates.</p>{/if}
  {#if making}<p class="muted">Uploading to the SD card…</p>{/if}
  {#if failed}<p class="err">{failed}</p>{/if}
</Sheet>

<style>
  p { margin: 0; font-size: 14px; line-height: 1.4; }
  .muted { color: var(--muted); }
  .err { color: var(--bad); }
  .go { min-height: 52px; font-size: 17px; font-weight: 700; color: white; background: var(--accent); border-color: var(--accent); }
  label { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 14px; }
  input[type='number'] { width: 90px; min-height: 44px; padding: 0 8px; font-size: 16px; border: 1px solid var(--line); border-radius: 10px; background: var(--panel); }
</style>
