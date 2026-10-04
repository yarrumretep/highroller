<script>
  import { machine, send, fnc } from '../lib/machine.svelte.js'
  import { settings } from '../lib/settings.svelte.js'
  import { probeZ } from '../lib/probe.js'
  import { unhomedNote } from '../lib/homing.js'

  const AXES = ['X', 'Y', 'Z']
  const idle = $derived(machine.conn === 'open' && machine.status.state === 'Idle')
  const top = $derived(machine.config?.range?.Z.max)
  let busy = $state('')
  let error = $state('')
  // The Probe button arms only after the probe input has closed and opened again: proof the clip is on.
  let armed = $state(false)
  let seenClosed = false
  const HINT = 'To probe: plate under the bit, clip on, tap the plate to the bit, then press.'
  let hint = $state(false) // Probe was pressed before the plate had touched the bit
  $effect(() => {
    const p = machine.status.pins.includes('P')
    if (p) seenClosed = true
    else if (seenClosed) { armed = true; hint = false }
    // Arming must not survive a jog or a move: only a fresh closed→open cycle while Idle counts.
    if (machine.conn !== 'open' || machine.status.state !== 'Idle') { seenClosed = false; armed = false }
  })

  // send() never throws on a refusal; the helpers need to surface that as an error.
  const cmd = async line => { const r = await send(line); if (!r.ok) throw new Error(`${line}: error ${r.error}`) }

  async function run(label, fn) {
    busy = label
    error = ''
    try {
      await fn()
    } catch (e) {
      error = e.message
    }
    busy = ''
  }

  const probe = () => run('Probing…', async () => {
    armed = false
    seenClosed = false
    await probeZ(fnc)
    await cmd(`G10 L20 P0 Z${settings.plateMm}`) // the bit sits on the plate: the stock top is one plate below
    await cmd('G91')
    await cmd('G0 Z5')
    await cmd('G90')
  })
  const goXY0 = () => run('Moving…', async () => {
    const z = machine.status.wpos?.[2]
    if (z != null && z < 10) await cmd('G0 Z10') // clear the stock (work Z0 is its top) without climbing to the top of travel
    await cmd('G0 X0 Y0')
  })
  const raise = () => run('Raising…', () => cmd(`G53 G0 Z${top}`))

  // Double-click a number to type a destination for that axis: Enter or Go moves there, Escape cancels.
  let edit = $state(null) // { i, machineCoords, value }
  const focus = el => { el.focus(); el.select() }
  function startEdit(i, machineCoords) {
    if (!idle || busy) return
    const pos = machineCoords ? machine.status.mpos : machine.status.wpos
    if (!pos) return // not reported yet
    edit = { i, machineCoords, value: pos[i].toFixed(3) }
  }
  function go() {
    if (!edit) return
    const { i, machineCoords, value } = edit
    if (value == null || value === '') { error = 'Enter a destination.'; return } // emptied: Number(null) is 0, not "no destination"
    const v = Number(value)
    if (!Number.isFinite(v)) { error = 'Not a number.'; return }
    const wco = machine.status.wco
    if (!machineCoords && !wco) { error = 'Position not known yet.'; return }
    const m = machineCoords ? v : v + wco[i] // the machine editor's value is already a machine coordinate
    const range = machine.config?.range?.[AXES[i]]
    if (range && (m < range.min || m > range.max)) { error = `${AXES[i]} travel is ${range.min.toFixed(3)} to ${range.max.toFixed(3)}.`; return }
    edit = null
    run('Moving…', () => cmd(`G53 G0 ${AXES[i]}${Math.round(m * 1000) / 1000}`))
  }
  function editKey(e) {
    if (e.key === 'Enter') go()
    else if (e.key === 'Escape') edit = null
  }
  function editBlur() {
    // Deferred: clicking Go blurs the input first, and that click must still see `edit`.
    setTimeout(() => { edit = null })
  }
  // Homing is allowed in Alarm too: it is how the machine leaves the boot alarm.
  const canHome = $derived(machine.conn === 'open' && (machine.status.state === 'Idle' || machine.status.state === 'Alarm'))
  const home = axis => run(`Homing ${axis || 'all'}…`, async () => {
    if (axis === 'X' || axis === 'Y') await cmd('$HZ') // home Z alone first so a lowered bit isn't dragged across the work
    await cmd(axis ? `$H${axis}` : '$H')
  })
