<script>
  import { machine, send, fnc } from '../lib/machine.svelte.js'
  import { settings } from '../lib/settings.svelte.js'
  import { probeZ } from '../lib/probe.js'

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
    if (machine.conn !== 'open') { seenClosed = false; armed = false }
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
  // Homing is allowed in Alarm too: it is how the machine leaves the boot alarm.
  const canHome = $derived(machine.conn === 'open' && (machine.status.state === 'Idle' || machine.status.state === 'Alarm'))
  const home = axis => run(`Homing ${axis || 'all'}…`, () => cmd(axis ? `$H${axis}` : '$H'))
</script>

<div class="panel dro">
  {#each AXES as axis, i}
    <div class="row">
      <span class="axis">{axis}</span>
      <span class="work mono">{machine.status.wpos?.[i]?.toFixed(3) ?? '–.---'}</span>
      <span class="mach mono" title="Machine position">{machine.status.mpos?.[i]?.toFixed(3) ?? '–.---'}</span>
      <button disabled={!idle || !machine.status.wpos || !!busy} onclick={() => run('Zeroing…', () => cmd(`G10 L20 P0 ${axis}0`))}>Zero</button>
    </div>
  {/each}
  <div class="helpers">
    <!-- Enabled before the plate has touched: pressing it then shows the hint (a disabled button cannot be tapped for help) -->
    <button class:go={armed} disabled={!idle || !!busy} onclick={() => (armed ? probe() : (hint = true))} title={HINT}>Probe Z0</button>
    <button disabled={!idle || !!busy || top == null} onclick={goXY0}>Go to XY0</button>
    <button disabled={!idle || !!busy || top == null} onclick={raise}>Raise Z</button>
  </div>
  <div class="homes">
    <button disabled={!canHome || !!busy} onclick={() => home('')}>Home all</button>
    <button disabled={!canHome || !!busy} onclick={() => home('X')}>Home X</button>
    <button disabled={!canHome || !!busy} onclick={() => home('Y')}>Home Y</button>
    <button disabled={!canHome || !!busy} onclick={() => home('Z')}>Home Z</button>
  </div>
  <!-- One line that is always there, so a note coming or going never shifts the jog pad -->
  <p class="note" class:err={!busy && !!error}>{busy || error || (hint && !armed ? HINT : '')}</p>
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
</style>
