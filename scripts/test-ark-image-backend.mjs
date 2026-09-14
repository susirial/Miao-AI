import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
function load(relative, mocks = {}, globals = {}) {
  const cache = new Map()
  function moduleAt(file) {
    if (cache.has(file))
      return cache.get(file)
    const module = { exports: {} }
    cache.set(file, module.exports)
    const code = ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 },
    }).outputText
    vm.runInNewContext(code, {
      module,
      exports: module.exports,
      console,
      Buffer,
      URL,
      Response,
      AbortSignal,
      Date,
      Error,
      fetch,
      process,
      ...globals,
      require: (id) => {
        if (id in mocks)
          return mocks[id]
        if (id.startsWith('.') || id.startsWith('~~/')) {
          const target = id.startsWith('~~/') ? resolve(root, id.slice(3)) : resolve(dirname(file), id)
          return moduleAt(/\.[cm]?[jt]s$/.test(target) ? target : `${target}.ts`)
        }
        return require(id)
      },
    }, { filename: file })
    return module.exports
  }
  return moduleAt(resolve(root, relative))
}

test('Ark input maps T2I and I2I controls without unsupported fields', () => {
  const input = load('server/ai/media/arkImageInput.ts')
  const t2i = input.sanitizeArkImageInput('seedream/5-pro-text-to-image', {
    prompt: 'wide landscape',
    aspect_ratio: '16:9',
    resolution: '1K',
    num_images: 1,
    sync_mode: false,
    enable_safety_checker: true,
  })
  assert.equal(input.arkImageSize(t2i), '1360x768')
  assert.equal('num_images' in t2i, false)
  assert.equal('sync_mode' in t2i, false)

  const i2i = input.sanitizeArkImageInput('seedream/5-pro-image-to-image', {
    prompt: 'make it blue',
    image_urls: ['https://example.com/a.png'],
    image_size: 'auto_2K',
    response_format: 'b64_json',
    watermark: true,
  })
  assert.deepEqual(JSON.parse(JSON.stringify(i2i.input_urls)), ['https://example.com/a.png'])
  assert.equal(input.arkImageSize(i2i), '2K')
  assert.equal(i2i.response_format, 'b64_json')
  assert.equal(i2i.watermark, true)
  assert.throws(
    () => input.sanitizeArkImageInput('seedream/5-pro-text-to-image', { prompt: 'x', resolution: '4K' }),
    /only supports 1K or 2K/i,
  )

  const r2i = input.sanitizeArkImageInput('seedream/5-pro-reference-to-image', {
    prompt: 'battle from both mechas',
    reference_images: ['https://example.com/a.png', 'https://example.com/b.png'],
    aspect_ratio: '16:9',
    resolution: '2K',
  })
  assert.deepEqual(JSON.parse(JSON.stringify(r2i.input_urls)), [
    'https://example.com/a.png',
    'https://example.com/b.png',
  ])
  assert.throws(
    () => input.sanitizeArkImageInput('seedream/5-pro-image-to-image', {
      prompt: 'edit both',
      input_urls: ['https://example.com/a.png', 'https://example.com/b.png'],
    }),
    /one source image/i,
  )
})

test('Ark materializes local images as data URLs and rejects invalid or oversized media', async () => {
  const materialize = load('server/ai/media/materialize.ts', {
    '../../utils/localMedia': {
      readStoredMedia: async (source) => {
        if (source.endsWith('/local.png'))
          return { bytes: Buffer.from([137, 80, 78, 71]), mime: 'image/png' }
        if (source.endsWith('/bad.txt'))
          return { bytes: Buffer.from('bad'), mime: 'text/plain' }
        if (source.endsWith('/huge.png'))
          return { bytes: Buffer.alloc(30 * 1024 * 1024 + 1), mime: 'image/png' }
        return null
      },
      saveMediaFile: async () => 'http://localhost:3001/media/result.jpg',
    },
  })
  const values = await materialize.materializeArkImageSources([
    'http://localhost:3001/media/local.png',
    'https://example.com/remote.png',
  ])
  assert.match(values[0], /^data:image\/png;base64,/)
  assert.equal(values[1], 'https://example.com/remote.png')
  await assert.rejects(materialize.materializeArkImageSources(['http://localhost:3001/media/bad.txt']), /image MIME/i)
  await assert.rejects(materialize.materializeArkImageSources(['http://localhost:3001/media/huge.png']), /30MB/i)
  await assert.rejects(materialize.materializeArkImageSources(['file:///tmp/image.png']), /HTTP\(S\)/i)
})

