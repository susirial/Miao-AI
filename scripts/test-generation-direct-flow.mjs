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
    publicServiceStatus: () => ({
      imageReady: true,
      videoReady: true,
      providers: { ark: { ok: true }, agnes: { ok: true } },
    }),
    canonicalizeAgnesImageModelId: model => String(model || '').replace('image-2.0-flash', 'image-2.5-flash'),
    resolveMediaGenerationBackend: (model) => {
      if (model.startsWith('seedream/'))
        return { provider: 'ark-image', backendModelId: 'doubao-seedream-5-0-pro-260628', protocolVersion: 'ark-images-sync-v1' }
      if (model.startsWith('bytedance/'))
        return { provider: 'ark-video', backendModelId: 'doubao-seedance-2-0-260128', protocolVersion: 'ark-video-tasks-v1' }
      if (model.startsWith('agnes/image-'))
        return { provider: 'agnes-image', backendModelId: 'agnes-image-2.5-flash', protocolVersion: 'agnes-images-sync-v1' }
      return { provider: 'agnes-video', backendModelId: 'agnes-video-2.5-flash', protocolVersion: 'agnes-video-tasks-v1' }
    },
    sanitizeAgnesImageInput: (_model, input) => ({ ...input, agnesImage: true }),
    sanitizeAgnesVideoInput: (_model, input) => ({ ...input, agnesVideo: true }),
    materializeAgnesVideoSources: async raw => raw,
    sanitizeArkImageInput: (_model, input) => ({ ...input, image: true }),
    sanitizeArkVideoInput: (_model, input) => ({ ...input, video: true }),
    connectDatabase: async () => {},
    resolveProject: async () => ({ _id: 'project' }),
    assertProjectWritable: async () => {},
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
  const { handler, created } = loadHandler({
    publicServiceStatus: () => ({
      imageReady: true,
      videoReady: true,
      providers: { ark: { ok: false }, agnes: { ok: true } },
    }),
  })
  await assert.rejects(handler({ body: { model: 'seedream/5-pro-text-to-image', input: { prompt: 'x' } } }), error => error.statusCode === 503)
  assert.equal(created.length, 0)
})

test('direct Agnes generation snapshots Agnes and requires Agnes readiness', async () => {
  const { handler, created } = loadHandler()
  await handler({ body: { model: 'agnes/image-2.0-flash-text-to-image', input: { prompt: 'x' } } })
  assert.equal(created[0].provider, 'agnes-image')
  assert.equal(created[0].model, 'agnes/image-2.5-flash-text-to-image')
  assert.equal(created[0].backendModelId, 'agnes-image-2.5-flash')
  assert.ok(created[0].requestBody.agnesImage)
  assert.ok(created[0].providerMetadata.agnesImage)

  const unavailable = loadHandler({
    publicServiceStatus: () => ({
      imageReady: true,
      videoReady: true,
      providers: { ark: { ok: true }, agnes: { ok: false } },
    }),
  })
  await assert.rejects(
    unavailable.handler({ body: { model: 'agnes/video-2.5-flash-text-to-video', input: { prompt: 'x' } } }),
    error => error.statusCode === 503,
  )
  assert.equal(unavailable.created.length, 0)
})

test('direct Agnes video remaps local stills before sanitize and Seedance does not', async () => {
  const local = '/media/generator/results/job/0.png'
  const { handler, created } = loadHandler({
    materializeAgnesVideoSources: async (raw) => ({
      ...raw,
      first_frame_url: raw.first_frame_url === local ? 'https://cdn.example/out.png' : raw.first_frame_url,
    }),
  })
  await handler({
    body: {
      model: 'agnes/video-2.5-flash-image-to-video',
      category: 'Video',
      task: 'Image to Video',
      input: { prompt: 'orbit', first_frame_url: local },
    },
  })
  assert.equal(created[0].input.first_frame_url, 'https://cdn.example/out.png')
  assert.ok(created[0].requestBody.agnesVideo)

  const seedance = loadHandler({
    materializeAgnesVideoSources: async () => {
      throw new Error('Seedance must not remap Agnes origins')
    },
  })
  await seedance.handler({
    body: {
      model: 'bytedance/seedance-2-image-to-video',
      category: 'Video',
      task: 'Image to Video',
      input: { prompt: 'orbit', first_frame_url: local },
    },
  })
  assert.equal(seedance.created[0].input.first_frame_url, local)
  assert.ok(seedance.created[0].requestBody.arkVideo)
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
