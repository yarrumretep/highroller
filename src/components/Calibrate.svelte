<script module>
  // Shared across the lifetime of the page, not per dialog instance: a second calibration pass must not
  // overwrite the original config with the first pass's already-corrected one.
  let backedUp = false
</script>

<script>
  import { onMount } from 'svelte'
  import { machine, fnc, send as sendLine, stop, reloadConfig } from '../lib/machine.svelte.js'
  import { settings } from '../lib/settings.svelte.js'
  import { probeZ } from '../lib/probe.js'
  import { writeFlash } from '../lib/flash.js'
  import { calibrate } from '../lib/calibration.js'
  import JogPad from './JogPad.svelte'

  let { onclose } = $props()
  let dialog
  // What the routine is showing right now: { kind: 'busy'|'step'|'ask'|'review'|'done'|'error', ... }
  let view = $state({ kind: 'busy', text: 'Starting…' })
  let answers = $state({})
  let ticked = $state([])
  let resolve = null // settles the pending io call
  let reject = null // rejects it, so STOP/Cancel/unmount end the routine rather than letting it run on
  let primaryBtn = $state() // the step/ask/review's own action button, focused instead of STOP

  // Probe arming for steps with `arm`: the probe input must close and open again.
  let seenClosed = false
  let armed = $state(false)
  const pinClosed = $derived(machine.status.pins.includes('P'))
  $effect(() => {
    if (pinClosed) seenClosed = true
    else if (seenClosed) armed = true
  })

  // The last few lines actually sent, shown under a busy message so the user sees what is running.
  const sentLines = $derived(machine.log.filter(l => l.startsWith('> ')).slice(-3))
  // Cancel/Escape only make sense while the routine is paused waiting on the user, or once it has ended;
  // while busy (moving, probing, writing, restarting) STOP is the only control.
  const canCancel = $derived(view.kind !== 'busy')
  const closeLabel = $derived(view.kind === 'done' || view.kind === 'error' || (view.kind === 'review' && !view.changes.length) ? 'Close' : 'Cancel')

  $effect(() => { view; primaryBtn?.focus() })

  const sleep = ms => new Promise(r => setTimeout(r, ms))

  let stopped = null // set once STOP, Cancel or an unmount ends the routine; every io call checks it
  const throwIfStopped = () => { if (stopped) throw stopped }

  const io = {
    settings,
    get config() { return machine.config },
    async send(line) {
      throwIfStopped()
      const r = await sendLine(line)
      throwIfStopped()
      return r
    },
    async probe() {
      throwIfStopped()
      const r = await probeZ(fnc)
      throwIfStopped()
      return r
    },
    busy: text => (view = { kind: 'busy', text }),
    step: s => new Promise((res, rej) => { seenClosed = false; armed = false; resolve = res; reject = rej; view = { kind: 'step', ...s } }),
    ask: q => new Promise((res, rej) => { answers = {}; resolve = res; reject = rej; view = { kind: 'ask', ...q } }),
    review: r => new Promise((res, rej) => { ticked = r.changes.map(() => true); resolve = res; reject = rej; view = { kind: 'review', ...r } }),
    async apply(text) {
      throwIfStopped()
      const { name, text: old } = machine.config
      // ponytail: the .bak is read back over the websocket ($LocalFS/Show), which drops blank lines; it is
      // line-exact otherwise, which is all a backup needs to be.
      if (!backedUp) { await writeFlash(`${name}.bak`, old); backedUp = true }
      throwIfStopped()
      await writeFlash(name, text)
      machine.config = null // the file on flash no longer matches what's loaded; stays unknown until the restart reloads it
      throwIfStopped()
      if (machine.conn !== 'open') throw new Error(`Lost the connection before the restart. The new config is on the board's flash as ${name}; ${name}.bak holds the old one.`)
      const staleStatus = machine.status // the report from before $Bye; still around after reconnecting, so it must not be mistaken for a fresh one
      const r = await sendLine('$Bye')
      throwIfStopped()
      if (!(r.ok || r.error === 'disconnected')) throw new Error(`$Bye failed: ${r.error}`)
      view = { kind: 'busy', text: 'Restarting the controller…' }
      const t0 = Date.now()
      while (machine.conn === 'open') {
        if (Date.now() - t0 > 5000) throw new Error('The board did not restart; the new config is written but not loaded')
        throwIfStopped()
        await sleep(100)
        throwIfStopped()
      }
      const deadline = t0 + 60000
      while (!(machine.conn === 'open' && machine.status !== staleStatus && (machine.status.state === 'Idle' || machine.status.state === 'Alarm'))) {
        if (Date.now() > deadline) throw new Error(`The controller did not come back after the restart. The new config is on the board's flash as ${name}; ${name}.bak holds the old one.`)
        throwIfStopped()
        await sleep(200)
        throwIfStopped()
      }
      view = { kind: 'busy', text: 'Homing…' }
      const hr = await sendLine('$H')
      throwIfStopped()
      if (!hr.ok) throw new Error(`$H failed: ${hr.error}`)
      await reloadConfig()
    },
  }

  function abort() {
    if (stopped) return
    stopped = new Error('Stopped')
    const rj = reject
    resolve = reject = null
    rj?.(stopped)
  }

  onMount(() => {
    dialog.showModal()
    calibrate(io)
      .then(summary => (view = { kind: 'done', summary }))
      .catch(e => (view = { kind: 'error', text: e.message }))
    return abort // an unmount (e.g. the dialog is torn down some other way) ends the routine too
  })

  function next() {
    const r = resolve
    resolve = reject = null
    if (!r) return // a stray second press while the view is already moving on
    let value
    if (view.kind === 'ask') {
      const out = {}
      for (const f of view.fields) {
        const v = answers[f.name]
        out[f.name] = v === undefined || v === '' ? null : Number(v)
      }
      value = out
    } else if (view.kind === 'review') {
      value = view.changes.filter((_, i) => ticked[i])
    }
    view = { kind: 'busy', text: 'Working…' } // disables Continue at once, so a second press can't call a null resolver
    r(value)
  }
  function cancel() {
    abort()
    onclose()
  }
  async function stopAll() {
    abort() // ends the routine now; it does not wait for the reset below
    await stop() // the dialog stays open to show how the routine ended
  }
  const askReady = $derived(view.kind === 'ask' && view.fields.every(f => f.optional || Number(answers[f.name]) > 0))