test('Ark response materializes URL and base64 results while retaining partial errors', async () => {
  const saves = []
  const materialize = load('server/ai/media/materialize.ts', {
    '../../utils/localMedia': {
      readStoredMedia: async () => null,
      saveMediaFile: async (...args) => {
        saves.push(args)
        return 'http://localhost:3001/media/generator/results/job/result.jpg'
      },
    },
  })
  const jpeg = Buffer.from([0xFF, 0xD8, 0xFF, 0xD9]).toString('base64')
  const result = await materialize.materializeArkImageResults('job', [
    { url: 'https://example.com/result.png', size: '2048x2048' },
    { b64_json: jpeg },
    { error: { message: 'one item failed' } },
  ])
  assert.deepEqual(JSON.parse(JSON.stringify(result.urls)), [
    'https://example.com/result.png',
    'http://localhost:3001/media/generator/results/job/result.jpg',
  ])
  assert.deepEqual(JSON.parse(JSON.stringify(result.errors)), ['one item failed'])
  assert.equal(saves.length, 1)
  assert.equal(saves[0][2], 'image/jpeg')
})

function arkBackend(overrides = {}) {
  return load('server/ai/media/arkImage.ts', {
    '../../utils/generationJobs': { generationProvider: job => job.provider },
    '../../utils/serviceSettings': { readServiceSettings: () => ({ arkKey: 'test-ark-key' }) },
    './arkImageInput': {
      ARK_IMAGE_MODEL_ID: 'doubao-seedream-5-0-pro-260628',
      arkImageSize: () => '2K',
      isArkImageModel: () => true,
    },
    './materialize': {
      assertArkRequestSize: () => {},
      materializeArkImageSources: async values => values || [],
      materializeArkImageResults: async (_taskId, data) => ({
        urls: data.flatMap(item => item.url ? [item.url] : []),
        errors: data.flatMap(item => item.error ? [item.error.message] : []),
        results: data,
      }),
    },
  }, overrides)
}

function arkJob() {
  let saves = 0
  return {
    provider: 'ark-image',
    taskId: 'job_ark',
    model: 'seedream/5-pro-text-to-image',
    backendModelId: 'doubao-seedream-5-0-pro-260628',
    input: { prompt: 'hello', response_format: 'url', watermark: false },
    requestBody: {
      arkImage: {
        model: 'doubao-seedream-5-0-pro-260628',
        input: { prompt: 'hello', response_format: 'url', watermark: false },
      },
    },
    providerMetadata: { arkImage: { submissionState: 'not_started' } },
    state: 'waiting',
    failCode: '',
    failMsg: '',
    markModified: () => {},
    save: async () => { saves++ },
    get saves() { return saves },
  }
}

