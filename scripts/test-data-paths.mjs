import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { after, test } from 'node:test'

const previousDataDir = process.env.MIAO_DATA_DIR
const root = await mkdtemp(join(tmpdir(), 'miao-data-root-'))
process.env.MIAO_DATA_DIR = root

const { localDataPath, localDataRoot } = await import('../server/utils/dataPaths.mjs')
const { mediaRoot, saveMediaFile } = await import('../server/utils/localMedia.ts')
const { closeDatabase, connectDatabase } = await import('../server/utils/sqlite.ts')

after(async () => {
  closeDatabase()
  if (previousDataDir === undefined)
    delete process.env.MIAO_DATA_DIR
  else
    process.env.MIAO_DATA_DIR = previousDataDir
  await rm(root, { recursive: true, force: true })
})

test('MIAO_DATA_DIR owns database, media, and agent session paths', async () => {
  assert.equal(localDataRoot(), resolve(root))
  assert.equal(localDataPath('miao.sqlite'), join(root, 'miao.sqlite'))
  assert.equal(localDataPath('agent-sessions'), join(root, 'agent-sessions'))
  assert.equal(mediaRoot(), join(root, 'media'))

  const mediaUrl = await saveMediaFile('tests/data-root.txt', new TextEncoder().encode('media'), 'text/plain')
  assert.equal(mediaUrl, '/media/tests/data-root.txt')
  assert.equal(await readFile(join(root, 'media/tests/data-root.txt'), 'utf8'), 'media')

  const database = connectDatabase()
  const databaseFile = String(database.prepare('PRAGMA database_list').get().file)
  assert.equal(databaseFile, await realpath(join(root, 'miao.sqlite')))
  assert.equal(existsSync(databaseFile), true)
})
