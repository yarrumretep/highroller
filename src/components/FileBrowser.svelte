<script>
  import { onMount } from 'svelte'
  import { machine } from '../lib/machine.svelte.js'
  import { job, refresh, load, upload, uploadTree, remove, mkdir, badName, sdUrl, noJob } from '../lib/job.svelte.js'
  import { confirm as ask } from '../lib/confirm.svelte.js'

  let { onclose } = $props()
  let dialog
  let picker
  let folderPicker
  let selected = $state(null) // entry in the current folder
  let newFolder = $state(null) // the name being typed, or null when the box is hidden
  const busy = $derived(machine.conn !== 'open' || !noJob() || job.upload !== null)
  const entries = $derived([...job.files].sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name)))
  const pathOf = e => (job.dir ? `${job.dir}/${e.name}` : e.name)
  const size = n => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`)

  onMount(() => {
    dialog.showModal()
    refresh(job.dir)
  })
  async function go(dir) {
    selected = null
    await refresh(dir)
  }
  const up = () => go(job.dir.includes('/') ? job.dir.slice(0, job.dir.lastIndexOf('/')) : '')
  function tap(e) {
    selected = e // a single tap selects either kind; entering a folder or opening a file needs a double-tap or Open
  }
  async function open() {
    if (!selected) return
    if (selected.dir) {
      await go(pathOf(selected))
      return
    }
    await load(pathOf(selected), selected.size)
    onclose()
  }
  async function del() {
    const e = selected
    if (!e) return
    if (!(await ask({ title: `Delete ${e.name}?`, text: e.dir ? 'The folder and everything in it is removed from the SD card.' : 'It is removed from the SD card.', ok: 'Delete', danger: true }))) return
    selected = null
    await remove(job.dir, e.name, e.dir)
  }
  async function pick(ev) {
    const files = [...ev.currentTarget.files]
    ev.currentTarget.value = ''
    if (!files.length) return
    selected = null // the just-uploaded files aren't the stale selection from before
    for (const file of files) await upload(file, job.dir) // one at a time: the card takes one upload, and each may ask before replacing
  }
  // A whole folder (desktop browsers only: phones have no folder picker). Hidden files such as .DS_Store stay behind.
  async function pickFolder(ev) {
    const files = [...ev.currentTarget.files].filter(f => !/(^|\/)\./.test(f.webkitRelativePath))
    ev.currentTarget.value = ''
    if (!files.length) return
    selected = null
    await uploadTree(files, job.dir)
  }
  async function create() {
    const name = newFolder.trim()
    if (!name) return
    selected = null
    await mkdir(job.dir, name)
    if (!job.error) newFolder = null
  }
</script>

<dialog bind:this={dialog} oncancel={e => { e.preventDefault(); onclose() }}>
  <header>
    <button onclick={up} disabled={!job.dir}>↑ Up</button>
    <span class="path mono">/{job.dir}</span>
    <button onclick={onclose}>Close</button>
  </header>
  <section>
    {#each entries as e (e.name)}
      <button class="entry" class:on={selected === e} class:dir={e.dir} class:bad={!e.dir && badName(pathOf(e))} ondblclick={() => (e.dir ? go(pathOf(e)) : open())} onclick={() => tap(e)} title={!e.dir && badName(pathOf(e)) ? 'FluidNC cannot run this name: rename it' : ''}>
        <span class="name">{e.dir ? '📁 ' : ''}{e.name}</span>
        {#if !e.dir}<span class="muted mono">{size(e.size)}</span>{/if}
      </button>
    {:else}
      <p class="muted">Empty folder.</p>
    {/each}
    {#if job.upload !== null}<progress max="1" value={job.upload}></progress>{/if}
    {#if newFolder !== null}
      <div class="newfolder">
        <input type="text" placeholder="Folder name" bind:value={newFolder} onkeydown={e => { if (e.key === 'Enter') create(); else if (e.key === 'Escape') newFolder = null }} />
        <button class="go" onclick={create}>Create</button>
      </div>
    {/if}
    {#if job.error}<p class="err">{job.error}</p>{/if}
  </section>
  <footer>
    <button disabled={busy} onclick={() => picker.click()}>Upload here</button>
    <input type="file" multiple accept=".nc,.gcode,.ngc,.tap,.cnc,.txt" hidden bind:this={picker} onchange={pick} />
    <button class="desktop" disabled={busy} onclick={() => folderPicker.click()}>Upload folder</button>
    <input type="file" webkitdirectory multiple hidden bind:this={folderPicker} onchange={pickFolder} />
    <button disabled={busy} onclick={() => (newFolder = newFolder === null ? '' : null)}>New folder</button>
    {#if selected && !selected.dir}<a class="button" href={sdUrl(pathOf(selected))} download={selected.name}>Download</a>{/if}
    <button disabled={busy || !selected} onclick={del}>Delete</button>
    <button class="go" disabled={busy || !selected || (!selected.dir && badName(pathOf(selected)))} onclick={open}>Open</button>
  </footer>
</dialog>

<style>
  dialog { width: min(100vw, 560px); max-width: 100vw; height: 100dvh; max-height: 100dvh; margin: 0 auto; padding: 0; border: 0; display: grid; grid-template-rows: auto 1fr auto; color: var(--text); background: var(--bg); }
  dialog:not([open]) { display: none; }
  dialog::backdrop { background: rgb(0 0 0 / 0.5); }
  header, footer { display: flex; gap: 8px; align-items: center; padding: 10px 12px; background: var(--panel); border-bottom: 1px solid var(--line); }
  footer { border-bottom: 0; border-top: 1px solid var(--line); }
  .path { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; color: var(--muted); }
  section { overflow-y: auto; display: grid; align-content: start; gap: 4px; padding: 8px 12px; }
  .entry { display: grid; grid-template-columns: 1fr auto; gap: 8px; min-height: 48px; text-align: left; }
  .entry.on { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 15%, var(--btn)); }
  .entry.bad .name { color: var(--muted); text-decoration: line-through; }
  .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .muted { margin: 0; font-size: 13px; color: var(--muted); }
  .err { margin: 0; color: var(--bad); }
  .go { margin-left: auto; color: white; background: var(--ok); border-color: var(--ok); }
  .newfolder { display: grid; grid-template-columns: 1fr auto; gap: 8px; }
  .newfolder input { min-height: 44px; padding: 0 10px; font-size: 16px; border: 1px solid var(--accent); border-radius: 10px; background: var(--panel); }
  .newfolder .go { margin-left: 0; }
  a.button { display: inline-flex; align-items: center; min-height: 44px; padding: 0 14px; border: 1px solid var(--line); border-radius: 10px; background: var(--btn); color: inherit; text-decoration: none; }
  footer { flex-wrap: wrap; }
  .desktop { display: none; }
  @media (min-width: 1000px) {
    dialog { height: 80vh; max-height: 80vh; margin: 10vh auto; border-radius: 14px; }
    .desktop { display: inline-block; }
  }
</style>
