<script>
  import { onMount } from 'svelte'

  // A modal panel: a title, a close button, and whatever the caller renders inside. Escape, a tap on the
  // backdrop and the close button all call onclose; the caller unmounts the sheet.
  let { title, onclose, children } = $props()
  let dialog
  onMount(() => dialog.showModal())
</script>

<dialog bind:this={dialog} aria-label={title} oncancel={e => { e.preventDefault(); onclose() }} onclick={e => e.target === dialog && onclose()}>
  <div class="box">
    <header>
      <h2>{title}</h2>
      <button class="close" aria-label="Close" onclick={onclose}>✕</button>
    </header>
    <section>{@render children()}</section>
  </div>
</dialog>

<style>
  dialog { width: min(100vw, 520px); max-width: 100vw; max-height: 100dvh; margin: auto; padding: 0; border: 0; color: var(--text); background: var(--bg); overflow: auto; }
  dialog::backdrop { background: rgb(0 0 0 / 0.5); }
  header { position: sticky; top: 0; display: flex; align-items: center; gap: 10px; padding: 10px 12px; background: var(--panel); border-bottom: 1px solid var(--line); }
  h2 { margin: 0; font-size: 18px; }
  .close { margin-left: auto; min-width: 44px; padding: 0; font-size: 16px; color: var(--muted); background: none; border: none; }
  section { display: grid; gap: 12px; padding: 16px 12px; }
  @media (min-width: 1000px) { dialog { max-height: 90vh; border: 1px solid var(--line); border-radius: 14px; } }
</style>
