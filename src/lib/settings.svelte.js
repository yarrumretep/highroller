// ponytail: per-device localStorage until the board file API lands (build step 2);
// then these move to highroller.json on the board so phone and desktop share them.
const KEY = 'highroller.settings'
const DEFAULTS = { step: 10, feedXY: 3000, feedZ: 600 }

function load() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY)) }
  } catch {
    return { ...DEFAULTS }
  }
}

export const settings = $state(load())

$effect.root(() => {
  $effect(() => {
    const json = JSON.stringify(settings)
    try { localStorage.setItem(KEY, json) } catch {}
  })
})