</script>

<div class="panel dro">
  {#each AXES as axis, i}
    <div class="row">
      <span class="axis">{axis}</span>
      {#if edit?.i === i}
        <span class="editor">
          <input class="mono" type="number" step="0.001" bind:value={edit.value} onkeydown={editKey} onblur={editBlur} use:focus />
          <button class="go" onclick={go}>Go</button>
        </span>
        <span class="mach">{edit.machineCoords ? 'machine' : 'work'}</span>
      {:else}
        <button class="plain work mono" ondblclick={() => startEdit(i, false)} title="Double-click to move here">{machine.status.wpos?.[i]?.toFixed(3) ?? '–.---'}</button>
        <button class="plain mach mono" ondblclick={() => startEdit(i, true)} title="Machine position. Double-click to move here">{machine.status.mpos?.[i]?.toFixed(3) ?? '–.---'}</button>
      {/if}
      <button disabled={!idle || !machine.status.wpos || !!busy} onclick={() => run('Zeroing…', () => cmd(`G10 L20 P0 ${axis}0`))}>Zero</button>
    </div>
  {/each}
  <div class="helpers">
    <!-- Enabled before the plate has touched: pressing it then shows the hint (a disabled button cannot be tapped for help) -->
    <button class:go={armed} disabled={!idle || !!busy} onclick={() => (armed ? probe() : (hint = true))} title={HINT}>Probe Z0</button>
    <button disabled={!idle || !!busy || top == null || !machine.status.wpos} onclick={goXY0}>Go to XY0</button>
    <button disabled={!idle || !!busy || top == null} onclick={raise}>Raise Z</button>
  </div>
  <div class="homes">
    <button disabled={!canHome || !!busy} onclick={() => home('')}>Home all</button>
    <button disabled={!canHome || !!busy} onclick={() => home('X')}>Home X</button>
    <button disabled={!canHome || !!busy} onclick={() => home('Y')}>Home Y</button>
    <button disabled={!canHome || !!busy} onclick={() => home('Z')}>Home Z</button>
  </div>
  <!-- One line that is always there, so a note coming or going never shifts the jog pad. Lowest priority:
       which axes' homing this page has not seen (it cannot ask the board), a caution for Raise Z and typed moves -->
  <p class="note" class:err={!busy && !!error}>{busy || error || (hint && !armed ? HINT : '') || unhomedNote(machine.homed, 'XYZ')}</p>
</div>

<style>
  .dro { display: grid; gap: 6px; }
  .row { display: grid; grid-template-columns: 28px 1fr auto auto; align-items: center; gap: 10px; }
  .axis { font-size: 22px; font-weight: 800; color: var(--accent); }
  .work { font-size: clamp(28px, 8vw, 40px); font-weight: 700; text-align: right; }
  .mach { min-width: 72px; font-size: 13px; color: var(--muted); text-align: right; }
  .helpers { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-top: 4px; }
  .homes { display: grid; grid-template-columns: 1.4fr repeat(3, 1fr); gap: 6px; }
  .homes button { min-height: 44px; padding: 0 6px; font-size: 13px; } /* smaller than the jog buttons, still a finger-sized target */
  .note { margin: 0; min-height: 1.3em; font-size: 13px; color: var(--muted); }
  .err { color: var(--bad); }
  .plain { padding: 0; border: 0; background: none; border-radius: 6px; }
  .plain:active { background: var(--btn-active); }
  .editor { display: flex; gap: 6px; align-items: center; }
  .editor input { flex: 1; min-width: 0; min-height: 44px; padding: 0 8px; font-size: 22px; border: 1px solid var(--accent); border-radius: 10px; background: var(--bg); }
  .go { color: white; background: var(--ok); border-color: var(--ok); }
</style>
