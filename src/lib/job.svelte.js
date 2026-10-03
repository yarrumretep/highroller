import { untrack } from 'svelte'
import { machine, send, fnc } from './machine.svelte.js'
import { sdFiles } from './files.js'
import { parseGcode } from './gcode.js'
import { currentSegment, along } from './track.js'
import { cacheGet, cachePut } from './jobcache.js'
import { confirm as ask } from './confirm.svelte.js'

const sd = sdFiles()
const baseName = file => file.replace(/^\/sd\//i, '').replace(/^\//, '')

// The Job tab's state: SD files, the loaded G-code, and how far a running job has got.
export const job = $state({ files: [], error: '', busy: '', upload: null, name: '', data: null, current: -1, along: 0, startedAt: 0, failed: '', starting: false, running: false, pausedMs: 0 })

// The SD card is only changed while nothing runs: FluidNC accepts uploads mid-job, and one of the same name cuts the running file short.
const idleNoJob = () => machine.status.state === 'Idle' && !machine.status.sd && !job.running
const WAIT = 'Wait until the job has finished'

// $SD/Run takes ? ! ~ and bytes of 0x80 and above in a name as real-time commands, so such files cannot run.
export const badName = name => !/^[\x20-\x7e]+$/.test(name) || /[?!~]/.test(name)
const cannotRun = name => `Rename ${name}: FluidNC cannot run names with ? ! ~ or accents`

export async function refresh() {
  try {
    job.files = await sd.list()
    job.error = ''
  } catch (e) {
    job.error = `SD card: ${e.message}`
  }
}

export async function load(name, size, text) {
  // From the list (it passes the size) only while idle; the follower loads a running job's own file by name alone
  if (text == null && size != null && !idleNoJob()) {
    job.error = WAIT
    return
  }
  job.busy = `Loading ${name}…`
  try {
    if (text == null) {
      const cached = await cacheGet(name)
      text = cached && (size == null || cached.size === size) ? cached.text : await sd.download(name)
    }
    job.data = parseGcode(text, Number.isFinite(machine.maxRate.X) ? machine.maxRate : undefined) // stock rates until the machine's are read
    job.name = name
    job.current = -1
    job.failed = ''
    job.error = ''
    cachePut(name, text)
  } catch (e) {
    job.failed = name
    job.error = `Couldn't load ${name}: ${e.message}`
  }
  job.busy = ''
}

export async function upload(file) {
  if (!idleNoJob()) {
    job.error = WAIT
    return
  }
  if (badName(file.name)) {
    job.error = cannotRun(file.name)
    return
  }
  if (job.files.some(f => f.name === file.name)) {
    if (!(await ask({ title: `Replace ${file.name}?`, text: 'The copy on the SD card is overwritten.', ok: 'Replace', danger: true }))) return
    if (!idleNoJob()) { // a job may have started while the question was open
      job.error = WAIT
      return
    }
  }
  job.upload = 0
  try {
    job.files = await sd.upload(file, p => (job.upload = p))
    await load(file.name, file.size, await file.text())
  } catch (e) {
    job.error = e.message
  }
  job.upload = null
}

export async function remove(name) {
  if (!idleNoJob()) {
    job.error = WAIT
    return
  }
  try {
    job.files = await sd.remove(name)
  } catch (e) {
    job.error = e.message
  }
}

// One job at a time: FluidNC would queue a second $SD/Run and start it straight after the first.
export async function run() {
  if (job.starting || !idleNoJob()) return
  if (job.upload !== null) {
    job.error = 'Wait until the upload has finished'
    return
  }
  if (badName(job.name)) {
    job.error = cannotRun(job.name)
    return
  }
  job.starting = true
  job.current = -1
  job.along = 0
  const r = await send(`$SD/Run=/${job.name}`)
  if (!r.ok) job.error = `Run refused: ${r.error}`
  job.starting = false
}

export const pause = () => fnc.hold()
export const resume = () => fnc.resume()

// Follow a running SD job: load its file if it isn't the one shown (page reload, or started elsewhere),
// then track the segment being cut. Only machine.status is a dependency; the rest is read untracked.
let wasRunning = false
let heldSince = 0 // when the current hold began: time spent paused is left out of the job's elapsed time
$effect.root(() => {
  $effect(() => {
    const s = machine.status
    untrack(() => {
      if (s.state === 'Hold') {
        const now = Date.now()
        if (heldSince) job.pausedMs += now - heldSince
        heldSince = now
      } else {
        heldSince = 0
      }
      if (!s.sd) {
        // 3.9.9 drops SD: once the file is read, while the last moves are still cutting: keep following to the end.
        if (job.running && (s.state === 'Run' || s.state === 'Hold') && job.data) {
          if (!s.wpos) return // work position not known yet
          job.current = currentSegment(job.data, 100, s.wpos, job.current)
          job.along = along(job.data, job.current, s.wpos)
          return
        }
        job.running = false
        job.startedAt = 0
        job.failed = '' // a load that failed mid-job may work next time
        wasRunning = false
        return
      }
      job.running = true
      if (!wasRunning) {
        wasRunning = true
        job.current = -1 // a job just started, here or elsewhere: track it from its beginning
        job.along = 0
        job.pausedMs = 0
      }
      const name = baseName(s.sd.file)
      if (name !== job.name) {
        // ponytail: trusted by name while a job runs — FluidNC 3.x refuses downloads then; the next load from the list (with its size) refreshes the cache
        if (!job.busy && job.failed !== name) load(name)
        return
      }
      if (!job.data || !s.wpos) return // nothing to follow yet, or the work position is not known yet
      job.current = currentSegment(job.data, s.sd.percent, s.wpos, job.current)
      job.along = along(job.data, job.current, s.wpos)
      // First sight of this job: assume it has kept to the estimate so far
      if (!job.startedAt) job.startedAt = Date.now() - 1000 * (job.data.time[job.current] ?? 0)
    })
  })
})
