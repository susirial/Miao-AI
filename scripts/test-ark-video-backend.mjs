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

function json(value) {
  return JSON.parse(JSON.stringify(value))
}

test('Ark video sanitizer builds T2V, I2V, and remote R2V content', () => {
  const input = load('server/ai/media/arkVideoInput.ts')
  const t2v = input.sanitizeArkVideoInput('bytedance/seedance-2-text-to-video', {
    prompt: 'A quiet street',
    aspect_ratio: 'auto',
    resolution: '1080p',
    duration: 6,
    generate_audio: false,
    watermark: true,
    return_last_frame: true,
  })
  assert.deepEqual(json(t2v), {
    content: [{ type: 'text', text: 'A quiet street' }],
    ratio: 'adaptive',
    resolution: '1080p',
    duration: 6,
    generate_audio: false,
    watermark: true,
    return_last_frame: true,
  })

  const i2v = input.sanitizeArkVideoInput('bytedance/seedance-2-image-to-video', {
    prompt: 'Move forward',
    image_url: ['http://localhost:3001/media/first.png'],
    end_image_url: ['data:image/png;base64,aGVsbG8='],
    duration: 4,
  })
  assert.deepEqual(json(i2v.content.slice(1)), [
    { type: 'image_url', image_url: { url: 'http://localhost:3001/media/first.png' }, role: 'first_frame' },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' }, role: 'last_frame' },
  ])

  const r2v = input.sanitizeArkVideoInput('bytedance/seedance-2-reference-to-video', {
    prompt: 'Use all references',
    reference_image_urls: ['https://example.com/a.png'],
    reference_video_urls: ['https://example.com/a.mp4'],
    reference_audio_urls: ['https://example.com/a.mp3'],
  })
  assert.deepEqual(json(r2v.content.slice(1)), [
    { type: 'image_url', image_url: { url: 'https://example.com/a.png' }, role: 'reference_image' },
    { type: 'video_url', video_url: { url: 'https://example.com/a.mp4' }, role: 'reference_video' },
    { type: 'audio_url', audio_url: { url: 'https://example.com/a.mp3' }, role: 'reference_audio' },
  ])
})

test('Ark video sanitizer enforces mode exclusivity, counts, and output limits', () => {
  const input = load('server/ai/media/arkVideoInput.ts')
  const r2v = 'bytedance/seedance-2-reference-to-video'
  assert.throws(() => input.sanitizeArkVideoInput(r2v, {
    prompt: 'x',
    first_frame_url: 'https://example.com/first.png',
    image_urls: ['https://example.com/ref.png'],
  }), /mutually exclusive/i)
  assert.throws(() => input.sanitizeArkVideoInput(r2v, {
    prompt: 'x',
    audio_urls: ['https://example.com/ref.mp3'],
  }), /image or video/i)
  assert.throws(() => input.sanitizeArkVideoInput(r2v, {
    prompt: 'x',
    image_urls: Array.from({ length: 10 }, (_, index) => `https://example.com/${index}.png`),
  }), /at most 9/i)
  for (const duration of [3, 16, 4.5])
    assert.throws(() => input.sanitizeArkVideoInput('bytedance/seedance-2-text-to-video', { prompt: 'x', duration }), /4 to 15/i)
  assert.throws(() => input.sanitizeArkVideoInput('bytedance/seedance-2-text-to-video', { prompt: 'x', aspect_ratio: '2:1' }), /ratio/i)
  assert.throws(() => input.sanitizeArkVideoInput('bytedance/seedance-2-text-to-video', { prompt: 'x', resolution: '2k' }), /resolution/i)
})

