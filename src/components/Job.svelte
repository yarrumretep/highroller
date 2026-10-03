<script>
  import { onMount } from 'svelte'
  import { machine } from '../lib/machine.svelte.js'
  import { job, refresh, load, upload, run, pause, resume, remove, badName } from '../lib/job.svelte.js'
  import { progress } from '../lib/track.js'
  import { confirm as ask } from '../lib/confirm.svelte.js'

  let picker
  let now = $state(Date.now())
  let est = $state(null) // the latest progress estimate, updated once a second while a job runs
  onMount(() => {
    refresh()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  })
  function tick() {
    now = Date.now()
    if (!job.data || !job.running || !job.startedAt) { // job.running outlasts SD:, which goes before the last moves are cut
      est = null
      return
    }
    est = progress(job.data, job.current, job.along, (now - job.startedAt - job.pausedMs) / 1000, est?.ratio ?? null, est?.done ?? 0)
  }

  const s = $derived(machine.status)
  const running = $derived(job.running)
  const idle = $derived(machine.conn === 'open' && s.state === 'Idle')
  const elapsed = $derived(running && job.startedAt ? (now - job.startedAt - job.pausedMs) / 1000 : 0) // paused time left out
  const total = $derived(job.data?.time.at(-1) ?? 0)
  const fraction = $derived(est?.fraction ?? (s.sd ? s.sd.percent / 100 : job.running ? 1 : 0))
  const eta = sec => (sec > 120 ? Math.round(sec / 10) * 10 : Math.round(sec)) // steadier once it is minutes

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
    <progress max="1" value={fraction}></progress>
    <div class="times mono">
      <span>{Math.round(fraction * 100)}%</span>
      <span>{clock(elapsed)} gone</span>
      <span>{est ? `${est.learning ? '~' : ''}${clock(eta(est.left))} left` : '…'}</span>
    </div>
  {/if}

  <div class="controls">
    {#if s.state === 'Hold'}
      <button class="go" disabled={machine.stopping} onclick={resume}>Resume</button>
    {:else if s.state === 'Run'}
      <button disabled={machine.stopping} onclick={pause}>Pause</button>
    {:else}
      <button class="go" disabled={!idle || !job.data || running || job.starting || job.upload !== null} onclick={async () => (await ask({ title: `Run ${job.name}?`, text: 'Check the bit, the work zero, and that the area is clear.', ok: 'Run' })) && run()}>Run</button>
    {/if}
  </div>

  {#if job.busy}<p class="muted">{job.busy}</p>{/if}
  {#if job.error}<p class="err">{job.error}</p>{/if}

  <div class="files">
    <div class="filehead">
      <span>SD card</span>
      <button onclick={refresh}>Refresh</button>
      <button disabled={job.upload !== null || !idle || running} onclick={() => picker.click()}>Upload</button>
      <input type="file" accept=".nc,.gcode,.ngc,.tap,.cnc,.txt" hidden bind:this={picker} onchange={pick} />
    </div>
    {#if job.upload !== null}<progress max="1" value={job.upload}></progress>{/if}
    {#each job.files.filter(f => !f.dir) as f (f.name)}
      {@const bad = badName(f.name)}
      <div class="file" class:on={f.name === job.name}>
        <button class="name" disabled={!idle || running || bad} title={bad ? 'FluidNC cannot run this name: rename it' : undefined} onclick={() => load(f.name, f.size)}>{bad ? '⚠ ' : ''}{f.name}</button>
        <span class="muted mono">{size(f.size)}</span>
        <button disabled={!idle || running} aria-label="Delete {f.name}" onclick={async () => (await ask({ title: `Delete ${f.name}?`, text: 'It is removed from the SD card.', ok: 'Delete', danger: true })) && remove(f.name)}>✕</button>
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
