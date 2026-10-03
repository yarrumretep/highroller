<script>
  import { onMount } from 'svelte'
  import { machine, fnc, send, stop, reloadConfig } from '../lib/machine.svelte.js'
  import { settings } from '../lib/settings.svelte.js'
  import { probeZ } from '../lib/probe.js'
  import { readFlash, writeFlash } from '../lib/flash.js'
  import { calibrate } from '../lib/calibration.js'
  import JogPad from './JogPad.svelte'

  let { onclose } = $props()
  let dialog
  // What the routine is showing right now: { kind: 'busy'|'step'|'ask'|'review'|'done'|'error', ... }
  let view = $state({ kind: 'busy', text: 'Starting…' })
  let answers = $state({})
  let ticked = $state([])
  let resolve = null // settles the pending io call

  // Probe arming for steps with `arm`: the probe input must close and open again.
  let seenClosed = false
  let armed = $state(false)
  $effect(() => {
    const p = machine.status.pins.includes('P')
    if (p) seenClosed = true
    else if (seenClosed) armed = true
  })

  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const idleOrAlarm = () => machine.conn === 'open' && (machine.status.state === 'Idle' || machine.status.state === 'Alarm')

  let backedUp = false
  const io = {
    settings,
    get config() { return machine.config },
    send,
    probe: () => probeZ(fnc),
    busy: text => (view = { kind: 'busy', text }),
    step: s => new Promise(r => { seenClosed = false; armed = false; resolve = r; view = { kind: 'step', ...s } }),
    ask: q => new Promise(r => { answers = {}; resolve = r; view = { kind: 'ask', ...q } }),
    review: r => new Promise(res => { ticked = r.changes.map(() => true); resolve = res; view = { kind: 'review', ...r } }),
    async apply(text) {
      const { name, text: old } = machine.config
      if (!backedUp) { await writeFlash(`${name}.bak`, old); backedUp = true }
      await writeFlash(name, text)
      await send('$Bye')
      view = { kind: 'busy', text: 'Restarting the controller…' }
      const t0 = Date.now()
      while (machine.conn === 'open' && Date.now() - t0 < 5000) await sleep(100)
      while (!idleOrAlarm() && Date.now() - t0 < 60000) await sleep(200)
      if (!idleOrAlarm()) throw new Error('The controller did not come back after the restart')
      machine.config = null
      view = { kind: 'busy', text: 'Homing…' }
      const r = await send('$H')
      if (!r.ok) throw new Error(`$H failed: ${r.error}`)
      await reloadConfig()
    },
  }

  onMount(() => {
    dialog.showModal()
    calibrate(io)
      .then(summary => (view = { kind: 'done', summary }))
      .catch(e => (view = { kind: 'error', text: e.message }))
  })

  function next() {
    const r = resolve
    resolve = null
    if (view.kind === 'ask') {
      const out = {}
      for (const f of view.fields) {
        const v = answers[f.name]
        out[f.name] = v === undefined || v === '' ? null : Number(v)
      }
      r(out)
    } else if (view.kind === 'review') r(view.changes.filter((_, i) => ticked[i]))
    else r()
  }
  const cancel = () => { resolve?.(null); onclose() }
  async function stopAll() {
    await stop() // the routine's next command is refused and it reports "Stopped"
    cancel()
  }
  const askReady = $derived(view.kind === 'ask' && view.fields.every(f => f.optional || Number(answers[f.name]) > 0))
</script>

<dialog bind:this={dialog} oncancel={e => { e.preventDefault(); cancel() }}>
  <header>
    <strong>{view.title ?? 'Calibrate'}</strong>
    <span class="state">{machine.status.state}</span>
    <button class="stop" onpointerdown={e => { e.preventDefault(); stopAll() }} onclick={e => e.detail === 0 && stopAll()}>STOP</button>
  </header>

  <section>
    {#if view.kind === 'busy'}
      <p>{view.text}</p>
    {:else if view.kind === 'step'}
      <p>{view.text}</p>
      {#if view.jog}<JogPad />{/if}
      {#if view.arm && !armed}<p class="muted">Waiting for the plate to touch the bit…</p>{/if}
      <button class="go" disabled={view.arm && !armed} onclick={next}>{view.arm ? 'Probe' : 'Continue'}</button>
    {:else if view.kind === 'ask'}
      <p>{view.text}</p>
      {#each view.fields as f}
        <label>{f.label}{f.optional ? ' (optional)' : ''} <input type="number" step="0.01" inputmode="decimal" bind:value={answers[f.name]} /> {f.unit}</label>
      {/each}
      <button class="go" disabled={!askReady} onclick={next}>Continue</button>
    {:else if view.kind === 'review'}
      {#each view.notes as n}<p>{n}</p>{/each}
      {#if view.changes.length}
        {#each view.changes as c, i}
          <label class="change"><input type="checkbox" bind:checked={ticked[i]} /> {c.label}: <span class="mono">{c.old} → {c.new}</span></label>
        {/each}
        <button class="go" onclick={next}>Apply, restart and home</button>
      {:else}
        <p>Nothing to change.</p>
      {/if}
    {:else if view.kind === 'done'}
      <p>{view.summary.applied ? 'Applied. Put fresh tape on the same spots and run again to check the result.' : 'Nothing was changed.'}</p>
      <p class="mono">Tilt {view.summary.tiltMm} mm · Skew {view.summary.skewMm} mm</p>
    {:else if view.kind === 'error'}
      <p class="err">{view.text}</p>
    {/if}
  </section>

  <footer>
    <button onclick={cancel}>{view.kind === 'done' || view.kind === 'error' ? 'Close' : 'Cancel'}</button>
  </footer>
</dialog>

<style>
  dialog { width: min(100vw, 560px); max-width: 100vw; height: 100vh; max-height: 100vh; margin: 0 auto; padding: 0; border: 0; color: var(--text); background: var(--bg); }
  dialog::backdrop { background: rgb(0 0 0 / 0.5); }
  header { position: sticky; top: 0; display: flex; align-items: center; gap: 10px; padding: 10px 12px; padding-top: calc(10px + env(safe-area-inset-top)); background: var(--panel); border-bottom: 1px solid var(--line); }
  .state { padding: 4px 12px; border-radius: 999px; background: var(--btn); font-weight: 700; }
  .stop { margin-left: auto; min-height: 52px; padding: 0 24px; font-size: 18px; font-weight: 800; color: white; background: var(--bad); border-color: var(--bad); touch-action: none; }
  section { display: grid; gap: 12px; padding: 16px 12px; }
  footer { padding: 12px; }
  p { margin: 0; font-size: 16px; line-height: 1.4; }
  .muted { color: var(--muted); }
  .err { color: var(--bad); }
  .go { min-height: 56px; font-size: 18px; font-weight: 700; color: white; background: var(--ok); border-color: var(--ok); }
  label { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 15px; }
  .change { padding: 6px 0; }
  input[type='number'] { width: 120px; min-height: 44px; padding: 0 8px; font-size: 18px; border: 1px solid var(--line); border-radius: 10px; background: var(--panel); }
  input[type='checkbox'] { width: 22px; height: 22px; }
  @media (min-width: 900px) { dialog { height: auto; max-height: 90vh; margin: 5vh auto; border-radius: 14px; } }
</style>
