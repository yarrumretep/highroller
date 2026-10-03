<script>
  import { onMount } from 'svelte'
  import { machine } from '../lib/machine.svelte.js'
  import { job, run, pause, resume, noJob } from '../lib/job.svelte.js'
  import { progress } from '../lib/track.js'
  import { confirm as ask } from '../lib/confirm.svelte.js'
  import FileBrowser from './FileBrowser.svelte'

  let browsing = $state(false)
  let now = $state(Date.now())
  let est = $state(null) // the latest progress estimate, updated once a second while a job runs
  onMount(() => {
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
</script>

<div class="panel job">
  <div class="head">
    <div>
      <strong>{job.name || 'No file open'}</strong>
      {#if job.data}<span class="muted"> · about {clock(total)}</span>{/if}
    </div>
    <button disabled={machine.conn !== 'open' || !noJob()} onclick={() => (browsing = true)}>Open…</button>
  </div>
  {#if browsing}<FileBrowser onclose={() => (browsing = false)} />{/if}

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
</style>
