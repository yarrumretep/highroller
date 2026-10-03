import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFlash, writeFlash, listFlash } from './flash.js'
import { FluidNC } from './fluidnc.js'
import { start } from '../../dev/fake-fluidnc.js'

const BASE = 'http://localhost:8090'

test('writes a flash file and reads it back byte for byte over HTTP; refuses while the machine moves', async () => {
  const server = start(8090)
  const fnc = new FluidNC({ host: 'localhost:8090' })
  try {
    // Blank lines and a line longer than $LocalFS/Show's 254 characters both survive
    const text = `board: x\n\naxes:\n  # ${'long comment '.repeat(30)}\n  x:\n\n    steps_per_mm: 50.000\n`
    await writeFlash('config.yaml', text, BASE)
    assert.equal(await readFlash('config.yaml', BASE), text)
    await writeFlash('empty.txt', '', BASE)
    assert.equal(await readFlash('empty.txt', BASE), '')
    await assert.rejects(readFlash('nope.json', BASE), e => /nope.json: no file/.test(e.message) && e.status === 404)
    assert.ok((await listFlash(BASE)).some(f => f.name === 'empty.txt'))

    const opened = new Promise(r => { fnc.onConnection = c => c === 'open' && r() })
    fnc.connect()
    await opened
    assert.equal((await fnc.send('$X')).ok, true)
    assert.equal((await fnc.send('G1 X100 F600')).ok, true)
    await assert.rejects(readFlash('config.yaml', BASE), /config.yaml: the board is busy/)
  } finally {
    fnc.close()
    server.close()
  }
})
