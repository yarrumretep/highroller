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

test('parseList trusts FluidNC success statuses even when the file name looks like an error', () => {
  assert.deepEqual(parseList({ files: [], status: 'failed_job.nc deleted' }), [])
  assert.throws(() => parseList({ files: [], status: 'Cannot delete failed_job.nc Invalid argument' }), /Cannot delete/)
})

test('folders: list, upload into, download from and delete in a folder on the fake controller', async () => {
  const server = start(8095)
  try {
    const sd = sdFiles('http://localhost:8095')
    assert.deepEqual(await sd.mkdir('', 'jobs'), [{ name: 'jobs', size: -1, dir: true }])
    assert.equal(sd.url('jobs/a.nc'), 'http://localhost:8095/sd/jobs/a.nc')
    const form = new FormData() // the same request upload() sends from the browser, into the folder
    form.append('/jobs/a.ncS', '5')
    form.append('myfile', new Blob(['G0 X1']), '/jobs/a.nc')
    assert.equal((await fetch('http://localhost:8095/upload', { method: 'POST', body: form })).status, 200)
    assert.deepEqual(await sd.list('jobs'), [{ name: 'a.nc', size: 5, dir: false }])
    assert.equal(await sd.download('jobs/a.nc'), 'G0 X1')
    assert.deepEqual(await sd.remove('jobs', 'a.nc'), [])
    assert.deepEqual(await sd.remove('', 'jobs', true), [])
  } finally {
    server.close()
  }
})