test('Ark video sanitizer numbers references by position, keeping repeats that the prompt counted', () => {
  const input = load('server/ai/media/arkVideoInput.ts')
  const r2v = 'bytedance/seedance-2-reference-to-video'

  // The prompt was written before the URLs were resolved, so it says "image 2"
  // about whatever was passed second. Collapsing the repeat would silently make
  // image 2 mean the wardrobe still instead of the character.
  const repeated = input.sanitizeArkVideoInput(r2v, {
    prompt: 'Character from image 1, again in image 2, wardrobe from image 3',
    reference_image_urls: [
      'https://example.com/hero.png',
      'https://example.com/hero.png',
      'https://example.com/outfit.png',
    ],
  })
  assert.deepEqual(
    json(repeated.content.slice(1).map(item => item.image_url.url)),
    ['https://example.com/hero.png', 'https://example.com/hero.png', 'https://example.com/outfit.png'],
  )

  const videos = input.sanitizeArkVideoInput(r2v, {
    prompt: 'Edit video 1, match the pacing of video 2',
    reference_video_urls: ['https://example.com/take.mp4', 'https://example.com/take.mp4'],
  })
  assert.deepEqual(
    json(videos.content.slice(1).map(item => item.video_url.url)),
    ['https://example.com/take.mp4', 'https://example.com/take.mp4'],
  )

  // Alias keys are two names for one input, so they must not double-count.
  const aliased = input.sanitizeArkVideoInput(r2v, {
    prompt: 'Character from image 1, product from image 2',
    reference_image_urls: ['https://example.com/hero.png', 'https://example.com/product.png'],
    image_urls: ['https://example.com/hero.png', 'https://example.com/extra.png'],
  })
  assert.deepEqual(
    json(aliased.content.slice(1).map(item => item.image_url.url)),
    ['https://example.com/hero.png', 'https://example.com/product.png', 'https://example.com/extra.png'],
  )
})

test('video clamping drops the tail of the reference numbering instead of shifting it', () => {
  const quality = load('server/agent/quality.ts')
  const images = Array.from({ length: 12 }, (_, index) => `https://example.com/${index + 1}.png`)
  const clamped = quality.clampVideoToFamily({
    prompt: 'Character from image 1, product from image 9',
    aspect_ratio: '16:9',
    resolution: '480p',
    duration: 5,
    generate_audio: true,
    family: 'seedance-2',
    reference_images: images,
    reference_videos: ['a.mp4', 'b.mp4', 'c.mp4', 'd.mp4'],
    uncertain_fields: [],
  })
  assert.deepEqual(json(clamped.reference_images), images.slice(0, 9))
  assert.deepEqual(json(clamped.reference_videos), ['a.mp4', 'b.mp4', 'c.mp4'])
})

test('Ark video materializer embeds local images, uploads local AV, and rejects private URLs', async () => {
  const materialize = load('server/ai/media/materialize.ts', {
    '../../utils/localMedia': {
      isStoredMediaUrl: source => source.includes('/media/'),
      readStoredMedia: async source => source.includes('/media/')
        ? { bytes: Buffer.from([137, 80, 78, 71]), mime: 'image/png' }
        : null,
      saveMediaFile: async () => '',
    },
    './arkAssets': {
      materializeArkAsset: async (_source, kind) => ({
        url: `https://reference-bucket.tos-cn-beijing.volces.com/asset.${kind}?X-Tos-Signature=secret`,
        objectKey: `safe/${kind}/hash.${kind}`,
        sourceHash: `${kind}-hash`,
        ...(kind === 'video' ? { durationSeconds: 4 } : {}),
      }),
    },
  })
  const content = await materialize.materializeArkVideoContent([
    { type: 'text', text: 'x' },
    { type: 'image_url', image_url: { url: 'http://localhost:3001/media/first.png' }, role: 'first_frame' },
    { type: 'video_url', video_url: { url: 'http://localhost:3001/media/ref.mp4' }, role: 'reference_video' },
    { type: 'audio_url', audio_url: { url: 'http://localhost:3001/media/ref.mp3' }, role: 'reference_audio' },
    { type: 'video_url', video_url: { url: 'https://example.com/ref.mp4' }, role: 'reference_video' },
  ])
  assert.match(content[1].image_url.url, /^data:image\/png;base64,/)
  assert.match(content[2].video_url.url, /^https:\/\/reference-bucket\.tos-cn-beijing\.volces\.com/)
  assert.match(content[3].audio_url.url, /^https:\/\/reference-bucket\.tos-cn-beijing\.volces\.com/)
  assert.equal(content[4].video_url.url, 'https://example.com/ref.mp4')
  await assert.rejects(materialize.materializeArkVideoContent([
    { type: 'audio_url', audio_url: { url: 'http://localhost:3001/not-media/ref.mp3' }, role: 'reference_audio' },
  ]), /public HTTP\(S\)/i)
  await assert.rejects(materialize.materializeArkVideoContent([
    { type: 'video_url', video_url: { url: 'http://10.0.0.8/ref.mp4' }, role: 'reference_video' },
  ]), /public HTTP\(S\)/i)
  await assert.rejects(materialize.materializeArkVideoContent([
    { type: 'audio_url', audio_url: { url: 'data:audio/mpeg;base64,aGVsbG8=' }, role: 'reference_audio' },
  ]), /Data URL reference audio is not supported/i)
  assert.equal((await materialize.materializeArkVideoContent([
    { type: 'video_url', video_url: { url: 'https://cdn.example/ref.mp4' }, role: 'reference_video' },
  ]))[0].video_url.url, 'https://cdn.example/ref.mp4')
})

