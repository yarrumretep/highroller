<script>
  import { machine } from '../lib/machine.svelte.js'
  import { flatness } from '../lib/flatness.svelte.js'
  import { resultLines } from '../lib/flatnessProbe.js'
  import Sheet from './Sheet.svelte'
  import FlatnessReport from './FlatnessReport.svelte'
  import SurfacingDialog from './SurfacingDialog.svelte'

  // onopen: the surfacing file is open in the Job panel, so show it
  let { onstart, onflatten, onopen } = $props()
  const canStart = $derived(!!machine.config && machine.status.state === 'Idle' && machine.conn === 'open')
  let showMap = $state(false)
  let surfacing = $state(false)
  // The surfacing fields outlive the panel; the depth follows each new flatness map (or none) until it is edited.
  const cut = $state({ diameter: 25.4, stepoverPct: 40, depth: 0.5, depthPerPass: 0.5, feed: 2500, plungeFeed: 300, safeZ: 5 })
  $effect(() => { const d = flatness.last?.report.depth; cut.depth = d > 0 ? d : 0.5 })
</script>

<div class="panel ops">
  <h2>Operations</h2>
  <button class="go" disabled={!canStart} onclick={onstart}>Calibrate</button>
  <button class="go" disabled={!canStart} onclick={onflatten}>Flatness map</button>
  {#if flatness.last}
    <button class="link" onclick={() => (showMap = true)}>Last map at {new Date(flatness.last.at).toLocaleTimeString()}: {resultLines(flatness.last.report).verdict}</button>
  {/if}
  <button class="go" disabled={machine.conn !== 'open'} onclick={() => (surfacing = true)}>Surfacing pass</button>
  {#if !machine.config}<p class="muted">Waiting for the machine's config (it is read while idle).</p>{/if}
</div>

{#if showMap}
  <Sheet title="Flatness map" onclose={() => (showMap = false)}><FlatnessReport map={flatness.last} /></Sheet>
{/if}
{#if surfacing}<SurfacingDialog {cut} {onopen} onclose={() => (surfacing = false)} />{/if}

<style>
  .ops { display: grid; gap: 8px; }
  h2 { margin: 0; font-size: 18px; }
  p { margin: 0; font-size: 14px; }
  .muted { color: var(--muted); }
  .go { min-height: 52px; font-size: 17px; font-weight: 700; color: white; background: var(--accent); border-color: var(--accent); }
  .link { min-height: 36px; padding: 0; font-size: 14px; text-align: left; color: var(--accent); background: none; border: none; text-decoration: underline; }
</style>
