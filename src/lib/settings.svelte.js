import { machine, runWhenIdle, log } from './machine.svelte.js'
import { readFlash, writeFlash } from './flash.js'

// Settings live on the board (highroller.json on its flash) so phone and desktop share them.
// localStorage keeps a copy for the moments before the board has answered.
const FILE = 'highroller.json'
const KEY = 'highroller.settings'
const SAVE_DELAY_MS = 2000
const RETRY_MS = 10000 // a read the board refused (busy) is tried again after this, once idle
const DEFAULTS = {
  step: 10,
  feedXY: 3000,
  feedZ: 600,
  plateMm: 0.5, // touch plate thickness; V1 Engineering's plate is 0.5 mm
  dotMm: 0.4, // how far below the probed surface a calibration dot goes (through any tape): a V-bit's mark is only as wide as it is deep
  marginMm: 50, // how far inside the travel the calibration corners and the flatness grid sit
  yMotor0AtXmax: false, // which side each twin motor is on
  zMotor0AtXmax: false,
}
const DROPPED = ['tapeMm', 'spanMm'] // settings earlier builds saved; forgotten on read, so the file sheds them on its next write

function local() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) ?? {}
  } catch {
    return {}
  }
}

const shed = o => { for (const k of DROPPED) delete o[k]; return o }
export const settings = $state(shed({ ...DEFAULTS, ...local() }))
const initialJson = JSON.stringify(settings) // settings as the page started; a change from this before the board first answers wins over its copy
let synced = false // the board's copy has been read (or found missing) since the page loaded
let onBoard = false // the board's copy has been read on this connection; only then are changes written back
let boardJson = null // JSON last read from or written to the board; a change that still matches it needs no write back
let saveTimer
let loading = null

// Reads the board's copy, once per connection; resolves true once it has been read (or found missing).
// After a reconnect the board's copy wins outright, so another device's changes (or a calibration pass's) are kept.
// ponytail: a change made while disconnected, or before the board's copy has been read again (the config is
// read first, once no job runs), or still waiting to be written when the link dropped, is lost.
export function loadSettings() {
  if (onBoard) return Promise.resolve(true)
  return (loading ??= loadFromBoard().finally(() => { loading = null }))
}

async function loadFromBoard() {
  let board = null
  try {
    const text = await readFlash(FILE)
    try {
      board = JSON.parse(text)
    } catch (e) {
      // A cut-off write (the phone slept mid-upload, or the flash was full) leaves a file that holds nothing
      // worth keeping: this device's copy goes back in its place, as on a first run.
      log(`${FILE} on the board is unreadable (${e.message}); this device's settings are written back`)
    }
  } catch (e) {
    if (e.status !== 404) {
      // busy or unreachable: nothing is written over a copy that couldn't be read
      log(`Settings not read: ${e.message}`)
      if (e.status) setTimeout(() => runWhenIdle(retry), RETRY_MS) // the board answered but refused: it was busy
      return false
    }
    // no file yet (first run): ours are written below
  }
  if (machine.conn !== 'open') return false // the link dropped meanwhile; the next connection reads it again
  if (board && (synced || JSON.stringify(settings) === initialJson)) {
    Object.assign(settings, shed(board))
    boardJson = JSON.stringify(settings)
  } else {
    boardJson = null // no file yet, or a setting changed before the board first answered: ours are written back
  }
  synced = onBoard = true
  maybeSave(JSON.stringify(settings)) // a change during the read doesn't retrigger the effect on its own
  return true
}

const retry = () => { if (machine.config && !onBoard) loadSettings() }

const saveSettings = () => writeFlash(FILE, JSON.stringify(settings, null, 2) + '\n')

// Debounces a write-back once json has moved on from the board's last known copy.
function maybeSave(json) {
  clearTimeout(saveTimer) // a change reverted before the timer fires needs no write back either
  if (!onBoard || json === boardJson) return
  saveTimer = setTimeout(writeBack, SAVE_DELAY_MS)
}

// Writes only while nothing runs (FluidNC handles uploads on the task that feeds the planner); otherwise once idle.
function writeBack() {
  const json = JSON.stringify(settings)
  if (!onBoard || json === boardJson) return // the link dropped (the board's copy is read again), or nothing to write
  const s = machine.status
  if (!(s.state === 'Idle' || s.state === 'Alarm') || s.sd) return runWhenIdle(writeBack)
  // A failed write stops the writes until the next connection: each attempt into a full flash cuts the file off again.
  saveSettings()
    .then(() => { boardJson = json })
    .catch(e => { onBoard = false; log(`Settings not saved: ${e.message}. Is the flash full? $LocalFS/List shows it. Nothing more is written until the next connection.`) })
}

$effect.root(() => {
  // Off the board while the link is down: the next connection reads the board's copy before anything is written.
  $effect(() => { if (machine.conn !== 'open') onBoard = false })
  // Read the board's copy once the config has loaded (both need the machine idle); the config is read on every connection.
  $effect(() => { if (machine.config && !onBoard) loadSettings() })
  $effect(() => {
    const json = JSON.stringify(settings)
    try { localStorage.setItem(KEY, json) } catch {}
    maybeSave(json)
  })
})
