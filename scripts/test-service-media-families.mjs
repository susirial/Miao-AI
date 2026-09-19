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
  const code = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 },
  }).outputText
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

function harness() {
  const db = new DatabaseSync(':memory:')
  const settings = loadPath(resolve(root, 'server/utils/serviceSettings.ts'), { './sqlite': { connectDatabase: () => db } })
  const handler = loadPath(resolve(root, 'server/api/settings/services.post.ts'), {
    '../../utils/serviceSettings': settings,
    '../../utils/serviceConnection': {
      testServiceConnections: async value => ({
        ...settings.publicServiceStatus(value),
        ark: { ok: true, skipped: true },
        deepSeek: { ok: true, skipped: true },
        zai: { ok: true, skipped: true },
        agnes: { ok: true, skipped: true },
        tos: { ok: true, skipped: true },
      }),
    },
  }, {
    defineEventHandler: fn => fn,
    readBody: async event => event.body,
    setHeader() {},
    getHeader() {},
    getRequestURL: () => ({ origin: 'http://localhost:3001' }),
    createError: value => Object.assign(new Error(value.statusMessage), value),
  }).default
  return { db, settings, handler }
}

test('services POST accepts legal families and echoes all three selections', async () => {
  const { db, settings, handler } = harness()
  const result = await handler({
    body: {
      selectedTextModel: 'agnes/agnes-2.5-flash',
      selectedImageFamily: 'agnes-image',
      selectedVideoFamily: 'agnes-video',
    },
  })
  const saved = settings.readServiceSettings()
  assert.equal(saved.selectedTextModel, 'agnes/agnes-2.5-flash')
  assert.equal(saved.selectedImageFamily, 'agnes-image')
  assert.equal(saved.selectedVideoFamily, 'agnes-video')
  assert.equal(result.selectedTextModel, 'agnes/agnes-2.5-flash')
  assert.equal(result.selectedImageFamily, 'agnes-image')
  assert.equal(result.selectedVideoFamily, 'agnes-video')
  db.close()
})

test('services POST rejects illegal families with HTTP 400 and keeps stored values', async () => {
  const { db, settings, handler } = harness()
  await handler({
    body: {
      selectedImageFamily: 'agnes-image',
      selectedVideoFamily: 'ark-video',
    },
  })
  await assert.rejects(
    () => handler({ body: { selectedImageFamily: 'seedream-please' } }),
    error => error.statusCode === 400 && /selectedImageFamily/.test(error.message),
  )
  await assert.rejects(
    () => handler({ body: { selectedVideoFamily: 'not-a-family' } }),
    error => error.statusCode === 400 && /selectedVideoFamily/.test(error.message),
  )
  const saved = settings.readServiceSettings()
  assert.equal(saved.selectedImageFamily, 'agnes-image')
  assert.equal(saved.selectedVideoFamily, 'ark-video')
  db.close()
})
