// Keeps the last job's G-code in the browser, so a page reload mid-cut needn't download it again
// (FluidNC 3.x refuses downloads while the machine moves). Any failure just means no cache.
const open = () =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open('highroller', 1)
    req.onupgradeneeded = () => req.result.createObjectStore('jobs')
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })

const done = req =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })

// Each operation closes its connection again; close() lets the transaction finish first.
export async function cacheGet(name) {
  try {
    const db = await open()
    const hit = await done(db.transaction('jobs').objectStore('jobs').get('last')).finally(() => db.close())
    return hit?.name === name ? hit : null
  } catch {
    return null
  }
}

export async function cachePut(name, text) {
  try {
    const db = await open()
    await done(db.transaction('jobs', 'readwrite').objectStore('jobs').put({ name, size: new Blob([text]).size, text }, 'last')).finally(() => db.close())
  } catch {}
}
