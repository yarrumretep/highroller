<script>
  import { machine, stop, send } from '../lib/machine.svelte.js'
  import { ALARMS } from '../lib/status.js'

  const state = $derived(machine.status.state)
  const tone = $derived(
    state === 'Alarm' ? 'bad'
    : state === 'Hold' || state === 'Door' ? 'warn'
    : state === 'Run' || state === 'Jog' || state === 'Home' ? 'ok'
    : ''
  )
</script>

<header>
  <span class="conn" class:open={machine.conn === 'open'}>
    {machine.conn === 'open' ? 'Connected' : machine.everOpen ? 'Reconnecting…' : 'Connecting…'}
  </span>
  <span class="state {tone}">{machine.conn === 'open' ? state : '–'}</span>
  <button class="stop" onclick={stop}>STOP</button>
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
  .conn { display: flex; align-items: center; gap: 6px; font-size: 14px; color: var(--muted); }
  .conn::before { content: ''; width: 10px; height: 10px; border-radius: 50%; background: var(--warn); }
  .conn.open::before { background: var(--ok); }
  .state { font-weight: 700; padding: 4px 12px; border-radius: 999px; background: var(--btn); }
  .state.ok { background: var(--ok); color: white; }
  .state.warn { background: var(--warn); color: white; }
  .state.bad { background: var(--bad); color: white; }
  .stop {
    margin-left: auto;
    min-height: 52px;
    padding: 0 28px;
    font-size: 18px;
    font-weight: 800;
    letter-spacing: 0.06em;
    color: white;
    background: var(--bad);
    border-color: var(--bad);
  }
  .stop:active { background: #991b1b; }
  .banner { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 10px 12px; color: white; }
  .banner.warn { background: var(--warn); }
  .banner.bad { background: var(--bad); }
  .actions { display: flex; gap: 8px; margin-left: auto; }
  .actions button { color: white; background: rgb(255 255 255 / 0.2); border-color: rgb(255 255 255 / 0.5); }
</style>
