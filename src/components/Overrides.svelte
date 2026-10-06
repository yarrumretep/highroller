<script>
  import { machine, fnc, send } from '../lib/machine.svelte.js'
  import { overrideBytes, RAPID } from '../lib/overrides.js'
  import { noJob } from '../lib/job.svelte.js'
  import { confirm as ask } from '../lib/confirm.svelte.js'

  // A relay spindle (the router, and whatever shares its relay) is on or off: M3 and M5, no speed and no override.
  // On shows as the programmed speed in every report's FS field (A:S would say so too, but only every tenth report).
  const relay = $derived(!!machine.config?.onOff)
  const routerOn = $derived((machine.status.spindle ?? 0) > 0)
  const canSwitch = $derived(machine.conn === 'open' && machine.status.state === 'Idle' && noJob())
  let switching = $state(false)
  async function router() {
    if (switching) return
    if (!routerOn && !(await ask({ title: 'Start the router?', text: 'Hands clear of the bit. M5 or STOP stops it.', ok: 'Start' }))) return
    switching = true
    await send(routerOn ? 'M5' : 'M3 S1000')
    switching = false
  }

  const ov = $derived(machine.status.ov ?? [100, 100, 100])
  const live = $derived(machine.conn === 'open' && !!machine.status.ov) // unknown until a report carries Ov

  // Ov comes in only every 10th report or so: step from the last target until a report shows it.
  const targets = { feed: null, spindle: null }
  function set(kind, to) {
    const idx = kind === 'feed' ? 0 : 2
    const from = targets[kind] ?? ov[idx]
    const bytes = overrideBytes(kind, from, to)
    for (const b of bytes) fnc.realtime(b)
    targets[kind] = Math.min(200, Math.max(10, Math.round(to)))
  }
  $effect(() => {
    if (ov[0] === targets.feed) targets.feed = null
    if (ov[2] === targets.spindle) targets.spindle = null
  })
  // The controller resets overrides to 100 on STOP, and a reconnect starts from an unknown value:
  // forget any target that was never reached, or the next drag computes from a stale one.
  $effect(() => {
    machine.stops
    machine.conn
    targets.feed = null
    targets.spindle = null
  })
</script>

<div class="panel ov">
  <label>
    <span>Feed</span>
    <input type="range" min="10" max="200" value={ov[0]} disabled={!live} onchange={e => set('feed', +e.currentTarget.value)} />
    <button class="mono" title="Back to 100 %" disabled={!live} onclick={() => set('feed', 100)}>{ov[0]}%</button>
  </label>
  <div class="rapid">
    <span>Rapid</span>
    {#each [25, 50, 100] as r}
      <button class:on={ov[1] === r} disabled={!live} onclick={() => fnc.realtime(RAPID[r])}>{r}%</button>
    {/each}
  </div>
  {#if relay}
    <div class="rapid router">
      <span>Router</span>
      <button class:on={routerOn} disabled={!canSwitch || switching} title={routerOn ? 'M5: switch the router off' : 'M3: switch the router on'} onclick={router}>{routerOn ? 'On' : 'Off'}</button>
    </div>
  {:else}
    <label>
      <span>Spindle</span>
      <input type="range" min="10" max="200" value={ov[2]} disabled={!live} onchange={e => set('spindle', +e.currentTarget.value)} />
      <button class="mono" title="Back to 100 %" disabled={!live} onclick={() => set('spindle', 100)}>{ov[2]}%</button>
    </label>
  {/if}
</div>

<style>
  .ov { display: grid; gap: 10px; }
  label, .rapid { display: grid; grid-template-columns: 64px 1fr 72px; align-items: center; gap: 8px; font-size: 14px; color: var(--muted); }
  .rapid { grid-template-columns: 64px repeat(3, 1fr); }
  .router { grid-template-columns: 64px 1fr; }
  .router button { min-height: 44px; font-weight: 700; }
  input[type='range'] { height: 44px; }
  .on { color: white; background: var(--accent); border-color: var(--accent); }
</style>
