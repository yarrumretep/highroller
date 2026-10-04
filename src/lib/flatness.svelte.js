import { machine, send } from './machine.svelte.js'

// The last flatness map ({ kind, report, area, grid, zeroLine, at }), kept for the Tools tab once its dialog has closed.
// ponytail: not persisted; a reload probes again.
export const flatness = $state({ last: null })

// The zero line is in machine coordinates, so only while they are known: homed since this connection, no alarm since.
export const zeroBlocked = () =>
  machine.conn !== 'open' ? 'Not connected'
  : machine.status.state !== 'Idle' ? `Wait for Idle (now ${machine.status.state})`
  : !(machine.homed.X && machine.homed.Y && machine.homed.Z) ? 'Home first: the zero is in machine coordinates'
  : ''

export async function zeroAt(line) {
  const r = await send(line)
  return r.ok ? 'Work zero set' : `Not set: ${r.error}`
}
