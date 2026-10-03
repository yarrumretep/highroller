import { parseList } from './files.js'

// Files on the board's flash. Reading goes through the websocket ($LocalFS/Show prints the file, on 3.x and
// 4.x alike, while the machine is idle or in alarm); writing uses the /files upload that FluidNC's own WebUI uses.

// ponytail: a file line that is exactly "ok" or starts with "error:" would end the reply early; the YAML/JSON configs read here never contain one.
export async function readFlash(fnc, name) {
  const r = await fnc.send(`$LocalFS/Show=/${name}`, { quiet: true })
  if (!r.ok) throw new Error(`Can't read ${name} (${r.error === 'disconnected' ? 'not connected' : `error ${r.error}`})`)
  return r.lines.length ? r.lines.join('\n') + '\n' : ''
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
