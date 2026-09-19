import assert from 'node:assert/strict'
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
      require: (id) => {
        if (id in mocks)
          return mocks[id]
        if (id.startsWith('.') || id.startsWith('~~/')) {
          const target = id.startsWith('~~/') ? resolve(root, id.slice(3)) : resolve(dirname(file), id)
          return moduleAt(/\.[cm]?[jt]s$/.test(target) ? target : `${target}.ts`)
        }
        return require(id)
      },
      Response,
      AbortSignal,
      URL,
      Date,
      console,
      ...globals,
    }, { filename: file })
    return module.exports
  }
  return moduleAt(resolve(root, relative))
}

function json(value) {
  return JSON.parse(JSON.stringify(value))
}

test('Agnes video sanitizer builds text, keyframe, and reference payload inputs', () => {
  const input = load('server/ai/media/agnesVideoInput.ts')
  assert.deepEqual(json(input.sanitizeAgnesVideoInput('agnes/video-2.5-flash-text-to-video', {
    prompt: 'A quiet street',
    aspect_ratio: '16:9',
    duration: 4,
  })), {
    prompt: 'A quiet street',
    mode: 'text',
    size: '720P',
    seconds: '4',
    aspect_ratio: '16:9',
  })
  assert.deepEqual(json(input.sanitizeAgnesVideoInput('agnes/video-2.5-flash-image-to-video', {
    prompt: 'Move forward',
    image_url: ['https://cdn.example/first.png'],
    end_image_url: ['https://cdn.example/last.png'],
    duration: 12,
    aspect_ratio: '9:16',
  })), {
    prompt: 'Move forward',
    mode: 'keyframe',
    size: '720P',
    seconds: '12',
    aspect_ratio: '9:16',
    first_frame: 'https://cdn.example/first.png',
    last_frame: 'https://cdn.example/last.png',
  })
  assert.deepEqual(json(input.sanitizeAgnesVideoInput('agnes/video-2.5-flash-reference-to-video', {
    prompt: 'Use the references',
    image_urls: ['https://cdn.example/a.png'],
    audio_urls: ['https://cdn.example/a.mp3'],
    duration: 5,
  })), {
    prompt: 'Use the references',
    mode: 'reference',
    size: '720P',
    seconds: '5',
    aspect_ratio: '16:9',
    images: ['https://cdn.example/a.png'],
    audios: ['https://cdn.example/a.mp3'],
  })
})

test('Agnes video origin remap keeps HTTPS, upgrades archived locals, and rejects uploads', () => {
  const urls = load('server/utils/agnesVideoUrls.ts')
  const local = '/media/generator/results/job/0.png'
  const upload = '/media/uploads/still.png'
  const remapped = urls.replaceAgnesVideoUrlFields({
    prompt: 'orbit',
    first_frame_url: local,
    last_frame_url: 'https://cdn.example/last.png',
    reference_image_urls: [local, 'https://cdn.example/ref.png'],
  }, new Map([
    [local, 'https://storage.googleapis.com/agnes-aigc/out.png'],
  ]))
  assert.equal(remapped.first_frame_url, 'https://storage.googleapis.com/agnes-aigc/out.png')
  assert.equal(remapped.last_frame_url, 'https://cdn.example/last.png')
  assert.deepEqual(json(remapped.reference_image_urls), [
    'https://storage.googleapis.com/agnes-aigc/out.png',
    'https://cdn.example/ref.png',
  ])

  assert.throws(
    () => urls.replaceAgnesVideoUrlFields({ first_frame_url: upload }, new Map()),
    error => error.failCode === urls.AGNES_PUBLIC_IMAGE_REQUIRED && /Seedance|text-to-video/i.test(error.message) && !/imgur/i.test(error.message),
  )
  assert.throws(
    () => urls.replaceAgnesVideoUrlFields({ first_frame_url: local }, new Map([
      [local, 'http://cdn.example/out.png'],
    ])),
    error => error.failCode === urls.AGNES_PUBLIC_IMAGE_REQUIRED,
  )
  assert.deepEqual(json(urls.applyAgnesHttpsOrigins(
    ['https://cdn.example/still.png'],
    new Map(),
    'first frame',
  )), ['https://cdn.example/still.png'])

  const input = load('server/ai/media/agnesVideoInput.ts')
  assert.deepEqual(json(input.sanitizeAgnesVideoInput('agnes/video-2.5-flash-image-to-video', remapped)), {
    prompt: 'orbit',
    mode: 'keyframe',
    size: '720P',
    seconds: '5',
    aspect_ratio: '16:9',
    first_frame: 'https://storage.googleapis.com/agnes-aigc/out.png',
    last_frame: 'https://cdn.example/last.png',
  })
})

