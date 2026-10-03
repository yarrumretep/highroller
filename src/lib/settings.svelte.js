import { machine, fnc } from './machine.svelte.js'
import { readFlash, writeFlash } from './flash.js'

// Settings live on the board (highroller.json on its flash) so phone and desktop share them.
// localStorage keeps a copy for the moments before the board has answered.
const FILE = 'highroller.json'
const KEY = 'highroller.settings'
const SAVE_DELAY_MS = 2000
const DEFAULTS = {
  step: 10,
  feedXY: 3000,
  feedZ: 600,
  plateMm: 0.5, // touch plate thickness; V1 Engineering's plate is 0.5 mm
  tapeMm: 0.1, // masking tape thickness, for the calibration dots
  spanMm: 0, // distance between the two Y (and Z) motors; 0 = not set yet
  marginMm: 50, // how far inside the travel the calibration corners sit
  yMotor0AtXmax: false, // which side each twin motor is on
  zMotor0AtXmax: false,
}

function local() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) ?? {}
  } catch {
    return {}
  }
}

export const settings = $state({ ...DEFAULTS, ...local() })
const initialJson = JSON.stringify(settings) // settings as the page started; a change from this before the board answers wins over its copy
let onBoard = false // true once the board's copy has been read or deferred to; only then are changes written back
let boardJson = null // JSON last read from or written to the board; a change that still matches it needs no write back
let saveTimer

async function loadFromBoard() {
  try {
    const text = await readFlash(fnc, FILE)
    const json = JSON.stringify(settings) // settings right now, before deciding what to do with the board's copy
    if (json === initialJson) {
      Object.assign(settings, JSON.parse(text))
      boardJson = JSON.stringify(settings)
    } else {
      // a setting changed while this was loading: that change wins over the board's copy, so push ours instead of overwriting it
      await saveSettings()
      boardJson = json
    }
  } catch {
    // ponytail: no file yet (first run), unreadable, or the push failed; keep what we have and write it on the next change
  }
  onBoard = true
}

export const saveSettings = () => writeFlash(FILE, JSON.stringify(settings, null, 2) + '\n')

$effect.root(() => {
  // Read the board's copy once the config has loaded (both need the machine idle).
  $effect(() => {
    if (machine.config && !onBoard) loadFromBoard()
  })
  $effect(() => {
    const json = JSON.stringify(settings)
    try { localStorage.setItem(KEY, json) } catch {}
    clearTimeout(saveTimer) // a change reverted before the timer fires needs no write back either
    if (!onBoard || json === boardJson) return
    saveTimer = setTimeout(() => {
      // ponytail: a failed write is not retried on its own; it goes out again only if another setting changes afterward.
      saveSettings()
        .then(() => { boardJson = json })
        .catch(e => console.warn('Settings not saved:', e.message))
    }, SAVE_DELAY_MS)
  })
})
