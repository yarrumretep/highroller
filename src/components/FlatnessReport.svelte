<script>
  import { resultLines } from '../lib/flatnessProbe.js'
  import { zeroBlocked, zeroAt } from '../lib/flatness.svelte.js'

  // map: a flatness map as the routine returns it ({ report, grid, zeroLine, configText }), plus `at` once kept
  let { map } = $props()
  const r = $derived(map.report)
  const g = $derived(map.grid)
  const l = $derived(resultLines(map.report))
  let zeroed = $state('') // what the controller said to the zero
</script>

{#if map.at}<p class="muted">Probed {new Date(map.at).toLocaleString()}, {g.cols} × {g.rows} points.</p>{/if}
<p class="muted">Seen from above (Y-max at the top, X-max on the right), in mm below the highest point, which is marked.</p>
<table class="map mono">
  <tbody>
    {#each Array.from({ length: g.rows }, (_, k) => g.rows - 1 - k) as j}
      <tr>
        {#each r.heights.slice(j * g.cols, (j + 1) * g.cols) as h}
          <td class:top={h.rel === 0}>{(Math.abs(h.rel) < 0.005 ? 0 : h.rel).toFixed(2)}</td>
        {/each}
      </tr>
    {/each}
  </tbody>
</table>
<p>{l.tilt}</p>
<p>{l.flatness}</p>
<p><strong>{l.verdict}</strong></p>
<p class="muted">Work Z0 on the table at the highest point. This line runs: <span class="mono">{map.zeroLine}</span></p>
<button class="go" disabled={!!zeroBlocked(map)} title={zeroBlocked(map)} onclick={async () => (zeroed = await zeroAt(map.zeroLine))}>Zero Z at the highest point</button>
{#if zeroBlocked(map)}<p class="muted">{zeroBlocked(map)}</p>{/if}
{#if zeroed}<p>{zeroed}</p>{/if}

<style>
  p { margin: 0; font-size: 16px; line-height: 1.4; }
  .muted { color: var(--muted); }
  .go { min-height: 56px; font-size: 18px; font-weight: 700; color: white; background: var(--ok); border-color: var(--ok); }
  .map { border-collapse: collapse; width: 100%; font-size: 15px; text-align: center; }
  .map td { padding: 8px 4px; border: 1px solid var(--line); }
  .map .top { font-weight: 800; color: white; background: var(--ok); }
</style>
