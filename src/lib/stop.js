// STOP: hold first so the machine decelerates and keeps its position, then reset.
// A feed hold alone would leave the spindle running, so STOP always ends with a reset (it also aborts a job).
const moving = s => s.state === 'Run' || s.state === 'Jog' || (s.state === 'Hold' && s.sub !== 0)
const sleep = ms => new Promise(r => setTimeout(r, ms))

export async function stopMachine(fnc, jogger) {
  jogger.stop()
  fnc.hold()
  await sleep(150) // let a fresh report arrive: motion may have started since the last one
  const t0 = Date.now()
  while (moving(fnc.status) && Date.now() - t0 < 2000) await sleep(50) // a full-speed rapid takes ~0.75 s to stop
  fnc.reset()
}
