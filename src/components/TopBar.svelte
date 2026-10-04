<script>
  import { machine, stop, send } from '../lib/machine.svelte.js'
  import { settings } from '../lib/settings.svelte.js'
  import { ALARMS } from '../lib/status.js'
  import Sheet from './Sheet.svelte'

  const state = $derived(machine.status.state)
  const tone = $derived(
    state === 'Alarm' ? 'bad'
    : state === 'Hold' || state === 'Door' ? 'warn'
    : state === 'Run' || state === 'Jog' || state === 'Home' ? 'ok'
    : ''
  )
  let showSettings = $state(false)
  // A blank, invalid or negative plate thickness keeps the previous value rather than becoming 0 (or negative).
  function plate(e) {
    const v = e.currentTarget.value
    const n = Number(v)
    if (v === '' || !Number.isFinite(n) || n < 0) { e.currentTarget.value = settings.plateMm; return }
    settings.plateMm = n
  }
</script>

<header>
  <!-- A pair of sixes, the same as the tab icon -->
  <svg class="logo" viewBox="0 0 64 64" width="30" height="30" aria-label="HighRoller">
    <defs>
      <g id="six" fill="#fff">
        <circle cx="-7" cy="-7" r="2.6" /><circle cx="7" cy="-7" r="2.6" /><circle cx="-7" cy="0" r="2.6" />
        <circle cx="7" cy="0" r="2.6" /><circle cx="-7" cy="7" r="2.6" /><circle cx="7" cy="7" r="2.6" />
      </g>
    </defs>
    <g transform="translate(24 40) rotate(-14)"><rect x="-13" y="-13" width="26" height="26" rx="5" fill="#2563eb" stroke="#0f172a" stroke-width="2" /><use href="#six" /></g>
    <g transform="translate(42 24) rotate(16)"><rect x="-13" y="-13" width="26" height="26" rx="5" fill="#2563eb" stroke="#0f172a" stroke-width="2" /><use href="#six" /></g>
  </svg>
  <span class="conn" class:open={machine.conn === 'open'}>
    <span class="word">{machine.conn === 'open' ? 'Connected' : machine.everOpen ? 'Reconnecting…' : 'Connecting…'}</span>
  </span>
  {#if machine.conn === 'open' && machine.wifi !== null}
    <span class="wifi" class:weak={machine.wifi < 25} title="Wi-Fi signal at the controller">
      <svg viewBox="0 0 19 12" width="19" height="12" aria-hidden="true">
        {#each [1, 25, 50, 75] as level, i}
          <rect x={i * 5} y={9 - i * 3} width="4" height={3 + i * 3} rx="1" class:on={machine.wifi >= level} />
        {/each}
      </svg>
      <span class="mono pct">{machine.wifi}%</span>
    </span>
  {/if}
  <span class="state {tone}">{machine.conn === 'open' ? state : '–'}</span>
  <button class="gear" aria-label="Settings" title="Settings" onclick={() => (showSettings = true)}>
    <svg viewBox="-12 -12 24 24" width="24" height="24" aria-hidden="true">
      {#each Array(8) as _, i}<rect x="-2.2" y="-11.5" width="4.4" height="6" rx="1" transform="rotate({i * 45})" />{/each}
      <circle r="7.5" />
      <circle class="hole" r="3" />
    </svg>
  </button>
  <button class="stop" onpointerdown={e => { e.preventDefault(); stop() }} onclick={e => e.detail === 0 && stop()} oncontextmenu={e => e.preventDefault()}>STOP</button>
</header>

{#if machine.conn !== 'open' && machine.everOpen}
  <div class="banner warn">Lost connection, reconnecting. A running job carries on without the app.</div>
{/if}

{#if machine.conn === 'open' && state === 'Alarm'}
  <div class="banner bad">
    <span>{ALARMS[machine.alarm] ?? 'The machine is in alarm.'}</span>
    <span class="actions">
      <button onclick={() => send('$H')}>Home</button>
      <button onclick={() => send('$X')}>Unlock</button>
    </span>
  </div>
{/if}

{#if showSettings}
  <Sheet title="Settings" onclose={() => (showSettings = false)}>
    <label>Touch plate thickness <input type="number" min="0" step="0.01" value={settings.plateMm} onchange={plate} /> mm</label>
    <p class="muted">V1 Engineering's plate is 0.5 mm. Everything else is asked by the operation that needs it.</p>
  </Sheet>
{/if}

<style>
  header {
    position: sticky;
    top: 0;
    z-index: 10;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    padding-top: calc(10px + env(safe-area-inset-top));
    background: var(--panel);
    border-bottom: 1px solid var(--line);
  }
  .logo { flex: none; }
  .conn { display: flex; align-items: center; gap: 6px; font-size: 14px; color: var(--muted); }
  .conn::before { content: ''; width: 10px; height: 10px; border-radius: 50%; background: var(--warn); }
  .conn.open::before { background: var(--ok); }
  .wifi { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--muted); }
  .wifi rect { fill: var(--line); }
  .wifi rect.on { fill: var(--ok); }
  .wifi.weak rect.on { fill: var(--warn); }
  .state { font-weight: 700; padding: 4px 12px; border-radius: 999px; background: var(--btn); }
  .state.ok { background: var(--ok); color: white; }
  .state.warn { background: var(--warn); color: white; }
  .state.bad { background: var(--bad); color: white; }
  .gear { margin-left: auto; min-width: 48px; min-height: 48px; padding: 0; display: grid; place-items: center; color: var(--muted); }
  .gear rect, .gear circle { fill: currentColor; }
  .gear .hole { fill: var(--btn); }
  .stop {
    min-height: 52px;
    padding: 0 28px;
    font-size: 18px;
    font-weight: 800;
    letter-spacing: 0.06em;
    color: white;
    background: var(--bad);
    border-color: var(--bad);
    touch-action: none;
  }
  .stop:active { background: #991b1b; }
  /* A phone's width: the dot, the dice and the state say enough; the words and the percentage go */
  @media (max-width: 599px) {
    .word, .pct { display: none; }
    .stop { padding: 0 18px; }
  }
  .banner { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 10px 12px; color: white; }
  .banner.warn { background: var(--warn); }
  .banner.bad { background: var(--bad); }
  .actions { display: flex; gap: 8px; margin-left: auto; }
  .actions button { color: white; background: rgb(255 255 255 / 0.2); border-color: rgb(255 255 255 / 0.5); }
  label { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 15px; }
  input[type='number'] { width: 90px; min-height: 44px; padding: 0 8px; font-size: 16px; border: 1px solid var(--line); border-radius: 10px; background: var(--panel); }
  p { margin: 0; font-size: 14px; }
  .muted { color: var(--muted); }
</style>