test('Ark assets upload with TosClient, deduplicate hashes, and refresh expiring signatures', async () => {
  let now = Date.parse('2026-09-12T00:00:00.000Z')
  let uploads = 0
  let signatures = 0
  const putInputs = []
  class ClockDate extends Date {
    static now() {
      return now
    }
  }
  class MockTosClient {
    constructor(options) {
      assert.equal(options.region, 'cn-beijing')
      assert.equal(options.endpoint, 'https://tos-cn-beijing.volces.com')
      assert.equal(options.bucket, 'reference-bucket')
    }

    async putObject(input) {
      uploads++
      putInputs.push(input)
    }

    getPreSignedUrl(input) {
      signatures++
      assert.equal(input.method, 'GET')
      assert.equal(input.expires, 3600)
      return `https://reference-bucket.tos-cn-beijing.volces.com/${input.key}?X-Tos-Signature=${signatures}`
    }
  }
  const assets = load('server/ai/media/arkAssets.ts', {
    '@volcengine/tos-sdk': MockTosClient,
    '../../utils/serviceSettings': {
      TOS_ENDPOINT: 'https://tos-cn-beijing.volces.com',
      TOS_REGION: 'cn-beijing',
      normalizeTosBucket: value => value,
      normalizeTosPrefix: value => value,
      readServiceSettings: () => ({
        tosAccessKeyId: 'test-id',
        tosSecretAccessKey: 'test-secret',
        tosBucket: 'reference-bucket',
        tosPrefix: 'polox/reference-media',
      }),
    },
    '../../utils/localMedia': {
      isStoredMediaUrl: source => source.startsWith('http://localhost:3001/media/'),
      readStoredMedia: async () => ({ bytes: Buffer.from('same-video'), mime: 'video/mp4' }),
      storedMediaKey: source => source.split('/media/')[1],
      storedMediaFile: async key => ({ path: `/tmp/${key}` }),
    },
  }, { Date: ClockDate })

  const [first, duplicate] = await Promise.all([
    assets.materializeArkAsset('http://localhost:3001/media/a.mp4', 'video'),
    assets.materializeArkAsset('http://localhost:3001/media/b.mp4', 'video'),
  ])
  assert.equal(uploads, 1)
  assert.equal(signatures, 1)
  assert.equal(first.url, duplicate.url)
  assert.match(first.sourceHash, /^[a-f0-9]{64}$/)
  assert.equal(first.objectKey, `polox/reference-media/ark-assets/video/${first.sourceHash}.mp4`)
  assert.equal(putInputs[0].key, first.objectKey)
  assert.equal(putInputs[0].contentType, 'video/mp4')
  assert.equal(putInputs[0].contentSHA256, first.sourceHash)

  now += 56 * 60 * 1000
  const refreshed = await assets.materializeArkAsset('http://localhost:3001/media/a.mp4', 'video')
  assert.equal(uploads, 1)
  assert.equal(signatures, 2)
  assert.notEqual(refreshed.url, first.url)
})

