<script module>
  // Shared across the lifetime of the page, not per dialog instance: once this page has seen <name>.bak on
  // the flash (or written it), later passes skip listing the flash for it.
  let backedUp = false
</script>

<script>
  import { onMount } from 'svelte'
  import { machine, fnc, send as sendLine, stop, reloadConfig } from '../lib/machine.svelte.js'
  import { settings, loadSettings } from '../lib/settings.svelte.js'
  import { probeZ } from '../lib/probe.js'
  import { readFlash, writeFlash, listFlash } from '../lib/flash.js'
  import { calibrate, badEdit } from '../lib/calibration.js'
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
  let selfClosed = false // true once we've asked the dialog to close itself (see the native onclose below)

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
  // A pin change during an arm step is the one case where the Probe button's own enabled state
  // changes without `view` changing — refocus then, and only then: a pin change elsewhere (the clip
  // can still be on the bit while the measurement form is up) must not steal focus from a field being
  // typed into, and must not turn a checkbox's Space into pressing Apply in the review.
  // The same goes for a "make the dot" step, whose Continue waits for the plate to come off the bit.
  $effect(() => { if (view.kind === 'step' && !pinClosed && ((view.arm && armed) || view.plateOff)) primaryBtn?.focus() })

  const sleep = ms => new Promise(r => setTimeout(r, ms))

  let stopped = null // set once STOP, Cancel or an unmount ends the routine; every io call checks it
  const throwIfStopped = () => { if (stopped) throw stopped }

  const io = {
    settings,
    async readConfig() {
      throwIfStopped()
      const config = await reloadConfig()
      throwIfStopped()
      return config
    },
    async send(line) {
      throwIfStopped()
      const r = await sendLine(line)
      throwIfStopped()
      return r
    },
    async probe() {
      throwIfStopped()
      try {
        return await probeZ(fnc)
      } finally {
        throwIfStopped() // a STOP while probing fails the probe too; report the STOP, not the probe
      }
    },
    busy: text => (view = { kind: 'busy', text }),
    step: s => new Promise((res, rej) => { seenClosed = false; armed = false; resolve = res; reject = rej; view = { kind: 'step', ...s } }),
    ask: q => new Promise((res, rej) => {
      answers = Object.fromEntries(Object.entries(q.values ?? {}).filter(([, v]) => v != null)) // asked again: keep what was typed
      resolve = res; reject = rej; view = { kind: 'ask', ...q }
    }),
    review: r => new Promise((res, rej) => { ticked = r.changes.map(() => true); resolve = res; reject = rej; view = { kind: 'review', ...r } }),
    // The second argument is the config the pass was computed from.
    async apply(text, { name, text: old }) {
      throwIfStopped()
      // Once `written`, the new config is on flash even if the routine stops here. `restarting` is
      // set just before $Bye goes out — while it's in flight we can't tell whether the board already
      // has it, so that case gets its own, admittedly-uncertain message. `restarted` means the result
      // came back and was accepted: the board is on its way down for real.
      let written = false, restarting = false, restarted = false
      const checkStopped = () => {
        if (!stopped) return
        if (!written) throw stopped
        if (!restarting) throw new Error(`Stopped. The new config is on the board's flash as ${name} but not loaded; ${name}.bak holds the old one.`)
        if (!restarted) throw new Error(`Stopped while the restart was being sent; the new ${name} is on flash and loads at the next restart; ${name}.bak holds the old one.`)
        throw new Error(`Stopped. The board is restarting with the new ${name} and has not been homed; ${name}.bak holds the old one.`)
      }
      // The file must still be the one this pass was computed from (another device may have changed it), and the
      // edit must still look like the config. Both texts are the file's exact bytes, read over HTTP.
      const current = await readFlash(name)
      checkStopped()
      if (current !== old) throw new Error('The config changed since this pass started, so nothing was written. Run the pass again.')
      const bad = badEdit(old, text)
      if (bad) throw new Error(`The edited config doesn't look right (${bad}), so nothing was written.`)
      // One backup, of the config as it was before the first calibration: an existing .bak is kept.
      if (!backedUp) {
        if (!(await listFlash()).some(f => f.name === `${name}.bak`)) await writeFlash(`${name}.bak`, old)
        backedUp = true
      }
      checkStopped()
      try {
        await writeFlash(name, text)
      } catch (e) {
        throw new Error(`${e.message}. Don't restart the controller: ${name} on its flash may be incomplete. ${name}.bak holds the original; put it back as ${name} with the stock WebUI.`)
      }
      written = true
      machine.config = null // the file on flash no longer matches what's loaded; stays unknown until the restart reloads it
      checkStopped()
      if (machine.conn !== 'open') throw new Error(`Lost the connection before the restart. The new config is on the board's flash as ${name}; ${name}.bak holds the old one.`)
      restarting = true // about to send; a STOP landing during the await below can't know if the board got it
      const r = await sendLine('$Bye')
      checkStopped()
      if (!(r.ok || r.error === 'disconnected')) throw new Error(`$Bye failed: ${r.error}`)
      restarted = true
      view = { kind: 'busy', text: 'Restarting the controller…' }
      const t0 = Date.now()
      while (machine.conn === 'open') {
        if (Date.now() - t0 > 5000) throw new Error('The board did not restart; the new config is written but not loaded')
        checkStopped()
        await sleep(100)
        checkStopped()
      }
      // Captured now, not before $Bye: a status report that arrived just before the link actually
      // dropped would otherwise look "fresh" (a new object) while still being pre-restart data.
      const staleStatus = machine.status
      const deadline = t0 + 60000
      while (!(machine.conn === 'open' && machine.status !== staleStatus && (machine.status.state === 'Idle' || machine.status.state === 'Alarm'))) {
        if (Date.now() > deadline) throw new Error(`The controller did not come back after the restart. The new config is on the board's flash as ${name}; ${name}.bak holds the old one.`)
        checkStopped()
        await sleep(200)
        checkStopped()
      }
      view = { kind: 'busy', text: 'Homing…' }
      const hr = await sendLine('$H')
      checkStopped()
      // A config FluidNC rejects leaves it in ConfigAlarm, which reports as Alarm and refuses $H.
      if (!hr.ok) throw new Error(`$H failed: ${hr.error}. If the controller is in alarm it may have rejected the new ${name}: restore ${name}.bak as ${name} with the stock WebUI, then restart it.`)
      await reloadConfig().catch(() => {}) // logged; the idle trigger tries again
      // The settings are read again after the restart; the pass's own numbers go in only once that is done.
      if (!(await loadSettings())) throw new Error(`Applied and homed, but highroller.json could not be read back, so this pass's numbers were not saved.`)
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
    selfClosed = true
    dialog?.close()
    onclose()
  }
  async function stopAll() {
    abort() // ends the routine now; it does not wait for the reset below
    await stop() // the dialog stays open to show how the routine ended
  }
  const askReady = $derived(view.kind === 'ask' && view.fields.every(f => f.optional || Number(answers[f.name]) > 0))
</script>

<dialog
  bind:this={dialog}
  aria-labelledby="cal-title"
  oncancel={e => { e.preventDefault(); if (canCancel) cancel() }}
  onclose={() => {
    if (selfClosed) return // we asked for this; cancel() already did everything else
    // Closed on its own: a second Escape while busy can bypass our preventDefault (Chromium's close
    // watcher only honours one prevented cancel without new user activation). While busy, the routine
    // is still running — reopen so STOP stays the only way out; otherwise treat it like a Cancel.
    if (view.kind === 'busy') dialog.isConnected && dialog.showModal()
    else cancel()
  }}
>
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
      {#if view.error}<p class="err">{view.error}</p>{/if}
      {#if view.jog}<JogPad zOnly={view.jog === 'z'} />{/if}
      {#if view.lines?.length}
        <div class="lines">
          <p class="muted">These lines run next:</p>
          <pre class="mono">{view.lines.join('\n')}</pre>
        </div>
      {/if}
      {#if view.arm && !armed}<p class="muted">Waiting for the plate to touch the bit…</p>{/if}
      {#if view.plateOff && pinClosed}<p class="muted">The plate is still touching the bit.</p>{/if}
      <button class="go" bind:this={primaryBtn} disabled={(view.arm && !armed) || ((view.arm || view.plateOff) && pinClosed)} onclick={next}>{view.arm ? 'Probe' : 'Continue'}</button>
    {:else if view.kind === 'ask'}
      <p>{view.text}</p>
      {#if view.error}<p class="err">{view.error}</p>{/if}
      {#each view.fields as f}
        <label>{f.label}{f.optional ? ' (optional)' : ''} <input type="number" step="0.01" inputmode="decimal" bind:value={answers[f.name]} /> {f.unit}</label>
      {/each}
      <button class="go" bind:this={primaryBtn} disabled={!askReady} onclick={next}>Continue</button>
    {:else if view.kind === 'review'}
      {#each view.notes as n}<p>{n}</p>{/each}
      {#if view.changes.length}
        {#each view.changes as c, i}
          <label class="change"><input type="checkbox" bind:checked={ticked[i]} /> {c.label}: <span class="mono">{c.edits.map(e => `${e.label ? e.label + ' ' : ''}${e.old} → ${e.new}`).join(', ')}</span></label>
        {/each}
        {#if view.lines?.length}
          <div class="lines">
            <p class="muted">These lines run next:</p>
            <pre class="mono">{view.lines.join('\n')}</pre>
          </div>
        {/if}
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
