import { untrack } from 'svelte'
import { machine, send, fnc } from './machine.svelte.js'
import { sdFiles } from './files.js'
import { parseGcode } from './gcode.js'
import { currentSegment, along } from './track.js'
import { cacheGet, cachePut } from './jobcache.js'
import { confirm as ask } from './confirm.svelte.js'
import { ALARMS } from './status.js'

const sd = sdFiles()
const baseName = file => file.replace(/^\/sd\//i, '').replace(/^\//, '')

// The Job tab's state: SD files, the loaded G-code, and how far a running job has got.
// finished: { name, ms } once a job has run to its own end (not a stop, not an alarm); the UI shows it and clears it.
// check: the open file's run through FluidNC's check mode: { running, percent, result: null | { ok, text } }.
const NO_CHECK = () => ({ running: false, percent: 0, result: null })
export const job = $state({ dir: '', files: [], error: '', busy: '', upload: null, name: '', data: null, lines: 0, current: -1, along: 0, startedAt: 0, failed: '', starting: false, running: false, pausedMs: 0, finished: null, check: NO_CHECK() })

// The SD card is only changed while nothing runs: FluidNC accepts uploads mid-job, and one of the same name cuts the running file short.
const idleNoJob = () => machine.status.state === 'Idle' && !machine.status.sd && !job.running
// A fresh boot leaves the machine in Alarm, and the file browser must still work then: only a running job blocks it.
export const noJob = () => !job.running && !machine.status.sd && !['Run', 'Hold'].includes(machine.status.state)
const WAIT = 'Wait until the job has finished'

// $SD/Run takes ? ! ~ and bytes of 0x80 and above in a name as real-time commands, so such files cannot run.
export const badName = name => !/^[\x20-\x7e]+$/.test(name) || /[?!~]/.test(name)
const cannotRun = name => `Rename ${name}: FluidNC cannot run names with ? ! ~ or accents`

export async function refresh(dir = job.dir) {
  try {
    job.files = await sd.list(dir)
    job.dir = dir
    job.error = ''
  } catch (e) {
    job.error = `SD card: ${e.message}`
  }
}

export async function load(path, size, text) {
  // From the list (it passes the size) only while no job is running; the follower loads a running job's own file by path alone
  if (text == null && size != null && !noJob()) {
    job.error = WAIT
    return
  }
  job.busy = `Loading ${path}…`
  try {
    if (text == null) {
      const cached = await cacheGet(path)
      text = cached && (size == null || cached.size === size) ? cached.text : await sd.download(path)
    }
    job.data = parseGcode(text, Number.isFinite(machine.maxRate.X) ? machine.maxRate : undefined) // stock rates until the machine's are read
    job.name = path
    job.lines = text.split('\n').filter(l => l.trim()).length
    job.check = NO_CHECK() // another file (or the same one again): not checked yet
    job.current = -1
    job.failed = ''
    job.error = ''
    cachePut(path, text)
  } catch (e) {
    job.failed = path
    job.error = `Couldn't load ${path}: ${e.message}`
  }
  job.busy = ''
}

export async function upload(file, dir = job.dir) {
  if (!noJob()) {
    job.error = WAIT
    return
  }
  if (badName(file.name)) {
    job.error = cannotRun(file.name)
    return
  }
  if (job.files.some(f => f.name === file.name)) {
    if (!(await ask({ title: `Replace ${file.name}?`, text: 'The copy on the SD card is overwritten.', ok: 'Replace', danger: true }))) return
    if (!noJob()) { // a job may have started while the question was open
      job.error = WAIT
      return
    }
  }
  job.upload = 0
  try {
    await sd.upload(file, dir, p => (job.upload = p))
    job.files = await sd.list(dir) // the upload's own reply lists the root on 3.9.9 (no path argument), not this folder
    await load(dir ? `${dir}/${file.name}` : file.name, file.size, await file.text())
  } catch (e) {
    job.error = e.message
  }
  job.upload = null
}

export async function remove(dir, name, isDir = false) {
  if (!noJob()) {
    job.error = WAIT
    return
  }
  try {
    job.files = await sd.remove(dir, name, isDir)
  } catch (e) {
    job.error = e.message
  }
}

export async function mkdir(dir, name) {
  if (!noJob()) {
    job.error = WAIT
    return
  }
  if (badName(name) || name.includes('/')) {
    job.error = 'Folder names cannot contain ? ! ~ or accents, or /'
    return
  }
  try {
    job.files = await sd.mkdir(dir, name)
    job.error = ''
  } catch (e) {
    job.error = e.message
  }
}

// A folder from a desktop picker (files carry webkitRelativePath): its tree is recreated under `dir`, folders
// first, then every file goes up in turn. Files already on the card are replaced only after one question.
export async function uploadTree(files, dir = job.dir) {
  if (!noJob()) {
    job.error = WAIT
    return
  }
  const bad = files.find(f => f.webkitRelativePath.split('/').some(badName))
  if (bad) {
    job.error = cannotRun(bad.webkitRelativePath)
    return
  }
  const at = p => (dir ? `${dir}/${p}` : p)
  const folderOf = f => f.webkitRelativePath.split('/').slice(0, -1).join('/')
  const folders = [...new Set(files.map(folderOf))].sort((a, b) => a.split('/').length - b.split('/').length)
  job.busy = 'Creating folders…'
  job.upload = 0
  try {
    const existing = new Set()
    for (const d of folders) {
      const parent = d.includes('/') ? d.slice(0, d.lastIndexOf('/')) : ''
      try {
        await sd.mkdir(at(parent), d.split('/').pop())
      } catch {} // there already: fine, as long as the listing below works
      for (const f of await sd.list(at(d))) if (!f.dir) existing.add(`${d}/${f.name}`)
    }
    const clashes = files.filter(f => existing.has(f.webkitRelativePath))
    if (clashes.length) {
      job.busy = ''
      const names = clashes.slice(0, 3).map(f => f.webkitRelativePath).join(', ') + (clashes.length > 3 ? ', …' : '')
      if (!(await ask({ title: `Replace ${clashes.length} of ${files.length} files?`, text: `${names} are on the SD card already.`, ok: 'Replace', danger: true }))) return
    }
    let n = 0
    for (const f of files) {
      if (!noJob()) throw new Error(WAIT)
      job.busy = `Uploading ${++n} of ${files.length}: ${f.webkitRelativePath}`
      job.upload = 0
      await sd.upload(f, at(folderOf(f)), p => (job.upload = p))
    }
    job.error = ''
  } catch (e) {
    job.error = e.message
  } finally {
    job.upload = null
    job.busy = ''
  }
  await refresh(dir)
}

// The open file through FluidNC's check mode: every line parsed and checked against the soft limits with the
// current work zero, nothing moved, the file read as fast as the card gives it. The first bad line ends the
// run and is reported with its number; a move past the travel comes back as a soft limit.
export async function checkFile() {
  if (job.check.running || !job.data || !idleNoJob() || job.upload !== null) return
  if (badName(job.name)) {
    job.error = cannotRun(job.name)
    return
  }
  job.check = { running: true, percent: 0, result: null }
  job.error = ''
  const logAt = machine.log.length
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const until = async (cond, ms) => {
    const t0 = Date.now()
    while (!cond()) {
      if (Date.now() - t0 > ms) return false
      await sleep(100)
    }
    return true
  }
  try {
    let r = await send('$C')
    if (!r.ok) throw new Error(`$C refused: ${r.error}`)
    if (!(await until(() => machine.status.state === 'Check', 3000))) throw new Error('The controller did not enter check mode')
    r = await send(`$SD/Run=/${job.name}`)
    if (!r.ok) throw new Error(`Run refused: ${r.error}`)
    // The run is over when SD: goes, or when the controller says so first: Program End (M2/M30), the first bad
    // line, or an alarm. Not SD: alone: in check mode it can outlast the file.
    const ended = () => machine.log.slice(logAt).some(l => /^\[MSG:INFO: Program End\]|^\[MSG:ERR: .* at line \d+\]|^ALARM:/.test(l))
    await until(() => machine.status.sd || machine.status.state !== 'Check' || ended(), 3000) // the run shows up as SD: (or is over already)
    if (!(await until(() => !machine.status.sd || machine.status.state !== 'Check' || ended(), 20 * 60000))) throw new Error('The check did not finish in 20 minutes')
    await sleep(500) // the last lines' messages
    const seen = machine.log.slice(logAt)
    const bad = seen.map(l => /^\[MSG:ERR: (\d+) \((.+?)\) in .* at line (\d+)\]$/.exec(l)).find(Boolean)
    const soft = seen.map(l => /^\[MSG:INFO: (Soft limit exceeded on [XYZ] axis: .*)\]$/.exec(l)).find(Boolean)
    const alarm = seen.map(l => /^ALARM:(\d+)/.exec(l)).find(Boolean)
    job.check.result = bad ? { ok: false, text: `Line ${bad[3]}: error ${bad[1]}, ${bad[2].toLowerCase()}` }
      : soft ? { ok: false, text: `${soft[1]} (with the current work zero)` }
      : alarm ? { ok: false, text: ALARMS[alarm[1]] ?? `ALARM:${alarm[1]}` }
      : { ok: true, text: `OK: ${job.lines} lines, nothing past the travel` }
  } catch (e) {
    job.check.result = { ok: false, text: e.message }
  } finally {
    // Out of check mode. $C while in it is a reset, and FluidNC 3.9.9 answers it with "Disabled" and nothing else,
    // no ok and no banner: waiting would hold the command queue for good. So nothing is waited for; the state
    // leaving Check says it worked, and a machine still in Check after that is reset by hand. A soft limit leaves
    // Alarm instead, which $X clears.
    if (machine.status.state === 'Check') {
      await send('$C', { noReply: true })
      if (!(await until(() => machine.status.state !== 'Check', 2500))) {
        fnc.reset()
        await until(() => machine.status.state !== 'Check', 2500)
      }
    }
    if (machine.status.state === 'Alarm') await send('$X')
    await until(() => machine.status.state === 'Idle', 3000)
    job.check.running = false
  }
}

export const sdUrl = path => sd.url(path)

// Close the open file: the panel goes back to "No file open". Not while its job runs (the follower needs the data).
export function unload() {
  if (job.running || job.check.running) return
  job.name = ''
  job.data = null
  job.lines = 0
  job.check = NO_CHECK()
  job.current = -1
  job.along = 0
  job.error = ''
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
let stopsAtStart = 0 // machine.stops when the job began: a STOP since means it did not finish on its own
let heldSince = 0 // when the current hold began: time spent paused is left out of the job's elapsed time
$effect.root(() => {
  $effect(() => {
    const s = machine.status
    untrack(() => {
      if (s.state === 'Check') { // a check-mode run is not a job: only its progress is of interest
        if (s.sd) job.check.percent = s.sd.percent
        return
      }
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
        // Ran to its own end: the state is Idle, not Alarm, and nobody pressed STOP (a stop while held ends in Idle too)
        if (job.running && s.state === 'Idle' && machine.stops === stopsAtStart) job.finished = { name: job.name, ms: job.startedAt ? Date.now() - job.startedAt - job.pausedMs : 0 }
        job.running = false
        job.startedAt = 0
        job.failed = '' // a load that failed mid-job may work next time
        wasRunning = false
        return
      }
      job.running = true
      if (!wasRunning) {
        wasRunning = true
        stopsAtStart = machine.stops
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
