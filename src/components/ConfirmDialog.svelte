<script>
  import { pending, settle } from '../lib/confirm.svelte.js'

  let dialog
  $effect(() => {
    if (pending.req) {
      if (!dialog.open) dialog.showModal()
    } else if (dialog?.open) dialog.close()
  })
</script>

<dialog bind:this={dialog} oncancel={e => { e.preventDefault(); settle(false) }} onclick={e => e.target === dialog && settle(false)}>
  {#if pending.req}
    <div class="box">
      <h2>{pending.req.title}</h2>
      {#if pending.req.text}<p>{pending.req.text}</p>{/if}
      <div class="actions">
        <button onclick={() => settle(false)}>Cancel</button>
        <button class:danger={pending.req.danger} class:go={!pending.req.danger} onclick={() => settle(true)}>{pending.req.ok}</button>
      </div>
    </div>
  {/if}
</dialog>

<style>
  dialog { width: min(92vw, 420px); padding: 0; border: 1px solid var(--line); border-radius: 14px; color: var(--text); background: var(--panel); }
  dialog::backdrop { background: rgb(0 0 0 / 0.5); }
  .box { display: grid; gap: 12px; padding: 20px; }
  h2 { margin: 0; font-size: 18px; }
  p { margin: 0; font-size: 15px; line-height: 1.4; color: var(--muted); }
  .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .actions button { min-height: 48px; font-weight: 700; }
  .go { color: white; background: var(--ok); border-color: var(--ok); }
  .danger { color: white; background: var(--bad); border-color: var(--bad); }
</style>