test('Ark backend posts the official payload and returns synchronous URLs', async () => {
  const calls = []
  const ark = arkBackend({
    fetch: async (url, options) => {
      calls.push([url, options])
      return new Response(JSON.stringify({ data: [{ url: 'https://example.com/result.jpg' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  })
  const job = arkJob()
  const result = await ark.arkImageBackend.start(job)
  assert.equal(result.status, 'completed')
  assert.deepEqual(JSON.parse(JSON.stringify(result.resultUrls)), ['https://example.com/result.jpg'])
  assert.equal(calls[0][0], 'https://ark.cn-beijing.volces.com/api/v3/images/generations')
  const body = JSON.parse(calls[0][1].body)
  assert.deepEqual(body, {
    model: 'doubao-seedream-5-0-pro-260628',
    prompt: 'hello',
    size: '2K',
    response_format: 'url',
    watermark: false,
  })
  assert.equal(calls[0][1].headers.Authorization, 'Bearer test-ark-key')
  assert.equal(job.providerMetadata.arkImage.submissionState, 'completed')
  assert.equal(typeof calls[0][1].dispatcher, 'object')
  assert.equal(ark.ARK_IMAGE_WAIT_MS, 10 * 60 * 1000)
  assert.equal(calls[0][1].signal.aborted, false)
})

test('Ark image payload keeps multiple references as an image array', async () => {
  const calls = []
  const ark = arkBackend({
    fetch: async (url, options) => {
      calls.push([url, options])
      return new Response(JSON.stringify({ data: [{ url: 'https://example.com/result.jpg' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  })
  const job = arkJob()
  job.model = 'seedream/5-pro-reference-to-image'
  job.input.input_urls = ['https://example.com/a.png', 'https://example.com/b.png']
  job.requestBody.arkImage.input.input_urls = ['https://example.com/a.png', 'https://example.com/b.png']
  await ark.arkImageBackend.start(job)
  const body = JSON.parse(calls[0][1].body)
  assert.deepEqual(body.image, ['https://example.com/a.png', 'https://example.com/b.png'])
})

test('Ark backend handles provider errors and never retries an ambiguous submission', async () => {
  const topError = arkBackend({
    fetch: async () => new Response(JSON.stringify({ error: { message: 'blocked by policy' } }), { status: 400 }),
  })
  await assert.rejects(topError.arkImageBackend.start(arkJob()), /blocked by policy/)

  let calls = 0
  const unknown = arkBackend({
    fetch: async () => {
      calls++
      throw Object.assign(new TypeError('fetch failed'), {
        cause: new Error('socket closed by upstream'),
      })
    },
  })
  const job = arkJob()
  await assert.rejects(unknown.arkImageBackend.start(job), /not retried/i)
  assert.equal(job.state, 'fail')
  assert.equal(job.failCode, 'submission_unknown')
  assert.equal(job.providerMetadata.arkImage.submissionError, 'socket closed by upstream')
  await assert.rejects(unknown.arkImageBackend.start(job), /not retried/i)
  assert.equal(calls, 1)
})

test('dispatcher returns while a synchronous backend is in flight and deduplicates starts', async () => {
  let claimed = false
  let starts = 0
  let release
  const pending = new Promise((resolve) => { release = resolve })
  const job = {
    _id: 'job-id',
    taskId: 'job_sync',
    provider: 'ark-image',
    providerTaskId: '',
    providerMetadata: {},
    requestBody: {},
    originalRequest: {},
    state: 'waiting',
    resultAssets: [],
    sourceUrls: [],
    resultUrls: [],
    failCode: '',
    failMsg: '',
    markModified: () => {},
    save: async () => job,
  }
  const queue = load('server/utils/generationQueue.ts', {
    '~~/shared/utils/apiError': { readErrorMessage: error => error.message },
    '../../shared/types/generation': { GENERATION_ACTIVE_STATES: ['waiting', 'queuing', 'generating', 'archiving'] },
    '../ai/media/registry': {
      startMediaBackend: async () => {
        starts++
        return pending
      },
    },
    '../models/generationJob': {
      GenerationJob: {
        countDocuments: async () => claimed ? 1 : 0,
        findOneAndUpdate: async () => {
          if (claimed)
            return null
          claimed = true
          return job
        },
        findById: async () => job,
      },
    },
    './generationConcurrency': { generationConcurrency: async () => 1 },
    './generationJobs': { isProviderStarted: () => false },
    './generationResults': { mergeSourceUrls: () => {} },
    './localMedia': { isStoredMediaUrl: () => false },
  })
  await Promise.race([
    queue.dispatchQueuedJobs(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('dispatcher blocked')), 100)),
  ])
  await Promise.resolve()
  assert.equal(starts, 1)
  assert.equal(queue.isGenerationStartInFlight(job.taskId), true)
  await queue.startPendingProviderJob(job)
  assert.equal(starts, 1)
  release({ status: 'completed', providerTaskId: '', providerMetadata: {}, resultUrls: ['https://example.com/result.jpg'] })
})
