import { untrack } from 'svelte'
import { machine, send, fnc } from './machine.svelte.js'
import { sdFiles } from './files.js'
import { parseGcode } from './gcode.js'
import { currentSegment } from './track.js'
import { cacheGet, cachePut } from './jobcache.js'

const sd = sdFiles()
const baseName = file => file.replace(/^\/sd\//i, '').replace(/^\//, '')

// The Job tab's state: SD files, the loaded G-code, and how far a running job has got.
export const job = $state({ files: [], error: '', busy: '', upload: null, name: '', data: null, current: -1, startedAt: 0, failed: '' })

export async function refresh() {
  try {
    job.files = await sd.list()
    job.error = ''
  } catch (e) {
    job.error = `SD card: ${e.message}`
  }
}

export async function load(name, size, text) {
  job.busy = `Loading ${name}…`
  try {
    if (text == null) {
      const cached = await cacheGet(name)
      text = cached && (size == null || cached.size === size) ? cached.text : await sd.download(name)
    }
    job.data = parseGcode(text, machine.maxRate)
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
  try {
    job.files = await sd.remove(name)
  } catch (e) {
    job.error = e.message
  }
}

export async function run() {
  job.current = -1
  await send(`$SD/Run=/${job.name}`)
}

export const pause = () => fnc.hold()
export const resume = () => fnc.resume()

// Follow a running SD job: load its file if it isn't the one shown (page reload, or started elsewhere),
// then track the segment being cut. Only machine.status is a dependency; the rest is read untracked.
let wasRunning = false
$effect.root(() => {
  $effect(() => {
    const s = machine.status
    untrack(() => {
      if (!s.sd) {
        job.startedAt = 0
        job.failed = '' // a load that failed mid-job may work next time
        wasRunning = false
        return
      }
      if (!wasRunning) {
        wasRunning = true
        job.current = -1 // a job just started, here or elsewhere: track it from its beginning
      }
      const name = baseName(s.sd.file)
      if (name !== job.name) {
        // ponytail: trusted by name while a job runs — FluidNC 3.x refuses downloads then; the next load from the list (with its size) refreshes the cache
        if (!job.busy && job.failed !== name) load(name)
        return
      }
      if (!job.data) return
      job.current = currentSegment(job.data, s.sd.percent, s.wpos, job.current)
      // First sight of this job: assume it has kept to the estimate so far
      if (!job.startedAt) job.startedAt = Date.now() - 1000 * (job.data.time[job.current] ?? 0)
    })
  })
})