test('Agnes video sanitizer rejects unsupported fields, counts, and non-public sources', () => {
  const input = load('server/ai/media/agnesVideoInput.ts')
  const text = 'agnes/video-2.5-flash-text-to-video'
  const image = 'agnes/video-2.5-flash-image-to-video'
  const reference = 'agnes/video-2.5-flash-reference-to-video'
  for (const duration of [3, 13, 4.5])
    assert.throws(() => input.sanitizeAgnesVideoInput(text, { prompt: 'x', duration }), /4 to 12/i)
  assert.throws(() => input.sanitizeAgnesVideoInput(text, { prompt: 'x', resolution: '1080p' }), /720P/i)
  assert.throws(() => input.sanitizeAgnesVideoInput(text, { prompt: 'x', generate_audio: true }), /audio control/i)
  assert.throws(() => input.sanitizeAgnesVideoInput(image, {
    prompt: 'x',
    image_url: ['data:image/png;base64,aGVsbG8='],
  }), /public HTTPS/i)
  assert.throws(() => input.sanitizeAgnesVideoInput(image, {
    prompt: 'x',
    image_url: ['http://localhost:3001/media/frame.png'],
  }), /public HTTPS/i)
  assert.throws(() => input.sanitizeAgnesVideoInput(reference, {
    prompt: 'x',
    image_urls: Array.from({ length: 6 }, (_, index) => `https://cdn.example/${index}.png`),
  }), /at most 5/i)
  assert.throws(() => input.sanitizeAgnesVideoInput(reference, {
    prompt: 'x',
    image_urls: ['https://cdn.example/a.png'],
    audio_urls: Array.from({ length: 4 }, (_, index) => `https://cdn.example/${index}.mp3`),
  }), /at most 3/i)
  assert.throws(() => input.sanitizeAgnesVideoInput(reference, {
    prompt: 'x',
    video_urls: ['https://cdn.example/a.mp4'],
  }), /reference video/i)
})

function backend(fetchImpl) {
  return load('server/ai/media/agnesVideo.ts', {
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
    '../../utils/serviceSettings': { readServiceSettings: () => ({ agnesKey: 'test-agnes-key' }) },
    './agnesVideoInput': {
      AGNES_VIDEO_MODEL_ID: 'agnes-video-2.5-flash',
      isAgnesVideoModel: () => true,
    },
  }, { fetch: fetchImpl })
}

function job() {
  return {
    provider: 'agnes-video',
    taskId: 'job_agnes_video',
    providerTaskId: '',
    model: 'agnes/video-2.5-flash-text-to-video',
    requestBody: {
      agnesVideo: {
        model: 'agnes-video-2.5-flash',
        input: {
          prompt: 'A quiet street',
          mode: 'text',
          size: '720P',
          seconds: '4',
          aspect_ratio: '16:9',
        },
      },
    },
    providerMetadata: { agnesVideo: { submissionState: 'not_started' } },
    state: 'waiting',
    sourceUrls: [],
    resultUrls: [],
    resultAssets: [],
    resultJson: '',
    failCode: '',
    failMsg: '',
    createdAt: new Date(),
    lastSyncAt: new Date(),
    markModified() {},
    async save() {},
  }
}

test('Agnes completed video URL prefers the live top-level url over metadata.url', () => {
  const api = backend(async () => new Response('{}'))
  assert.equal(api.agnesCompletedVideoUrl({
    status: 'completed',
    url: 'https://platform-outputs.agnes-ai.space/videos/agnes-video-2.5/task_live.mp4',
    metadata: { url: 'https://cdn.example/docs-contract.mp4' },
  }), 'https://platform-outputs.agnes-ai.space/videos/agnes-video-2.5/task_live.mp4')
  assert.equal(api.agnesCompletedVideoUrl({
    status: 'completed',
    metadata: { url: 'https://cdn.example/docs-contract.mp4' },
  }), 'https://cdn.example/docs-contract.mp4')
  assert.equal(api.agnesCompletedVideoUrl({
    status: 'completed',
    progress: 100,
    metadata: {},
  }), '')
})