test('Ark assets reject missing TOS configuration and unsupported local media offline', async () => {
  const localMedia = {
    isStoredMediaUrl: () => true,
    readStoredMedia: async () => ({ bytes: Buffer.from('asset'), mime: 'application/octet-stream' }),
  }
  const missing = load('server/ai/media/arkAssets.ts', {
    '@volcengine/tos-sdk': class {},
    '../../utils/serviceSettings': {
      TOS_ENDPOINT: 'https://tos-cn-beijing.volces.com',
      TOS_REGION: 'cn-beijing',
      normalizeTosBucket: value => value,
      normalizeTosPrefix: value => value,
      readServiceSettings: () => ({ tosAccessKeyId: '', tosSecretAccessKey: '', tosBucket: '', tosPrefix: '' }),
    },
    '../../utils/localMedia': localMedia,
  })
  await assert.rejects(missing.materializeArkAsset('http://localhost:3001/media/a.mp4', 'video'), /TOS reference media storage is not configured/i)

  const configured = load('server/ai/media/arkAssets.ts', {
    '@volcengine/tos-sdk': class {},
    '../../utils/serviceSettings': {
      TOS_ENDPOINT: 'https://tos-cn-beijing.volces.com',
      TOS_REGION: 'cn-beijing',
      normalizeTosBucket: value => value,
      normalizeTosPrefix: value => value,
      readServiceSettings: () => ({ tosAccessKeyId: 'id', tosSecretAccessKey: 'secret', tosBucket: 'bucket-123', tosPrefix: '' }),
    },
    '../../utils/localMedia': localMedia,
  })
  await assert.rejects(configured.materializeArkAsset('http://localhost:3001/media/a.bin', 'audio'), /unsupported MIME type/i)
  await assert.rejects(configured.materializeArkAsset('data:audio/mpeg;base64,YQ==', 'audio'), /Data URL reference audio is not supported/i)
})

test('media resolver routes only Seedance 2 video models to Ark', () => {
  const resolver = load('server/ai/media/resolve.ts', {
    '../../../shared/constants/aiModels': {
      isArkImageModelId: () => false,
      isArkVideoModelId: model => model === 'bytedance/seedance-2-text-to-video',
    },
    './arkImage': { ARK_IMAGE_PROTOCOL_VERSION: 'ark-image' },
    './arkImageInput': { ARK_IMAGE_MODEL_ID: 'seedream' },
    './arkVideo': { ARK_VIDEO_PROTOCOL_VERSION: 'ark-video-tasks-v1' },
    './arkVideoInput': {
      ARK_VIDEO_MODEL_ID: 'doubao-seedance-2-0-260128',
    },
  })
  assert.deepEqual(json(resolver.resolveMediaGenerationBackend('bytedance/seedance-2-text-to-video')), {
    provider: 'ark-video',
    backendModelId: 'doubao-seedance-2-0-260128',
    protocolVersion: 'ark-video-tasks-v1',
  })
  assert.throws(() => resolver.resolveMediaGenerationBackend('unsupported/video'), /not available/i)
})

function backend(overrides = {}, materialized = null) {
  return load('server/ai/media/arkVideo.ts', {
    '~~/shared/utils/apiError': {
      readErrorMessage: (error, fallback) => error?.message || error?.error?.message || fallback,
    },
    '../../utils/generationJobs': { generationProvider: job => job.provider },
    '../../utils/generationResults': {
      mergeSourceUrls: (job, urls) => {
        job.sourceUrls = urls
        job.resultAssets = urls.map(sourceUrl => ({ sourceUrl, status: 'pending' }))
      },
    },
    '../../utils/serviceSettings': { readServiceSettings: () => ({ arkKey: 'test-ark-key' }) },
    './materialize': {
      assertArkRequestSize: () => {},
      materializeArkVideoContentWithAssets: async content => materialized || { content, assets: [] },
    },
    './arkVideoInput': {
      ARK_VIDEO_MODEL_ID: 'doubao-seedance-2-0-260128',
      isArkVideoModel: () => true,
    },
  }, overrides)
}

function job() {
  let saves = 0
  return {
    provider: 'ark-video',
    taskId: 'job_ark_video',
    providerTaskId: '',
    model: 'bytedance/seedance-2-text-to-video',
    backendModelId: 'doubao-seedance-2-0-260128',
    input: {},
    requestBody: {
      arkVideo: {
        model: 'doubao-seedance-2-0-260128',
        input: {
          content: [{ type: 'text', text: 'hello' }],
          ratio: '16:9',
          resolution: '720p',
          duration: 5,
          generate_audio: true,
          watermark: false,
          return_last_frame: true,
        },
      },
    },
    providerMetadata: { arkVideo: { submissionState: 'not_started' } },
    state: 'waiting',
    sourceUrls: [],
    resultUrls: [],
    resultAssets: [],
    resultJson: '',
    failCode: '',
    failMsg: '',
    markModified: () => {},
    save: async () => { saves++ },
    get saves() { return saves },
  }
}