</script>

<dialog bind:this={dialog} aria-labelledby="cal-title" oncancel={e => { e.preventDefault(); if (canCancel) cancel() }}>
  <header>
    <strong id="cal-title">{view.title ?? 'Calibrate'}</strong>
    <span class="state">{machine.status.state}</span>
    <button class="stop" onpointerdown={e => { e.preventDefault(); stopAll() }} onclick={e => e.detail === 0 && stopAll()}>STOP</button>
  </header>

  <section>
    {#if view.kind === 'busy'}
      <p>{view.text}</p>
      {#if sentLines.length}<pre class="mono lines">{sentLines.join('\n')}</pre>{/if}
    {:else if view.kind === 'step'}
      <p>{view.text}</p>
      {#if view.jog}<JogPad />{/if}
      {#if view.lines?.length}
        <div class="lines">
          <p class="muted">These lines run next:</p>
          <pre class="mono">{view.lines.join('\n')}</pre>
        </div>
      {/if}
      {#if view.arm && !armed}<p class="muted">Waiting for the plate to touch the bit…</p>{/if}
      <button class="go" bind:this={primaryBtn} disabled={view.arm && (!armed || pinClosed)} onclick={next}>{view.arm ? 'Probe' : 'Continue'}</button>
    {:else if view.kind === 'ask'}
      <p>{view.text}</p>
      {#each view.fields as f}
        <label>{f.label}{f.optional ? ' (optional)' : ''} <input type="number" step="0.01" inputmode="decimal" bind:value={answers[f.name]} /> {f.unit}</label>
      {/each}
      <button class="go" bind:this={primaryBtn} disabled={!askReady} onclick={next}>Continue</button>
    {:else if view.kind === 'review'}
      {#each view.notes as n}<p>{n}</p>{/each}
      {#if view.changes.length}
        {#each view.changes as c, i}
          <label class="change"><input type="checkbox" bind:checked={ticked[i]} /> {c.label}: <span class="mono">{c.old} → {c.new}</span></label>
        {/each}
        <button class="go" bind:this={primaryBtn} onclick={next}>Apply, restart and home</button>
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
    <button disabled={!canCancel} onclick={cancel}>{closeLabel}</button>
  </footer>
</dialog>

<style>
  dialog { width: min(100vw, 560px); max-width: 100vw; height: 100dvh; max-height: 100dvh; margin: 0 auto; padding: 0; border: 0; color: var(--text); background: var(--bg); }
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
  .change { min-height: 44px; padding: 6px 0; }
  .lines { display: grid; gap: 4px; }
  .lines pre, pre.lines { margin: 0; padding: 8px 10px; font-size: 13px; line-height: 1.5; white-space: pre-wrap; word-break: break-all; background: var(--panel); border: 1px solid var(--line); border-radius: 10px; }
  input[type='number'] { width: 120px; min-height: 44px; padding: 0 8px; font-size: 18px; border: 1px solid var(--line); border-radius: 10px; background: var(--panel); }
  input[type='checkbox'] { width: 22px; height: 22px; }
  @media (min-width: 900px) { dialog { height: auto; max-height: 90vh; margin: 5vh auto; border-radius: 14px; } }
</style>
