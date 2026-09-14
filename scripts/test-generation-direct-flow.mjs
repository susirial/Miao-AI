import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

function loadHandler(overrides = {}) {
  const source = readFileSync(new URL('../server/api/ai/generate.post.ts', import.meta.url), 'utf8').replace(/^import .*\n/gm, '')
  const created = []
  const context = vm.createContext({
    exports: {},
    console,
    defineEventHandler: fn => fn,
    readBody: async event => event.body,
    readServiceSettings: () => ({}),
    publicServiceStatus: () => ({ imageReady: true, videoReady: true }),
    resolveMediaGenerationBackend: model => model.startsWith('seedream/')
      ? { provider: 'ark-image', backendModelId: 'doubao-seedream-5-0-pro-260628', protocolVersion: 'ark-images-sync-v1' }
      : { provider: 'ark-video', backendModelId: 'doubao-seedance-2-0-260128', protocolVersion: 'ark-video-tasks-v1' },
    sanitizeArkImageInput: (_model, input) => ({ ...input, image: true }),
    sanitizeArkVideoInput: (_model, input) => ({ ...input, video: true }),
    connectDatabase: async () => {},
    resolveProject: async () => ({ _id: 'project' }),
    newLocalTaskId: () => 'task',
    GenerationJob: {
      async create(value) {
        const job = { _id: 'job', ...value }
        created.push(job)
        return job
      },
      async findById() { return { ...created[0], state: 'generating' } },
    },
    dispatchQueuedJobs: async () => {},
    toPublicJob: job => job,
    createError: value => Object.assign(new Error(value.statusMessage), value),
    toPublicApiError: error => error,
    ...overrides,
  })
  vm.runInContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context)
  return { handler: context.exports.default, created }
}

test('direct Seedream generation snapshots the Ark image backend', async () => {
  const { handler, created } = loadHandler()
  await handler({ body: { model: 'seedream/5-pro-text-to-image', category: 'Image', task: 'Text to Image', input: { prompt: 'lime poster' } } })
  assert.equal(created[0].provider, 'ark-image')
  assert.equal(created[0].backendModelId, 'doubao-seedream-5-0-pro-260628')
  assert.equal(created[0].protocolVersion, 'ark-images-sync-v1')
  assert.ok(created[0].requestBody.arkImage)
  assert.ok(created[0].providerMetadata.arkImage)
})

test('direct Seedance generation snapshots the Ark video backend', async () => {
  const { handler, created } = loadHandler()
  await handler({ body: { model: 'bytedance/seedance-2-text-to-video', category: 'Video', task: 'Text to Video', input: { prompt: 'lime pulse' } } })
  assert.equal(created[0].provider, 'ark-video')
  assert.equal(created[0].backendModelId, 'doubao-seedance-2-0-260128')
  assert.equal(created[0].protocolVersion, 'ark-video-tasks-v1')
  assert.ok(created[0].requestBody.arkVideo)
})

test('direct generation rejects media when Ark readiness is false', async () => {
  const { handler, created } = loadHandler({ publicServiceStatus: () => ({ imageReady: false, videoReady: false }) })
  await assert.rejects(handler({ body: { model: 'seedream/5-pro-text-to-image', input: { prompt: 'x' } } }), error => error.statusCode === 503)
  assert.equal(created.length, 0)
})

test('upload endpoint always returns local media storage URL', async () => {
  const source = readFileSync(new URL('../server/api/uploads.post.ts', import.meta.url), 'utf8').replace(/^import .*\n/gm, '')
  const writes = []
  class MockFile {
    type = 'image/png'
    size = 3
    async arrayBuffer() { return Uint8Array.from([1, 2, 3]).buffer }
  }
  const context = vm.createContext({
    exports: {},
    console,
    defineEventHandler: fn => fn,
    readFormData: async () => new Map([['file', new MockFile()]]),
    validateMediaUpload: () => ({ extension: 'png' }),
    saveMediaFile: async (...args) => { writes.push(args); return '/media/upload.png' },
    createError: value => Object.assign(new Error(value.statusMessage), value),
    crypto: { randomUUID: () => 'upload' },
    File: MockFile,
    Uint8Array,
  })
  vm.runInContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context)
  const result = await context.exports.default({})
  assert.equal(result.url, '/media/upload.png')
  assert.equal(writes.length, 1)
})
