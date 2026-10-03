<script>
  import TopBar from './components/TopBar.svelte'
  import ConfirmDialog from './components/ConfirmDialog.svelte'
  import Dro from './components/Dro.svelte'
  import JogPad from './components/JogPad.svelte'
  import Preview from './components/Preview.svelte'
  import Job from './components/Job.svelte'
  import Overrides from './components/Overrides.svelte'
  import Console from './components/Console.svelte'
  import Tools from './components/Tools.svelte'
  import Calibrate from './components/Calibrate.svelte'
  import { machine, send } from './lib/machine.svelte.js'
  import { job } from './lib/job.svelte.js'

  const TABS = [['jog', 'Jog'], ['job', 'Job'], ['tools', 'Tools'], ['more', 'More']]
  let tab = $state('jog')
  // Mounted at the top level, not inside the Tools tab section: a layout change to the phone breakpoint
  // mid-run must not hide the dialog behind a `display: none` tab while the page stays inert.
  let calibrating = $state(false)

  // Tap-to-go is a machine-coordinate move: raise clear of the stock first, same rule as Dro's Go to XY0.
  async function goTo(x, y) {
    const wpos = machine.status.wpos
    if (!wpos) return { ok: false, error: 'Position not known yet.' }
    if (wpos[2] < 10) {
      const r = await send('G0 Z10') // clear the stock (work Z0 is its top) before crossing to the new XY
      if (!r.ok) return r
    }
    return send(`G53 G0 X${Math.round(x * 1000) / 1000} Y${Math.round(y * 1000) / 1000}`)
  }
</script>

<TopBar />
<ConfirmDialog />
{#if calibrating}<Calibrate onclose={() => (calibrating = false)} />{/if}

<main>
  <section class:off={tab !== 'jog'}>
    <Dro />
    <JogPad />
  </section>
  <section class:off={tab !== 'job'}>
    <Preview
      job={job.data}
      current={job.current}
      mpos={machine.status.mpos}
      wpos={machine.status.wpos}
      wco={machine.status.wco}
      range={machine.config?.range ?? null}
      goBlocked={machine.conn !== 'open' ? 'Not connected'
        : job.running ? 'A job is running'
        : machine.status.state !== 'Idle' ? `Wait for Idle (now ${machine.status.state})`
        : !(machine.homed.X && machine.homed.Y) ? 'Home X and Y first: a tap moves in machine coordinates'
        : ''}
      onGo={goTo}
    />
    <Job />
    <Overrides />
  </section>
  <section class:off={tab !== 'tools'}>
    <Tools onstart={() => (calibrating = true)} />
  </section>
  <section class:off={tab !== 'more'}>
    <Console />
  </section>
</main>

<nav class="tabs">
  {#each TABS as [id, label]}
    <button class:on={tab === id} onclick={() => (tab = id)}>{label}</button>
  {/each}
</nav>

<style>
  main { display: grid; gap: 12px; padding: 12px 12px 84px; }
  section { display: grid; gap: 12px; align-content: start; min-width: 0; }
  .tabs {
    position: fixed;
    inset: auto 0 0 0;
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
    padding: 8px 12px calc(8px + env(safe-area-inset-bottom));
    background: var(--panel);
    border-top: 1px solid var(--line);
  }
  .tabs .on { color: white; background: var(--accent); border-color: var(--accent); }
  @media (max-width: 999px) { .off { display: none; } }
  @media (min-width: 1000px) {
    /* Three columns that share the width: fixed side maxima left the middle 156 px at 1024 px, and its panels spilled over */
    main { grid-template-columns: minmax(340px, 1fr) minmax(280px, 1.3fr) minmax(320px, 1fr); padding-bottom: 12px; }
    main > section:nth-child(3), main > section:nth-child(4) { grid-column: 3; }
    main > section:nth-child(1), main > section:nth-child(2) { grid-row: span 2; }
    .tabs { display: none; }
  }
</style>
