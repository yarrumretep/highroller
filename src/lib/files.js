// SD card files through FluidNC's /upload endpoint, which both 3.x and 4.x serve, and downloads from /sd/<name>.
// `base` is '' in the app: same origin on the board, and Vite proxies these paths in dev.
// ponytail: no move or rename yet (TODO).

// FluidNC puts the outcome in `status`: "Ok", "<name> deleted"/"created"/"renamed to …", or an error such as "Upload failed".
const succeeded = s => s === 'Ok' || / (deleted|created)$/.test(s) || / renamed to /.test(s)

export function parseList(json) {
  if (!Array.isArray(json.files) || !succeeded(json.status ?? 'Ok')) throw new Error(json.status || 'No file list')
  return json.files.map(f => ({ name: f.name, size: Number(f.size), dir: Number(f.size) < 0 }))
}

export function sdFiles(base = '') {
  async function get(url) {
    const r = await fetch(base + url)
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r
  }
  const q = encodeURIComponent
  const dirParam = dir => q('/' + (dir ? dir + '/' : '')) // FluidNC wants /jobs/ for a folder
  const dirPath = (dir, name) => '/' + (dir ? dir + '/' : '') + name
  return {
    list: async (dir = '') => parseList(await (await get(`/upload?path=${dirParam(dir)}`)).json()),
    mkdir: async (dir, name) => parseList(await (await get(`/upload?path=${dirParam(dir)}&action=createdir&filename=${q(name)}`)).json()),
    url: path => `${base}/sd/${path.split('/').map(q).join('/')}`, // for a download link; 3.x refuses it while moving
    remove: async (dir, name, isDir = false) =>
      parseList(await (await get(`/upload?path=${dirParam(dir)}&action=${isDir ? 'deletedir' : 'delete'}&filename=${q(name)}`)).json()),
    download: async path => (await get(`/sd/${path.split('/').map(q).join('/')}`)).text(),
    // XHR rather than fetch, because only XHR reports upload progress
    upload: (file, dir = '', onProgress = () => {}) =>
      new Promise((resolve, reject) => {
        const path = dirPath(dir, file.name)
        const form = new FormData()
        form.append(path + 'S', String(file.size)) // before the file: FluidNC reads it when the upload starts
        form.append('myfile', file, path)
        const xhr = new XMLHttpRequest()
        xhr.open('POST', base + '/upload')
        xhr.upload.onprogress = e => e.lengthComputable && onProgress(e.loaded / e.total)
        xhr.onload = () => {
          if (xhr.status !== 200) return reject(new Error(`Upload failed: HTTP ${xhr.status}`))
          try {
            resolve(parseList(JSON.parse(xhr.responseText)))
          } catch (e) {
            reject(e)
          }
        }
        xhr.onerror = () => reject(new Error('Upload failed: network error'))
        xhr.send(form)
      }),
  }
}
