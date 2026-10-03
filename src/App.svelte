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
  import { machine } from './lib/machine.svelte.js'
  import { job } from './lib/job.svelte.js'

  const TABS = [['jog', 'Jog'], ['job', 'Job'], ['tools', 'Tools'], ['more', 'More']]
  let tab = $state('jog')
  // Mounted at the top level, not inside the Tools tab section: a layout change to the phone breakpoint
  // mid-run must not hide the dialog behind a `display: none` tab while the page stays inert.
  let calibrating = $state(false)
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
    <Preview job={job.data} current={job.current} pos={machine.status.wpos} />
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
  @media (max-width: 899px) { .off { display: none; } }
  @media (min-width: 900px) {
    main { grid-template-columns: minmax(340px, 420px) minmax(0, 1fr) minmax(300px, 400px); padding-bottom: 12px; }
    main > section:nth-child(3), main > section:nth-child(4) { grid-column: 3; }
    main > section:nth-child(1), main > section:nth-child(2) { grid-row: span 2; }
    .tabs { display: none; }
  }
</style>
