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