test('Agnes video start stores video_id and sync archives metadata.url', async () => {
  const calls = []
  const api = backend(async (url, options) => {
    calls.push([url, options])
    if (options?.method === 'POST') {
      return new Response(JSON.stringify({
        id: 'task-not-for-polling',
        task_id: 'task-not-for-polling',
        video_id: 'video-for-polling',
        status: 'queued',
      }), { status: 200 })
    }
    return new Response(JSON.stringify({
      video_id: 'video-for-polling',
      status: 'completed',
      metadata: { url: 'https://cdn.example/result.mp4' },
    }), { status: 200 })
  })
  const current = job()
  const started = await api.agnesVideoBackend.start(current)
  assert.equal(started.providerTaskId, 'video-for-polling')
  current.providerTaskId = started.providerTaskId
  await api.agnesVideoBackend.sync(current)
  assert.equal(current.state, 'archiving')
  assert.deepEqual(json(current.sourceUrls), ['https://cdn.example/result.mp4'])
  assert.match(calls[1][0], /agnesapi\?/)
  assert.match(calls[1][0], /video_id=video-for-polling/)
  assert.match(calls[1][0], /model_name=agnes-video-2.5-flash/)
})

test('Agnes video sync archives the live completed payload top-level url', async () => {
  const api = backend(async () => new Response(JSON.stringify({
    id: 'task_1qey3duls8nLKdVv0xEuJTJ94j0BScmF',
    object: 'video',
    status: 'completed',
    progress: 100,
    seconds: '5',
    size: '720P',
    url: 'https://platform-outputs.agnes-ai.space/videos/agnes-video-2.5/task_1qey3duls8nLKdVv0xEuJTJ94j0BScmF.mp4',
  }), { status: 200 }))
  const current = job()
  current.providerTaskId = 'task_1qey3duls8nLKdVv0xEuJTJ94j0BScmF'
  await api.agnesVideoBackend.sync(current)
  assert.equal(current.state, 'archiving')
  assert.deepEqual(json(current.sourceUrls), [
    'https://platform-outputs.agnes-ai.space/videos/agnes-video-2.5/task_1qey3duls8nLKdVv0xEuJTJ94j0BScmF.mp4',
  ])
  assert.equal(current.failCode, '')
})

test('Agnes video sync maps active, failure, transient, and invalid completion states', async () => {
  for (const [payload, expected] of [
    [{ status: 'queued' }, 'queuing'],
    [{ status: 'in_progress' }, 'generating'],
    [{ status: 'failed', error: { message: 'blocked' } }, 'fail'],
    [{ status: 'completed', metadata: {} }, 'fail'],
  ]) {
    const api = backend(async () => new Response(JSON.stringify(payload), { status: 200 }))
    const current = job()
    current.providerTaskId = 'video-id'
    await api.agnesVideoBackend.sync(current)
    assert.equal(current.state, expected)
  }
  for (const status of [429, 500]) {
    const api = backend(async () => new Response(JSON.stringify({ detail: 'temporary' }), { status }))
    const current = job()
    current.providerTaskId = 'video-id'
    await api.agnesVideoBackend.sync(current)
    assert.equal(current.state, 'waiting')
    assert.match(current.providerMetadata.agnesVideo.lastSyncError, /temporary/i)
  }
})

test('Agnes video sync fails locally after the 15 minute provider deadline', async () => {
  let calls = 0
  const api = backend(async () => {
    calls += 1
    return new Response(JSON.stringify({ status: 'in_progress' }), { status: 200 })
  })
  const current = job()
  current.providerTaskId = 'video-id'
  current.providerMetadata.agnesVideo = {
    submissionState: 'submitted',
    submittedAt: new Date(Date.now() - api.AGNES_VIDEO_MAX_POLL_MS - 1).toISOString(),
  }

  await api.agnesVideoBackend.sync(current)

  assert.equal(calls, 0)
  assert.equal(current.state, 'fail')
  assert.equal(current.failCode, 'timeout')
  assert.match(current.failMsg, /15 minutes/i)
})
