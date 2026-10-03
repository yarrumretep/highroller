import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseList, sdFiles } from './files.js'
import { start } from '../../dev/fake-fluidnc.js'

test('parseList reads FluidNC listings and marks folders', () => {
  const json = { files: [{ name: 'a.nc', size: '12' }, { name: 'jobs', size: '-1' }], status: 'Ok' }
  assert.deepEqual(parseList(json), [
    { name: 'a.nc', size: 12, dir: false },
    { name: 'jobs', size: -1, dir: true },
  ])
})

test('parseList turns FluidNC error statuses into errors', () => {
  assert.throws(() => parseList({ status: 'No SD card' }), /No SD card/)
  assert.throws(() => parseList({ files: [], status: 'Cannot delete a.nc' }), /Cannot delete/)
})

test('lists, downloads and deletes files on the fake controller', async () => {
  const server = start(8095)
  try {
    const form = new FormData() // the same request upload() sends from the browser
    form.append('/a.ncS', '5')
    form.append('myfile', new Blob(['G0 X1']), '/a.nc')
    await fetch('http://localhost:8095/upload', { method: 'POST', body: form })
    const sd = sdFiles('http://localhost:8095')
    assert.deepEqual(await sd.list(), [{ name: 'a.nc', size: 5, dir: false }])
    assert.equal(await sd.download('a.nc'), 'G0 X1')
    assert.deepEqual(await sd.remove('a.nc'), [])
  } finally {
    server.close()
  }
})
