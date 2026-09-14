import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL('..', import.meta.url))

function loadPath(path, mocks = {}, globals = {}, cache = new Map()) {
  if (cache.has(path))
    return cache.get(path).exports
  const module = { exports: {} }
  cache.set(path, module)
  const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText
  const localRequire = (id) => {
    if (id in mocks)
      return mocks[id]
    if (id.startsWith('.')) {
      const candidate = resolve(dirname(path), id.endsWith('.ts') ? id : `${id}.ts`)
      if (existsSync(candidate))
        return loadPath(candidate, mocks, globals, cache)
    }
    return require(id)
  }
  vm.runInNewContext(code, { module, exports: module.exports, require: localRequire, File, atob, AbortSignal, setTimeout, clearTimeout, ...globals })
  return module.exports
}

function load(file, mocks = {}, globals = {}) {
  return loadPath(resolve(root, 'server/utils', `${file}.ts`), mocks, globals)
}

function harness() {
  const db = new DatabaseSync(':memory:')
  const settings = load('serviceSettings', { './sqlite': { connectDatabase: () => db } })
  return { db, settings }
}

test('new settings default to V3 and Ark Seed 2.1 Pro', () => {
  const { db, settings } = harness()
  const value = settings.readServiceSettings()
  assert.equal(value.version, 3)
  assert.equal(value.selectedTextModel, 'ark/seed-2.1-pro')
  assert.equal(value.arkKey, '')
  assert.equal(value.tosBucket, '')
  assert.ok(!JSON.stringify(value).match(/openrouter|falKey|imageBackend|videoBackend/i))
  db.close()
})

test('obsolete provider fields are ignored on read and never exposed', () => {
  const { db, settings } = harness()
  db.exec('CREATE TABLE local_service_settings (id INTEGER PRIMARY KEY CHECK (id = 1), body TEXT NOT NULL)')
  db.prepare('INSERT INTO local_service_settings VALUES (1, ?)').run(JSON.stringify({
    selectedTextModel: 'openrouter/legacy',
    openRouterKey: 'old-or',
    falKey: 'old-fal',
    arkKey: 'ark-key',
  }))
  const value = settings.readServiceSettings()
  assert.equal(value.selectedTextModel, 'ark/seed-2.1-pro')
  assert.equal(value.arkKey, 'ark-key')
  assert.ok(!JSON.stringify(value).includes('old-'))
  const persisted = JSON.parse(db.prepare('SELECT body FROM local_service_settings WHERE id = 1').get().body)
  assert.equal('openRouterKey' in persisted, false)
  assert.equal('falKey' in persisted, false)
  db.close()
})

test('omitted passwords preserve official keys and public status never exposes secrets', () => {
  const { db, settings } = harness()
  const first = settings.updateServiceSettings({
    arkKey: 'private-ark',
    deepSeekKey: 'private-deepseek',
    zaiKey: 'private-zai',
    tosAccessKeyId: 'private-tos-id',
    tosSecretAccessKey: 'private-tos-secret',
    tosBucket: 'safe-bucket',
    tosPrefix: 'polox/references',
  })
  const next = settings.updateServiceSettings({ selectedTextModel: 'deepseek/deepseek-v4.1-flash' })
  assert.equal(next.arkKey, first.arkKey)
  assert.equal(next.tosSecretAccessKey, first.tosSecretAccessKey)
  assert.notEqual(next.revision, first.revision)
  assert.ok(!JSON.stringify(settings.publicServiceStatus()).includes('private-'))
  db.close()
})

test('TOS bucket and prefix are strictly validated and can be cleared', () => {
  const { db, settings } = harness()
  const configured = settings.updateServiceSettings({
    tosAccessKeyId: 'tos-id',
    tosSecretAccessKey: 'tos-secret',
    tosBucket: 'bucket-123',
    tosPrefix: 'polox/reference-media/',
  })
  assert.equal(configured.tosPrefix, 'polox/reference-media')
  for (const bucket of ['ABucket', '-bucket', 'bucket-', 'ab', 'bucket.name', 'bucket/path'])
    assert.throws(() => settings.updateServiceSettings({ tosBucket: bucket }), /TOS bucket/i)
  for (const prefix of ['/root', '../escape', 'a//b', 'a\\b', 'a/./b', 'has space'])
    assert.throws(() => settings.updateServiceSettings({ tosPrefix: prefix }), /TOS prefix/i)
  assert.throws(() => settings.updateServiceSettings({ tosSecretAccessKey: '' }), /configured together/i)
  db.close()
})

test('image and video readiness always follow Ark', () => {
  const { db, settings } = harness()
  const base = settings.updateServiceSettings({ selectedTextModel: 'deepseek/deepseek-v4.1-flash', deepSeekKey: 'd', arkKey: 'a' })
  const now = new Date().toISOString()
  const status = settings.publicServiceStatus({ ...base, deepSeekOk: true, deepSeekCheckedAt: now, arkOk: true, arkCheckedAt: now, checkedAt: now })
  assert.equal(status.textReady, true)
  assert.equal(status.imageReady, true)
  assert.equal(status.videoReady, true)
  assert.equal(status.connected, true)
  assert.equal(status.mediaValidation.image.backend, 'ark')
  assert.equal(status.mediaValidation.video.backend, 'ark')
  db.close()
})

test('only configured official providers are tested', async () => {
  const { db, settings } = harness()
  const saved = settings.updateServiceSettings({ selectedTextModel: 'deepseek/deepseek-v4.1-flash', deepSeekKey: 'd' })
  const calls = []
  const api = load('serviceConnection', { './serviceSettings': settings, '@volcengine/tos-sdk': class {} }, { fetch: async (url, init) => {
    calls.push(url)
    assert.equal(JSON.parse(init.body).model, 'deepseek-flash')
    return { ok: true, status: 200, json: async () => ({ choices: [{}] }) }
  } })
  const result = await api.testServiceConnections(saved)
  assert.deepEqual(calls, ['https://api.deepseek.com/chat/completions'])
  assert.equal(result.deepSeek.ok, true)
  assert.equal(result.ark.skipped, true)
  assert.equal(result.zai.skipped, true)
  assert.equal(result.tos.skipped, true)
  assert.deepEqual(Object.keys(result.providers).sort(), ['ark', 'deepseek', 'zai'])
  db.close()
})

test('official checks use allowlisted endpoints and catalog upstream IDs', async () => {
  const { db, settings } = harness()
  const saved = settings.updateServiceSettings({ arkKey: 'a', deepSeekKey: 'd', zaiKey: 'z' })
  const seen = new Map()
  const api = load('serviceConnection', { './serviceSettings': settings, '@volcengine/tos-sdk': class {} }, { fetch: async (url, init) => {
    seen.set(url, JSON.parse(init.body))
    return { ok: true, status: 200, json: async () => ({ choices: [{}] }) }
  } })
  const result = await api.testServiceConnections(saved)
  assert.equal(result.ark.ok, true)
  assert.equal(result.deepSeek.ok, true)
  assert.equal(result.zai.ok, true)
  assert.equal(seen.get('https://ark.cn-beijing.volces.com/api/v3/chat/completions').model, 'doubao-seed-2-1-pro-260628')
  assert.equal(seen.get('https://api.deepseek.com/chat/completions').model, 'deepseek-flash')
  assert.equal(seen.get('https://api.z.ai/api/paas/v4/chat/completions').model, 'glm-5.3')
  db.close()
})
