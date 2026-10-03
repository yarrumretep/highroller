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
