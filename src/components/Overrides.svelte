<script>
  import { machine, fnc } from '../lib/machine.svelte.js'
  import { overrideBytes, RAPID } from '../lib/overrides.js'

  const ov = $derived(machine.status.ov)
  const live = $derived(machine.conn === 'open')

  function set(kind, from, to) {
    for (const b of overrideBytes(kind, from, to)) fnc.realtime(b)
  }
</script>

<div class="panel ov">
  <label>
    <span>Feed</span>
    <input type="range" min="10" max="200" value={ov[0]} disabled={!live} onchange={e => set('feed', ov[0], +e.currentTarget.value)} />
    <button class="mono" title="Back to 100 %" disabled={!live} onclick={() => set('feed', ov[0], 100)}>{ov[0]}%</button>
  </label>
  <div class="rapid">
    <span>Rapid</span>
    {#each [25, 50, 100] as r}
      <button class:on={ov[1] === r} disabled={!live} onclick={() => fnc.realtime(RAPID[r])}>{r}%</button>
    {/each}
  </div>
  <!-- ponytail: shown for every spindle; build step 4 hides it for on/off relay spindles once it reads the config -->
  <label>
    <span>Spindle</span>
    <input type="range" min="10" max="200" value={ov[2]} disabled={!live} onchange={e => set('spindle', ov[2], +e.currentTarget.value)} />
    <button class="mono" title="Back to 100 %" disabled={!live} onclick={() => set('spindle', ov[2], 100)}>{ov[2]}%</button>
  </label>
</div>

<style>
  .ov { display: grid; gap: 10px; }
  label, .rapid { display: grid; grid-template-columns: 64px 1fr 72px; align-items: center; gap: 8px; font-size: 14px; color: var(--muted); }
  .rapid { grid-template-columns: 64px repeat(3, 1fr); }
  input[type='range'] { height: 44px; }
  .on { color: white; background: var(--accent); border-color: var(--accent); }
</style>
