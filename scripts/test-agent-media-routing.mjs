import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL('..', import.meta.url))

function load(file, mocks = {}) {
  const code = ts.transpileModule(readFileSync(resolve(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const module = { exports: {} }
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require: id => id in mocks ? mocks[id] : require(id),
  })
  return module.exports
}

const models = [
  { id: 'seedream/5-pro-text-to-image', name: 'Seedream', category: 'Image', task: 'Text to Image' },
  { id: 'seedream/5-pro-image-to-image', name: 'Seedream', category: 'Image', task: 'Image to Image' },
  { id: 'seedream/5-pro-reference-to-image', name: 'Seedream', category: 'Image', task: 'Reference to Image' },
  { id: 'bytedance/seedance-2-text-to-video', name: 'Seedance', category: 'Video', task: 'Text to Video' },
  { id: 'bytedance/seedance-2-image-to-video', name: 'Seedance', category: 'Video', task: 'Image to Video' },
  { id: 'bytedance/seedance-2-reference-to-video', name: 'Seedance', category: 'Video', task: 'Reference to Video' },
]

function harness(arkOk = true) {
  return load('server/agent/mediaModels.ts', {
    '~~/shared/utils/agentModels': { AGENT_MODELS: models },
    '../ai/media/arkImageInput': { sanitizeArkImageInput: (_model, input) => ({ ...input, image: true }) },
    '../ai/media/arkVideoInput': { sanitizeArkVideoInput: (_model, input) => ({ ...input, video: true }) },
    '../ai/media/resolve': {
      resolveMediaGenerationBackend: model => model.startsWith('seedream/')
        ? { provider: 'ark-image', backendModelId: 'doubao-seedream-5-0-pro-260628', protocolVersion: 'ark-images-sync-v1' }
        : { provider: 'ark-video', backendModelId: 'doubao-seedance-2-0-260128', protocolVersion: 'ark-video-tasks-v1' },
    },
    '../utils/serviceSettings': {
      readServiceSettings: () => ({}),
      publicServiceStatus: () => ({ providers: { ark: { ok: arkOk } } }),
    },
  })
}

test('Agent exposes only Seedream 5 and Seedance 2 logical models', () => {
  const api = harness()
  assert.deepEqual(JSON.parse(JSON.stringify(api.availableAgentModels().map(model => model.id))), models.map(model => model.id))
})

test('preset image selects Seedream text or image mode and snapshots Ark', () => {
  const api = harness()
  const text = api.preparePresetImage({ prompt: 'lime poster', aspect_ratio: '1:1', resolution: '1K', input_urls: [] })
  assert.equal(text.modelId, 'seedream/5-pro-text-to-image')
  assert.equal(text.provider, 'ark-image')
  assert.equal(text.backendModelId, 'doubao-seedream-5-0-pro-260628')
  assert.equal(text.protocolVersion, 'ark-images-sync-v1')
  assert.ok(text.requestBody.arkImage)

  const edit = api.preparePresetImage({ prompt: 'keep subject', aspect_ratio: 'auto', resolution: '2K', input_urls: ['https://cdn.example/source.png'] })
  assert.equal(edit.modelId, 'seedream/5-pro-image-to-image')
  assert.deepEqual(edit.input.input_urls, ['https://cdn.example/source.png'])

  const legacyMulti = api.preparePresetImage({
    prompt: 'two mechas fight',
    aspect_ratio: '16:9',
    resolution: '2K',
    input_urls: ['https://cdn.example/a.png', 'https://cdn.example/b.png'],
  })
  assert.equal(legacyMulti.modelId, 'seedream/5-pro-reference-to-image')
  assert.deepEqual(legacyMulti.input.reference_images, ['https://cdn.example/a.png', 'https://cdn.example/b.png'])

  const reference = api.preparePresetImage({
    prompt: 'two mechas fight',
    aspect_ratio: '16:9',
    resolution: '2K',
    input_urls: [],
    reference_images: ['https://cdn.example/a.png', 'https://cdn.example/b.png'],
  })
  assert.equal(reference.modelId, 'seedream/5-pro-reference-to-image')
  assert.deepEqual(reference.input.reference_images, ['https://cdn.example/a.png', 'https://cdn.example/b.png'])
})

test('preset video selects Seedance text, image, or reference mode', () => {
  const api = harness()
  const base = { prompt: 'camera orbit', aspect_ratio: '16:9', resolution: '720p', duration: 5, generate_audio: true, family: 'seedance-2' }
  assert.equal(api.preparePresetVideo(base).modelId, 'bytedance/seedance-2-text-to-video')
  assert.equal(api.preparePresetVideo({ ...base, first_frame_url: 'https://cdn.example/frame.png' }).modelId, 'bytedance/seedance-2-image-to-video')
  const reference = api.preparePresetVideo({ ...base, reference_image_urls: ['https://cdn.example/ref.png'] })
  assert.equal(reference.modelId, 'bytedance/seedance-2-reference-to-video')
  assert.equal(reference.provider, 'ark-video')
  assert.equal(reference.backendModelId, 'doubao-seedance-2-0-260128')
  assert.ok(reference.requestBody.arkVideo)
})

test('media preparation fails closed when Ark is not verified', () => {
  const api = harness(false)
  assert.throws(() => api.preparePresetImage({ prompt: 'x', aspect_ratio: '1:1', resolution: '1K', input_urls: [] }), /Configure and test Ark/)
})

test('generate_image args keep one input_url as an edit and remap extras to references', () => {
  const tools = load('server/agent/tools.ts', {
    '~~/shared/constants/aiModels': {
      SEEDREAM_5_ASPECT_RATIOS: ['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9'],
      SEEDREAM_5_RESOLUTIONS: ['1K', '2K'],
    },
    '~~/shared/utils/agentChoices': { withCustomChoiceOption: value => value },
    '../utils/storedMediaUrl.mjs': { canonicalMediaUrl: value => typeof value === 'string' ? value : '' },
    './exportZip': { exportZipTool: {} },
    './seedance2': { isSeedance2AspectRatio: () => true, isSeedance2Resolution: () => true },
    './types': {
      AGENT_VIDEO_DURATIONS: [5],
      SEEDANCE_2_ASPECT_RATIOS: ['16:9'],
      SEEDANCE_2_RESOLUTIONS: ['720p'],
      UNCERTAIN_FIELDS: ['prompt', 'aspect_ratio', 'resolution'],
    },
  })
  const edit = tools.parseGenerateImageArgs(JSON.stringify({
    prompt: 'keep the subject',
    aspect_ratio: 'auto',
    resolution: '2K',
    input_urls: ['https://cdn.example/source.png'],
  }))
  assert.deepEqual(JSON.parse(JSON.stringify(edit.input_urls)), ['https://cdn.example/source.png'])
  assert.deepEqual(JSON.parse(JSON.stringify(edit.reference_images)), [])

  const legacy = tools.parseGenerateImageArgs(JSON.stringify({
    prompt: 'two mechas fight',
    aspect_ratio: '16:9',
    resolution: '2K',
    input_urls: ['https://cdn.example/a.png', 'https://cdn.example/b.png'],
  }))
  assert.deepEqual(JSON.parse(JSON.stringify(legacy.input_urls)), [])
  assert.deepEqual(JSON.parse(JSON.stringify(legacy.reference_images)), ['https://cdn.example/a.png', 'https://cdn.example/b.png'])

  const reference = tools.parseGenerateImageArgs(JSON.stringify({
    prompt: 'two mechas fight',
    aspect_ratio: '16:9',
    resolution: '2K',
    reference_images: ['https://cdn.example/a.png', 'https://cdn.example/b.png'],
  }))
  assert.deepEqual(JSON.parse(JSON.stringify(reference.input_urls)), [])
  assert.deepEqual(JSON.parse(JSON.stringify(reference.reference_images)), ['https://cdn.example/a.png', 'https://cdn.example/b.png'])

  assert.throws(() => tools.parseGenerateImageArgs(JSON.stringify({
    prompt: 'mixed',
    input_urls: ['https://cdn.example/a.png'],
    reference_images: ['https://cdn.example/b.png'],
  })), /Do not set both/)
})
