import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFlash, writeFlash } from './flash.js'
import { FluidNC } from './fluidnc.js'
import { start } from '../../dev/fake-fluidnc.js'

test('writes a flash file over HTTP and reads it back over the websocket', async () => {
  const server = start(8090)
  const fnc = new FluidNC({ host: 'localhost:8090' })
  try {
    const opened = new Promise(r => { fnc.onConnection = c => c === 'open' && r() })
    fnc.connect()
    await opened
    await writeFlash('highroller.json', '{"plateMm":10}\n', 'http://localhost:8090')
    assert.equal(await readFlash(fnc, 'highroller.json'), '{"plateMm":10}\n')
    await assert.rejects(readFlash(fnc, 'nope.txt'), /nope.txt/)
  } finally {
    fnc.close()
    server.close()
  }
})