test('Ark video start uses the fixed official host and persists the provider task snapshot', async () => {
  const calls = []
  const ark = backend({
    fetch: async (url, options) => {
      calls.push([url, options])
      return new Response(JSON.stringify({ id: 'cgt-official-id', status: 'queued' }), { status: 200 })
    },
  })
  const current = job()
  const started = await ark.arkVideoBackend.start(current)
  assert.equal(started.providerTaskId, 'cgt-official-id')
  assert.equal(current.providerTaskId, 'cgt-official-id')
  assert.equal(current.providerMetadata.arkVideo.submissionState, 'submitted')
  assert.ok(current.saves >= 2)
  assert.equal(calls[0][0], 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks')
  assert.equal(calls[0][1].headers.Authorization, 'Bearer test-ark-key')
  assert.deepEqual(JSON.parse(calls[0][1].body), {
    model: 'doubao-seedance-2-0-260128',
    content: [{ type: 'text', text: 'hello' }],
    ratio: '16:9',
    resolution: '720p',
    duration: 5,
    generate_audio: true,
    watermark: false,
    return_last_frame: true,
  })
})

test('Ark video records only non-sensitive TOS asset metadata', async () => {
  const signedUrl = 'https://reference-bucket.tos-cn-beijing.volces.com/safe/video/hash.mp4?X-Tos-Signature=private-query'
  const ark = backend({}, {
    content: [{ type: 'video_url', video_url: { url: signedUrl }, role: 'reference_video' }],
    assets: [{ kind: 'video', objectKey: 'safe/video/hash.mp4', sourceHash: 'hash' }],
  })
  const current = job()
  const payload = await ark.buildArkVideoPayload(current)
  assert.equal(payload.content[0].video_url.url, signedUrl)
  assert.deepEqual(json(current.providerMetadata.arkVideo.referenceAssets), [
    { kind: 'video', objectKey: 'safe/video/hash.mp4', sourceHash: 'hash' },
  ])
  assert.ok(!JSON.stringify(current.providerMetadata).includes('X-Tos-Signature'))
  assert.ok(!JSON.stringify(current.requestBody).includes('X-Tos-Signature'))
})

test('Ark video start distinguishes definitive errors from ambiguous submissions', async () => {
  const rejected = backend({
    fetch: async () => new Response(JSON.stringify({ error: { message: 'invalid parameter' } }), { status: 400 }),
  })
  const clearFailure = job()
  await assert.rejects(rejected.arkVideoBackend.start(clearFailure), /invalid parameter/i)
  assert.equal(clearFailure.providerMetadata.arkVideo.submissionState, 'failed')
  assert.notEqual(clearFailure.failCode, 'submission_unknown')

  let calls = 0
  const ambiguous = backend({
    fetch: async () => {
      calls++
      throw new TypeError('connection reset')
    },
  })
  const unknown = job()
  await assert.rejects(ambiguous.arkVideoBackend.start(unknown), /not retried/i)
  assert.equal(unknown.state, 'fail')
  assert.equal(unknown.failCode, 'submission_unknown')
  await assert.rejects(ambiguous.arkVideoBackend.start(unknown), /not retried/i)
  assert.equal(calls, 1)
})

test('Ark video sync maps every provider state and enters immediate archiving on success', async () => {
  const statuses = [
    ['queued', 'queuing'],
    ['running', 'generating'],
    ['failed', 'fail'],
    ['cancelled', 'fail'],
    ['expired', 'fail'],
  ]
  for (const [providerStatus, localState] of statuses) {
    const ark = backend({
      fetch: async _url => new Response(JSON.stringify({
        status: providerStatus,
        ...(providerStatus === 'failed' ? { error: { code: 'bad_prompt', message: 'blocked' } } : {}),
      }), { status: 200 }),
    })
    const current = job()
    current.providerTaskId = 'cgt-status-id'
    await ark.arkVideoBackend.sync(current)
    assert.equal(current.state, localState)
  }

  let requestedUrl = ''
  const ark = backend({
    fetch: async (url) => {
      requestedUrl = url
      return new Response(JSON.stringify({
        status: 'succeeded',
        content: {
          video_url: 'https://example.com/result.mp4',
          last_frame_url: 'https://example.com/last.png',
        },
      }), { status: 200 })
    },
  })
  const current = job()
  current.providerTaskId = 'https://evil.example/task?id=1'
  await ark.arkVideoBackend.sync(current)
  assert.equal(requestedUrl, 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/https%3A%2F%2Fevil.example%2Ftask%3Fid%3D1')
  assert.equal(current.state, 'archiving')
  assert.deepEqual(json(current.sourceUrls), ['https://example.com/result.mp4', 'https://example.com/last.png'])
})

test('Ark video sync retains active jobs on network, 429, and 5xx errors', async () => {
  for (const response of [
    () => { throw new TypeError('offline') },
    () => new Response(JSON.stringify({ error: { message: 'slow down' } }), { status: 429 }),
    () => new Response(JSON.stringify({ error: { message: 'unavailable' } }), { status: 503 }),
  ]) {
    const ark = backend({ fetch: async () => response() })
    const current = job()
    current.providerTaskId = 'cgt-transient'
    await ark.arkVideoBackend.sync(current)
    assert.equal(current.state, 'waiting')
    assert.ok(current.providerMetadata.arkVideo.lastSyncError)
  }
  const ark = backend({ fetch: async () => new Response(JSON.stringify({ error: { message: 'not found' } }), { status: 404 }) })
  const current = job()
  current.providerTaskId = 'cgt-gone'
  await ark.arkVideoBackend.sync(current)
  assert.equal(current.state, 'fail')
  assert.equal(current.failCode, '404')
})

test('Ark video provider delete uses the fixed host and maps running cancellation conflicts to 409', async () => {
  let call
  const ark = backend({
    fetch: async (url, options) => {
      call = [url, options]
      return new Response(null, { status: 204 })
    },
  })
  const current = job()
  current.providerTaskId = 'https://evil.example/delete'
  await ark.arkVideoBackend.remove(current)
  assert.equal(call[0], 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/https%3A%2F%2Fevil.example%2Fdelete')
  assert.equal(call[1].method, 'DELETE')

  const conflict = backend({
    fetch: async () => new Response(JSON.stringify({
      error: { message: 'Only queued tasks can be cancelled' },
    }), { status: 400 }),
  })
  await assert.rejects(conflict.arkVideoBackend.remove(current), error => error.statusCode === 409)
})

test('Ark video delete cancels queued tasks and keeps running tasks', async () => {
  const createError = value => Object.assign(new Error(value.statusMessage), value)
  function handlerFor(current, remove, terminalUpdate = null) {
    let findCalls = 0
    return load('server/api/ai/jobs/[taskId].delete.ts', {
      '../../../../shared/types/generation': {
        GENERATION_ACTIVE_STATES: ['waiting', 'queuing', 'generating', 'moderating', 'archiving'],
        isGenerationActive: state => ['waiting', 'queuing', 'generating', 'moderating', 'archiving'].includes(state),
      },
      '../../../ai/media/registry': { removeMediaBackend: remove },
      '../../../agent/session': { removeSessionImages: async () => ({ removedIds: [], blocked: false }) },
      '../../../models/generationJob': {
        GenerationJob: {
          findOne: () => {
            findCalls++
            if (findCalls === 1)
              return Promise.resolve(current)
            return { select: () => ({ lean: async () => current }) }
          },
          findOneAndUpdate: async () => terminalUpdate,
        },
      },
      '../../../utils/generationJobs': { generationProvider: value => value.provider },
      '../../../utils/agentSessionRuntime': { findAgentSessionIdForImage: async () => '' },
      '../../../utils/generationQueue': { dispatchQueuedJobs: async () => {} },
      '../../../utils/sqlite': { connectDatabase: async () => {} },
    }, {
      defineEventHandler: fn => fn,
      getRouterParam: () => 'job-delete',
      createError,
    }).default
  }

  let removes = 0
  let saves = 0
  const queued = {
    provider: 'ark-video',
    providerTaskId: 'cgt-delete',
    state: 'queuing',
    deleted: false,
    save: async () => { saves++ },
  }
  assert.deepEqual(json(await handlerFor(queued, async () => { removes++ })({})), { ok: true })
  assert.equal(removes, 1)
  assert.equal(saves, 1)
  assert.equal(queued.deleted, true)

  const running = { ...queued, state: 'generating', deleted: false }
  await assert.rejects(handlerFor(running, async () => { removes++ })({}), error => error.statusCode === 409)
})
