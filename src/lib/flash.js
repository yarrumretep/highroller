import { parseList } from './files.js'

// Files on the board's flash, over HTTP. FluidNC serves a flash file at /<name> while the machine is idle or
// in alarm (it refuses during motion), byte for byte; writing uses the /files upload that its own WebUI uses.
// $LocalFS/Show is not used: other clients' [MSG:]/[PRB:]/ALARM: broadcasts land among its lines, and it
// truncates long lines and drops blank ones.

// The exact text of the file. A failure carries the HTTP status (404: no such file).
export async function readFlash(name, base = '') {
  const r = await fetch(`${base}/${encodeURIComponent(name)}`, { cache: 'no-store' }).catch(() => { throw new Error(`Can't read ${name}: network error`) })
  if (!r.ok) throw Object.assign(new Error(`Can't read ${name}: ${r.status === 404 ? 'no file' : `the board is busy (HTTP ${r.status})`}`), { status: r.status })
  // fatal: a file that isn't UTF-8 would not survive being written back; ignoreBOM: keep a BOM if there is one
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await r.arrayBuffer())
}

export async function listFlash(base = '') {
  const r = await fetch(base + '/files?path=/', { cache: 'no-store' }).catch(() => { throw new Error("Can't list the flash: network error") })
  if (!r.ok) throw new Error(`Can't list the flash: HTTP ${r.status}`)
  return parseList(await r.json())
}

// "180.00 KB", "1.00 GB", "512 B" → bytes, as FluidNC formats sizes in its /files listing
export function parseBytes(s) {
  const m = /^\s*([\d.]+)\s*([KMG]?)B?\s*$/i.exec(String(s))
  if (!m) return NaN
  return Number(m[1]) * { '': 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3 }[m[2].toUpperCase()]
}

// The flash filesystem's size: { total, used, free } in bytes. The Jackpot's is only 192 KB, and a write
// into a full one leaves a cut-off file (an empty config.yaml puts the board in ConfigAlarm).
export async function flashSpace(base = '') {
  const r = await fetch(base + '/files?path=/', { cache: 'no-store' }).catch(() => { throw new Error("Can't list the flash: network error") })
  if (!r.ok) throw new Error(`Can't list the flash: HTTP ${r.status}`)
  const json = await r.json()
  const total = parseBytes(json.total), used = parseBytes(json.used)
  return { total, used, free: total - used }
}

export async function writeFlash(name, text, base = '') {
  const path = '/' + name
  const blob = new Blob([text])
  const form = new FormData()
  form.append(path + 'S', String(blob.size)) // before the file part: FluidNC reads it when the upload starts
  form.append('myfile', blob, path)
  const r = await fetch(base + '/files', { method: 'POST', body: form }).catch(() => { throw new Error(`Upload of ${name} failed: network error`) })
  if (!r.ok) throw new Error(`Upload of ${name} failed: HTTP ${r.status}`)
  parseList(await r.json()) // throws on "Upload failed"
}
