<script>
  import { onMount } from 'svelte'
  import { machine } from '../lib/machine.svelte.js'
  import { job, refresh, load, upload, run, pause, resume, remove } from '../lib/job.svelte.js'
  import { remaining } from '../lib/track.js'

  let picker
  let now = $state(Date.now())
  onMount(() => {
    refresh()
    const t = setInterval(() => (now = Date.now()), 1000)
    return () => clearInterval(t)
  })

  const s = $derived(machine.status)
  const running = $derived(!!s.sd)
  const idle = $derived(machine.conn === 'open' && s.state === 'Idle')
  const elapsed = $derived(running && job.startedAt ? (now - job.startedAt) / 1000 : 0)
  const total = $derived(job.data?.time.at(-1) ?? 0)
  const left = $derived(job.data ? remaining(job.data, job.current, elapsed) : 0)

  function clock(sec) {
    const t = Math.max(0, Math.round(sec))
    const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, ss = String(t % 60).padStart(2, '0')
    return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
  }
  const size = n => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`)

  function pick(e) {
    const file = e.currentTarget.files[0]
    e.currentTarget.value = ''
    if (file) upload(file)
  }
</script>

<div class="panel job">
  <div class="head">
    <strong>{job.name || 'No file loaded'}</strong>
    {#if job.data}<span class="muted">about {clock(total)}</span>{/if}
  </div>

  {#if running}
    <progress max="100" value={s.sd.percent}></progress>
    <div class="times mono">
      <span>{s.sd.percent.toFixed(1)}%</span>
      <span>{clock(elapsed)} gone</span>
      <span>{clock(left)} left</span>
    </div>
  {/if}

  <div class="controls">
    {#if s.state === 'Hold'}
      <button class="go" onclick={resume}>Resume</button>
    {:else if s.state === 'Run'}
      <button onclick={pause}>Pause</button>
    {:else}
      <button class="go" disabled={!idle || !job.data || running} onclick={() => confirm(`Run ${job.name}? Check the bit and work zero first.`) && run()}>Run</button>
    {/if}
  </div>

  {#if job.busy}<p class="muted">{job.busy}</p>{/if}
  {#if job.error}<p class="err">{job.error}</p>{/if}

  <div class="files">
    <div class="filehead">
      <span>SD card</span>
      <button onclick={refresh}>Refresh</button>
      <button disabled={job.upload !== null} onclick={() => picker.click()}>Upload</button>
      <input type="file" accept=".nc,.gcode,.ngc,.tap,.cnc,.txt" hidden bind:this={picker} onchange={pick} />
    </div>
    {#if job.upload !== null}<progress max="1" value={job.upload}></progress>{/if}
    {#each job.files.filter(f => !f.dir) as f (f.name)}
      <div class="file" class:on={f.name === job.name}>
        <button class="name" onclick={() => load(f.name, f.size)}>{f.name}</button>
        <span class="muted mono">{size(f.size)}</span>
        <button disabled={running} aria-label="Delete {f.name}" onclick={() => confirm(`Delete ${f.name} from the SD card?`) && remove(f.name)}>✕</button>
      </div>
    {:else}
      <p class="muted">No files on the SD card yet.</p>
    {/each}
  </div>
</div>

<style>
  .job { display: grid; gap: 10px; }
  .head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
  .muted { margin: 0; font-size: 14px; color: var(--muted); }
  .err { margin: 0; color: var(--bad); }
  progress { width: 100%; height: 14px; }
  .times { display: flex; justify-content: space-between; font-size: 14px; }
  .controls { display: grid; }
  .controls button { min-height: 56px; font-size: 18px; font-weight: 700; }
  .go { color: white; background: var(--ok); border-color: var(--ok); }
  .files { display: grid; gap: 6px; }
  .filehead { display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: 8px; font-weight: 700; }
  .file { display: grid; grid-template-columns: 1fr auto 44px; align-items: center; gap: 8px; }
  .file.on .name { border-color: var(--accent); }
  .name { overflow: hidden; text-align: left; text-overflow: ellipsis; white-space: nowrap; }
</style>
