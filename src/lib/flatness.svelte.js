import { machine, send } from './machine.svelte.js'

// The last flatness map ({ kind, report, area, grid, zeroLine, configText, at }), kept for the Tools tab once its
// dialog has closed. ponytail: not persisted; a reload probes again.
export const flatness = $state({ last: null })

// Why a map's numbers no longer describe the table, or '': a config change since (a calibration's steps/mm or pull-offs).
export const stale = map => (machine.config?.text !== map.configText ? 'The config changed since the map: probe again' : '')

// The zero line is in machine coordinates, which the board keeps across the page's reconnects: refused only while
// the map no longer holds or the machine is not Idle. (An alarm that loses the position lands in Alarm.)
export const zeroBlocked = map =>
  stale(map)
  || (machine.conn !== 'open' ? 'Not connected'
  : machine.status.state !== 'Idle' ? `Wait for Idle (now ${machine.status.state})`
  : '')

export async function zeroAt(line) {
  const r = await send(line)
  return r.ok ? 'Work zero set' : `Not set: ${r.error}`
}
