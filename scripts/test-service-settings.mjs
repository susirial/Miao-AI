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

const providerConfigMock = {
  PROVIDER_CONFIGS: {
    ark: { endpoint: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions' },
    deepseek: { endpoint: 'https://api.deepseek.com/chat/completions' },
    zai: { endpoint: 'https://api.z.ai/api/paas/v4/chat/completions' },
    agnes: { endpoint: 'https://apihub.agnes-ai.com/v1/chat/completions' },
  },
}

test('new settings default to V4 and Ark Seed 2.1 Pro', () => {
  const { db, settings } = harness()
  const value = settings.readServiceSettings()
  assert.equal(value.version, 4)
  assert.equal(value.selectedTextModel, 'ark/seed-2.1-pro')
  assert.equal(value.arkKey, '')
  assert.equal(value.agnesKey, '')
  assert.equal(value.agnesOk, false)
  assert.equal(value.agnesCheckedAt, '')
  assert.equal(value.tosBucket, '')
  assert.ok(!JSON.stringify(value).match(/openrouter|falKey|imageBackend|videoBackend/i))
  assert.equal(value.selectedImageFamily, 'ark-image')
  assert.equal(value.selectedVideoFamily, 'ark-video')
  db.close()
})

test('missing media families fall back to Ark defaults without dropping keys', () => {
  const { db, settings } = harness()
  db.exec('CREATE TABLE local_service_settings (id INTEGER PRIMARY KEY CHECK (id = 1), body TEXT NOT NULL)')
  db.prepare('INSERT INTO local_service_settings VALUES (1, ?)').run(JSON.stringify({
    version: 4,
    selectedTextModel: 'agnes/agnes-2.5-flash',
    arkKey: 'keep-ark',
    agnesKey: 'keep-agnes',
  }))
  const value = settings.readServiceSettings()
  assert.equal(value.selectedTextModel, 'agnes/agnes-2.5-flash')
  assert.equal(value.selectedImageFamily, 'ark-image')
  assert.equal(value.selectedVideoFamily, 'ark-video')
  assert.equal(value.arkKey, 'keep-ark')
  assert.equal(value.agnesKey, 'keep-agnes')
  db.close()
})

test('historical invalid media families fall back to Ark defaults', () => {
  const { db, settings } = harness()
  db.exec('CREATE TABLE local_service_settings (id INTEGER PRIMARY KEY CHECK (id = 1), body TEXT NOT NULL)')
  db.prepare('INSERT INTO local_service_settings VALUES (1, ?)').run(JSON.stringify({
    version: 4,
    selectedTextModel: 'ark/seed-2.1-pro',
    selectedImageFamily: 'seedream-please',
    selectedVideoFamily: 'video-family-v1',
    arkKey: 'keep-ark',
  }))
  const value = settings.readServiceSettings()
  assert.equal(value.selectedImageFamily, 'ark-image')
  assert.equal(value.selectedVideoFamily, 'ark-video')
  assert.equal(value.arkKey, 'keep-ark')
  const persisted = JSON.parse(db.prepare('SELECT body FROM local_service_settings WHERE id = 1').get().body)
  assert.equal(persisted.selectedImageFamily, 'ark-image')
  assert.equal(persisted.selectedVideoFamily, 'ark-video')
  db.close()
})

test('rememberMediaFamilies updates last-used families without clearing verified flags', () => {
  const { db, settings } = harness()
  const saved = settings.updateServiceSettings({
    selectedImageFamily: 'ark-image',
    selectedVideoFamily: 'ark-video',
    arkKey: 'ark',
    agnesKey: 'agnes',
  })
  const verified = {
    ...saved,
    arkOk: true,
    agnesOk: true,
    arkCheckedAt: '2026-09-19T00:00:00.000Z',
    agnesCheckedAt: '2026-09-19T00:00:00.000Z',
    checkedAt: '2026-09-19T00:00:00.000Z',
  }
  settings.writeServiceSettings(verified)
  const remembered = settings.rememberMediaFamilies({
    selectedImageFamily: 'agnes-image',
    selectedVideoFamily: 'agnes-video',
  })
  assert.equal(remembered.selectedImageFamily, 'agnes-image')
  assert.equal(remembered.selectedVideoFamily, 'agnes-video')
  assert.equal(remembered.arkOk, true)
  assert.equal(remembered.agnesOk, true)
  assert.equal(remembered.arkKey, 'ark')
  db.close()
})

test('saved media families persist and reopen with the three selections', () => {
  const { db, settings } = harness()
  settings.updateServiceSettings({
    selectedTextModel: 'agnes/agnes-2.5-flash',
    selectedImageFamily: 'agnes-image',
    selectedVideoFamily: 'agnes-video',
    agnesKey: 'agnes-key',
  })
  const value = settings.readServiceSettings()
  assert.equal(value.selectedTextModel, 'agnes/agnes-2.5-flash')
  assert.equal(value.selectedImageFamily, 'agnes-image')
  assert.equal(value.selectedVideoFamily, 'agnes-video')
  const status = settings.publicServiceStatus(value)
  assert.equal(status.selectedImageFamily, 'agnes-image')
  assert.equal(status.selectedVideoFamily, 'agnes-video')
  db.close()
})

test('explicit illegal families throw instead of rewriting to Ark', () => {
  const { db, settings } = harness()
  const saved = settings.updateServiceSettings({
    selectedImageFamily: 'agnes-image',
    selectedVideoFamily: 'agnes-video',
  })
  assert.throws(() => settings.updateServiceSettings({ selectedImageFamily: 'seedream-please' }), /selectedImageFamily/)
  assert.throws(() => settings.updateServiceSettings({ selectedVideoFamily: 'not-a-family' }), /selectedVideoFamily/)
  const value = settings.readServiceSettings()
  assert.equal(value.selectedImageFamily, saved.selectedImageFamily)
  assert.equal(value.selectedVideoFamily, saved.selectedVideoFamily)
  db.close()
})

test('selected family readiness is independent from aggregate image and video ready', () => {
  const { db, settings } = harness()
  const base = settings.updateServiceSettings({
    selectedImageFamily: 'agnes-image',
    selectedVideoFamily: 'ark-video',
    arkKey: 'a',
    agnesKey: 'g',
  })
  const now = new Date().toISOString()
  const arkOnly = settings.publicServiceStatus({
    ...base,
    arkOk: true,
    arkCheckedAt: now,
    agnesOk: false,
    agnesCheckedAt: '',
  })
  assert.equal(arkOnly.imageReady, true)
  assert.equal(arkOnly.videoReady, true)
  assert.equal(arkOnly.selectedImageReady, false)
  assert.equal(arkOnly.selectedVideoReady, true)

  const both = settings.publicServiceStatus({
    ...base,
    selectedImageFamily: 'ark-image',
    selectedVideoFamily: 'agnes-video',
    arkOk: false,
    arkCheckedAt: '',
    agnesOk: true,
    agnesCheckedAt: now,
  })
  assert.equal(both.imageReady, true)
  assert.equal(both.selectedImageReady, false)
  assert.equal(both.selectedVideoReady, true)
  db.close()
})

test('V3 settings upgrade to V4 while obsolete provider fields are ignored', () => {
  const { db, settings } = harness()
  db.exec('CREATE TABLE local_service_settings (id INTEGER PRIMARY KEY CHECK (id = 1), body TEXT NOT NULL)')
  db.prepare('INSERT INTO local_service_settings VALUES (1, ?)').run(JSON.stringify({
    version: 3,
    selectedTextModel: 'openrouter/legacy',
    openRouterKey: 'old-or',
    falKey: 'old-fal',
    arkKey: 'ark-key',
    deepSeekKey: 'deepseek-key',
    zaiKey: 'zai-key',
  }))
  const value = settings.readServiceSettings()
  assert.equal(value.version, 4)
  assert.equal(value.selectedTextModel, 'ark/seed-2.1-pro')
  assert.equal(value.arkKey, 'ark-key')
  assert.equal(value.deepSeekKey, 'deepseek-key')
  assert.equal(value.zaiKey, 'zai-key')
  assert.equal(value.agnesKey, '')
  assert.ok(!JSON.stringify(value).includes('old-'))
  const persisted = JSON.parse(db.prepare('SELECT body FROM local_service_settings WHERE id = 1').get().body)
  assert.equal(persisted.version, 4)
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
    agnesKey: 'private-agnes',
    tosAccessKeyId: 'private-tos-id',
    tosSecretAccessKey: 'private-tos-secret',
    tosBucket: 'safe-bucket',
    tosPrefix: 'polox/references',
  })
  const next = settings.updateServiceSettings({ selectedTextModel: 'deepseek/deepseek-v4.1-flash' })
  assert.equal(next.arkKey, first.arkKey)
  assert.equal(next.agnesKey, first.agnesKey)
  assert.equal(next.tosSecretAccessKey, first.tosSecretAccessKey)
  assert.notEqual(next.revision, first.revision)
  assert.ok(!JSON.stringify(settings.publicServiceStatus()).includes('private-'))

  const cleared = settings.updateServiceSettings({ agnesKey: '' })
  assert.equal(cleared.agnesKey, '')
  assert.equal(cleared.agnesOk, false)
  assert.equal(cleared.agnesCheckedAt, '')
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

test('image and video readiness follow either verified media provider', () => {
  const { db, settings } = harness()
  const base = settings.updateServiceSettings({ selectedTextModel: 'deepseek/deepseek-v4.1-flash', deepSeekKey: 'd', arkKey: 'a' })
  const now = new Date().toISOString()
  const status = settings.publicServiceStatus({ ...base, deepSeekOk: true, deepSeekCheckedAt: now, arkOk: true, arkCheckedAt: now, checkedAt: now })
  assert.equal(status.textReady, true)
  assert.equal(status.imageReady, true)
  assert.equal(status.videoReady, true)
  assert.equal(status.connected, true)
  assert.deepEqual(JSON.parse(JSON.stringify(status.mediaValidation.image.backends)), ['ark'])
  assert.deepEqual(JSON.parse(JSON.stringify(status.mediaValidation.video.backends)), ['ark'])

  const agnesOnly = settings.publicServiceStatus({
    ...base,
    selectedTextModel: 'agnes/agnes-2.5-flash',
    agnesKey: 'g',
    arkKey: '',
    agnesOk: true,
    agnesCheckedAt: now,
    arkOk: false,
    arkCheckedAt: '',
  })
  assert.equal(agnesOnly.imageReady, true)
  assert.equal(agnesOnly.videoReady, true)
  assert.equal(agnesOnly.connected, true)
  assert.deepEqual(JSON.parse(JSON.stringify(agnesOnly.mediaValidation.image.backends)), ['agnes'])
  db.close()
})

test('Agnes selection uses Agnes readiness for text and media without Ark', () => {
  const { db, settings } = harness()
  const base = settings.updateServiceSettings({
    selectedTextModel: 'agnes/agnes-2.5-flash',
    agnesKey: 'agnes-key',
    arkKey: 'ark-key',
  })
  const now = new Date().toISOString()
  const withoutArk = settings.publicServiceStatus({
    ...base,
    agnesOk: true,
    agnesCheckedAt: now,
    checkedAt: now,
  })
  assert.equal(withoutArk.textReady, true)
  assert.equal(withoutArk.imageReady, true)
  assert.equal(withoutArk.videoReady, true)
  assert.equal(withoutArk.connected, true)

  const withArk = settings.publicServiceStatus({
    ...base,
    agnesOk: true,
    agnesCheckedAt: now,
    arkOk: true,
    arkCheckedAt: now,
    checkedAt: now,
  })
  assert.equal(withArk.connected, true)
  assert.equal(withArk.providers.agnes.configured, true)
  assert.equal(withArk.providers.agnes.ok, true)
  assert.ok(!JSON.stringify(withArk).includes('agnes-key'))
  db.close()
})

test('only configured official providers are tested', async () => {
  const { db, settings } = harness()
  const saved = settings.updateServiceSettings({ selectedTextModel: 'deepseek/deepseek-v4.1-flash', deepSeekKey: 'd' })
  const calls = []
  const api = load('serviceConnection', {
    './serviceSettings': settings,
    '../ai/llm/adapters': providerConfigMock,
    '@volcengine/tos-sdk': class {},
  }, { fetch: async (url, init) => {
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
  assert.equal(result.agnes.skipped, true)
  assert.deepEqual(Object.keys(result.providers).sort(), ['agnes', 'ark', 'deepseek', 'zai'])
  db.close()
})

test('Agnes 3.0 Flash can be saved and unknown text models are rejected', () => {
  const { db, settings } = harness()
  const saved = settings.updateServiceSettings({ selectedTextModel: 'agnes/agnes-3.0-flash' })
  assert.equal(saved.version, 4)
  assert.equal(saved.selectedTextModel, 'agnes/agnes-3.0-flash')
  assert.equal(settings.readServiceSettings().selectedTextModel, 'agnes/agnes-3.0-flash')
  assert.throws(
    () => settings.updateServiceSettings({ selectedTextModel: 'agnes/agnes-9.9-flash' }),
    /Unknown text model/i,
  )
  assert.equal(settings.readServiceSettings().selectedTextModel, 'agnes/agnes-3.0-flash')
  db.close()
})

test('official checks use allowlisted endpoints and catalog upstream IDs', async () => {
  const { db, settings } = harness()
  const saved = settings.updateServiceSettings({ arkKey: 'a', deepSeekKey: 'd', zaiKey: 'z', agnesKey: 'g' })
  const seen = new Map()
  const api = load('serviceConnection', {
    './serviceSettings': settings,
    '../ai/llm/adapters': providerConfigMock,
    '@volcengine/tos-sdk': class {},
  }, { fetch: async (url, init) => {
    seen.set(url, { body: JSON.parse(init.body), signal: init.signal })
    return { ok: true, status: 200, json: async () => ({ choices: [{}] }) }
  } })
  const result = await api.testServiceConnections(saved)
  assert.equal(result.ark.ok, true)
  assert.equal(result.deepSeek.ok, true)
  assert.equal(result.zai.ok, true)
  assert.equal(result.agnes.ok, true)
  assert.equal(seen.get('https://ark.cn-beijing.volces.com/api/v3/chat/completions').body.model, 'doubao-seed-2-1-pro-260628')
  assert.equal(seen.get('https://api.deepseek.com/chat/completions').body.model, 'deepseek-flash')
  assert.equal(seen.get('https://api.z.ai/api/paas/v4/chat/completions').body.model, 'glm-5.3')
  const agnes = seen.get('https://apihub.agnes-ai.com/v1/chat/completions')
  assert.equal(agnes.body.model, 'agnes-3.0-flash')
  assert.equal(agnes.body.max_tokens, 8)
  assert.equal(agnes.body.stream, false)
  assert.deepEqual(agnes.body.chat_template_kwargs, { enable_thinking: false })
  assert.equal(agnes.signal.aborted, false)

  const selected25 = settings.updateServiceSettings({ selectedTextModel: 'agnes/agnes-2.5-flash', agnesKey: 'g' })
  const seen25 = new Map()
  const api25 = load('serviceConnection', {
    './serviceSettings': settings,
    '../ai/llm/adapters': providerConfigMock,
    '@volcengine/tos-sdk': class {},
  }, { fetch: async (url, init) => {
    seen25.set(url, JSON.parse(init.body))
    return { ok: true, status: 200, json: async () => ({ choices: [{}] }) }
  } })
  await api25.testServiceConnections(selected25)
  assert.equal(seen25.get('https://apihub.agnes-ai.com/v1/chat/completions').model, 'agnes-2.5-flash')

  const selected30 = settings.updateServiceSettings({ selectedTextModel: 'agnes/agnes-3.0-flash', agnesKey: 'g' })
  const seen30 = new Map()
  const api30 = load('serviceConnection', {
    './serviceSettings': settings,
    '../ai/llm/adapters': providerConfigMock,
    '@volcengine/tos-sdk': class {},
  }, { fetch: async (url, init) => {
    seen30.set(url, JSON.parse(init.body))
    return { ok: true, status: 200, json: async () => ({ choices: [{}] }) }
  } })
  await api30.testServiceConnections(selected30)
  assert.equal(seen30.get('https://apihub.agnes-ai.com/v1/chat/completions').model, 'agnes-3.0-flash')
  db.close()
})
