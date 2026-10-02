<script>
  import TopBar from './components/TopBar.svelte'
  import Dro from './components/Dro.svelte'
  import Console from './components/Console.svelte'

  let tab = $state('jog')
</script>

<TopBar />

<main>
  <section class:off={tab !== 'jog'}>
    <Dro />
  </section>
  <section class:off={tab !== 'more'}>
    <Console />
  </section>
</main>

<nav class="tabs">
  <button class:on={tab === 'jog'} onclick={() => (tab = 'jog')}>Jog</button>
  <button class:on={tab === 'more'} onclick={() => (tab = 'more')}>More</button>
</nav>

<style>
  main { display: grid; gap: 12px; padding: 12px 12px 84px; }
  section { display: grid; gap: 12px; align-content: start; min-width: 0; }
  .tabs {
    position: fixed;
    inset: auto 0 0 0;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    padding: 8px 12px calc(8px + env(safe-area-inset-bottom));
    background: var(--panel);
    border-top: 1px solid var(--line);
  }
  .tabs .on { color: white; background: var(--accent); border-color: var(--accent); }
  @media (max-width: 899px) { .off { display: none; } }
  @media (min-width: 900px) {
    main { grid-template-columns: minmax(360px, 440px) 1fr; padding-bottom: 12px; }
    .tabs { display: none; }
  }
</style>
