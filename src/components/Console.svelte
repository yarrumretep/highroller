<script>
  import { machine, send } from '../lib/machine.svelte.js'

  let line = $state('')
  let box

  $effect(() => {
    machine.log.length // scroll down whenever lines arrive
    box.scrollTop = box.scrollHeight
  })

  function submit(e) {
    e.preventDefault()
    const cmd = line.trim()
    if (!cmd) return
    send(cmd)
    line = ''
  }
</script>

<div class="panel console">
  <div class="log mono" bind:this={box}>
    {#each machine.log as l}
      <div class:sent={l.startsWith('> ')} class:err={/^(error|ALARM)/.test(l)}>{l}</div>
    {/each}
  </div>
  <form onsubmit={submit}>
    <input class="mono" bind:value={line} placeholder="G-code or $ command" autocapitalize="off" autocomplete="off" spellcheck="false" />
    <button disabled={machine.conn !== 'open'}>Send</button>
  </form>
</div>

<style>
  .console { display: grid; grid-template-rows: 1fr auto; gap: 8px; height: 60vh; }
  .log { overflow-y: auto; font-size: 13px; line-height: 1.45; white-space: pre-wrap; word-break: break-all; }
  .sent { color: var(--accent); }
  .err { color: var(--bad); }
  form { display: grid; grid-template-columns: 1fr auto; gap: 8px; }
  input { min-height: 44px; padding: 0 10px; font-size: 16px; border: 1px solid var(--line); border-radius: 10px; background: var(--bg); }
  @media (min-width: 1000px) { .console { flex: 1; height: auto; min-height: 200px; } } /* fills the rest of its column */
</style>
