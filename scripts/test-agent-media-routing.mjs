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
  const cache = new Map()
  function moduleAt(path) {
    if (cache.has(path))
      return cache.get(path).exports
    const code = ts.transpileModule(readFileSync(path, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText
    const module = { exports: {} }
    cache.set(path, module)
    vm.runInNewContext(code, {
      module,
      exports: module.exports,
      URL,
      require: (id) => {
        if (id in mocks)
          return mocks[id]
        if (id.startsWith('.') || id.startsWith('~~/')) {
          const target = id.startsWith('~~/')
            ? resolve(root, id.slice(3))
            : resolve(path, '..', id)
          return moduleAt(/\.[cm]?[jt]s$/.test(target) ? target : `${target}.ts`)
        }
        return require(id)
      },
    })
    return module.exports
  }
  return moduleAt(resolve(root, file))
}

const models = [
  { id: 'seedream/5-pro-text-to-image', name: 'Seedream', category: 'Image', task: 'Text to Image' },
  { id: 'seedream/5-pro-image-to-image', name: 'Seedream', category: 'Image', task: 'Image to Image' },
  { id: 'seedream/5-pro-reference-to-image', name: 'Seedream', category: 'Image', task: 'Reference to Image' },
  { id: 'bytedance/seedance-2-text-to-video', name: 'Seedance', category: 'Video', task: 'Text to Video' },
  { id: 'bytedance/seedance-2-image-to-video', name: 'Seedance', category: 'Video', task: 'Image to Video' },
  { id: 'bytedance/seedance-2-reference-to-video', name: 'Seedance', category: 'Video', task: 'Reference to Video' },
  { id: 'agnes/image-2.5-flash-text-to-image', name: 'Agnes Image', category: 'Image', task: 'Text to Image' },
  { id: 'agnes/image-2.5-flash-image-to-image', name: 'Agnes Image', category: 'Image', task: 'Image to Image' },
  { id: 'agnes/image-2.5-flash-reference-to-image', name: 'Agnes Image', category: 'Image', task: 'Reference to Image' },
  { id: 'agnes/video-2.5-flash-text-to-video', name: 'Agnes Video', category: 'Video', task: 'Text to Video' },
  { id: 'agnes/video-2.5-flash-image-to-video', name: 'Agnes Video', category: 'Video', task: 'Image to Video' },
  { id: 'agnes/video-2.5-flash-reference-to-video', name: 'Agnes Video', category: 'Video', task: 'Reference to Video' },
]

function toolsHarness() {
  return load('server/agent/tools.ts', {
    '~~/shared/constants/aiModels': {
      AGNES_IMAGE_RATIOS: ['1:1', '3:4', '4:3', '16:9', '9:16', '2:3', '3:2', '21:9'],
      AGNES_IMAGE_SIZE_TIERS: ['1K', '2K', '3K', '4K'],
      AGNES_VIDEO_ASPECT_RATIOS: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
      SEEDREAM_5_ASPECT_RATIOS: ['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9'],
      SEEDREAM_5_RESOLUTIONS: ['1K', '2K'],
    },
    '~~/shared/utils/agentChoices': { withCustomChoiceOption: value => value },
    '../utils/storedMediaUrl.mjs': {
      canonicalMediaUrl: value => typeof value === 'string' ? value : '',
      storedMediaKey: (value) => {
        const source = String(value || '').trim()
        if (source.startsWith('/media/') && !source.startsWith('//'))
          return source.slice('/media/'.length)
        try {
          const url = new URL(source)
          if (url.pathname.startsWith('/media/'))
            return decodeURIComponent(url.pathname.slice('/media/'.length))
        }
        catch {
          // Keep the loose harness: only stored /media/ paths are remappable.
        }
        return null
      },
    },
    './exportZip': { exportZipTool: { type: 'function', function: { name: 'export_zip', parameters: {} } } },
    './seedance2': { isSeedance2AspectRatio: () => true, isSeedance2Resolution: () => true },
    './types': {
      AGENT_VIDEO_DURATIONS: [4, 5, 12],
      SEEDANCE_2_ASPECT_RATIOS: ['adaptive', '16:9'],
      SEEDANCE_2_RESOLUTIONS: ['480p', '720p'],
      UNCERTAIN_FIELDS: ['prompt', 'aspect_ratio', 'resolution'],
    },
  })
}

function harness(arkOk = true, agnesOk = false, families = {}) {
  const selectedImageFamily = families.image || 'ark-image'
  const selectedVideoFamily = families.video || 'ark-video'
  return load('server/agent/mediaModels.ts', {
    '~~/shared/utils/agentModels': { AGENT_MODELS: models },
    '../ai/media/arkImageInput': { sanitizeArkImageInput: (_model, input) => ({ ...input, image: true }) },
    '../ai/media/arkVideoInput': { sanitizeArkVideoInput: (_model, input) => ({ ...input, video: true }) },
    '../ai/media/resolve': {
      resolveMediaGenerationBackend: (model) => {
        if (model.startsWith('seedream/'))
          return { provider: 'ark-image', backendModelId: 'doubao-seedream-5-0-pro-260628', protocolVersion: 'ark-images-sync-v1' }
        if (model.startsWith('bytedance/'))
          return { provider: 'ark-video', backendModelId: 'doubao-seedance-2-0-260128', protocolVersion: 'ark-video-tasks-v1' }
        if (model.startsWith('agnes/image-'))
          return { provider: 'agnes-image', backendModelId: 'agnes-image-2.5-flash', protocolVersion: 'agnes-images-sync-v1' }
        return { provider: 'agnes-video', backendModelId: 'agnes-video-2.5-flash', protocolVersion: 'agnes-video-tasks-v1' }
      },
    },
    '../utils/serviceSettings': {
      readServiceSettings: () => ({ selectedImageFamily, selectedVideoFamily }),
      publicServiceStatus: () => ({
        providers: { ark: { ok: arkOk }, agnes: { ok: agnesOk } },
        selectedImageFamily,
        selectedVideoFamily,
      }),
    },
    '../utils/publicMediaOrigin': {
      materializeAgnesVideoSources: async raw => raw,
    },
  })
}

test('Agent exposes Ark and Agnes logical media models', () => {
  const api = harness()
  assert.deepEqual(JSON.parse(JSON.stringify(api.availableAgentModels().map(model => model.id))), models.map(model => model.id))
})

test('preset image selects Seedream text or image mode and snapshots Ark', async () => {
  const api = harness()
  const text = await api.preparePresetImage({ prompt: 'lime poster', aspect_ratio: '1:1', resolution: '1K', input_urls: [] })
  assert.equal(text.modelId, 'seedream/5-pro-text-to-image')
  assert.equal(text.provider, 'ark-image')
  assert.equal(text.backendModelId, 'doubao-seedream-5-0-pro-260628')
  assert.equal(text.protocolVersion, 'ark-images-sync-v1')
  assert.ok(text.requestBody.arkImage)

  const edit = await api.preparePresetImage({ prompt: 'keep subject', aspect_ratio: 'auto', resolution: '2K', input_urls: ['https://cdn.example/source.png'] })
  assert.equal(edit.modelId, 'seedream/5-pro-image-to-image')
  assert.deepEqual(edit.input.input_urls, ['https://cdn.example/source.png'])

  const legacyMulti = await api.preparePresetImage({
    prompt: 'two mechas fight',
    aspect_ratio: '16:9',
    resolution: '2K',
    input_urls: ['https://cdn.example/a.png', 'https://cdn.example/b.png'],
  })
  assert.equal(legacyMulti.modelId, 'seedream/5-pro-reference-to-image')
  assert.deepEqual(legacyMulti.input.reference_images, ['https://cdn.example/a.png', 'https://cdn.example/b.png'])

  const reference = await api.preparePresetImage({
    prompt: 'two mechas fight',
    aspect_ratio: '16:9',
    resolution: '2K',
    input_urls: [],
    reference_images: ['https://cdn.example/a.png', 'https://cdn.example/b.png'],
  })
  assert.equal(reference.modelId, 'seedream/5-pro-reference-to-image')
  assert.deepEqual(reference.input.reference_images, ['https://cdn.example/a.png', 'https://cdn.example/b.png'])
})

test('preset video selects Seedance text, image, or reference mode', async () => {
  const api = harness()
  const base = { prompt: 'camera orbit', aspect_ratio: '16:9', resolution: '720p', duration: 5, generate_audio: true, family: 'seedance-2' }
  assert.equal((await api.preparePresetVideo(base)).modelId, 'bytedance/seedance-2-text-to-video')
  assert.equal((await api.preparePresetVideo({ ...base, first_frame_url: 'https://cdn.example/frame.png' })).modelId, 'bytedance/seedance-2-image-to-video')
  const reference = await api.preparePresetVideo({ ...base, reference_image_urls: ['https://cdn.example/ref.png'] })
  assert.equal(reference.modelId, 'bytedance/seedance-2-reference-to-video')
  assert.equal(reference.provider, 'ark-video')
  assert.equal(reference.backendModelId, 'doubao-seedance-2-0-260128')
  assert.ok(reference.requestBody.arkVideo)
})

test('media preparation fails closed when Ark is not verified', async () => {
  const api = harness(false)
  await assert.rejects(
    () => api.preparePresetImage({ prompt: 'x', aspect_ratio: '1:1', resolution: '1K', input_urls: [] }),
    error => error.failCode === 'MEDIA_PROVIDER_NOT_READY',
  )
})

test('leftover Agnes Image 2.0 IDs resolve to 2.5 size+ratio snapshots', async () => {
  const api = harness(false, true)
  const caps = api.captureMediaCapabilities()
  const spec = await api.resolveAgentGenerationSpec({
    id: 'agnes/image-2.0-flash-text-to-image',
    name: 'Agnes Image 2.5 Flash',
    category: 'Image',
    task: 'Text to Image',
  }, {
    prompt: 'poster',
    size: '1024x1024',
  }, caps)
  assert.equal(spec.modelId, 'agnes/image-2.5-flash-text-to-image')
  assert.equal(spec.backendModelId, 'agnes-image-2.5-flash')
  assert.deepEqual(JSON.parse(JSON.stringify({ size: spec.input.size, ratio: spec.input.ratio })), { size: '1K', ratio: '1:1' })
})

test('preset media prefers Ark and falls back to Agnes only when Agnes is ready', async () => {
  const both = harness(true, true)
  const bothCaps = both.captureMediaCapabilities()
  assert.equal(bothCaps.presetImage, 'ark')
  assert.equal(bothCaps.presetVideo, 'ark')
  assert.equal((await both.preparePresetImage({
    prompt: 'poster',
    aspect_ratio: '1:1',
    resolution: '1K',
    input_urls: [],
  }, bothCaps)).provider, 'ark-image')

  const agnes = harness(false, true)
  const caps = agnes.captureMediaCapabilities()
  assert.deepEqual(JSON.parse(JSON.stringify(caps)), {
    arkOk: false,
    agnesOk: true,
    presetImage: 'agnes',
    presetVideo: 'agnes',
    fingerprint: 'ark:false|agnes:true|img:ark-image|vid:ark-video',
  })
  const image = await agnes.preparePresetImage({
    prompt: 'poster',
    aspect_ratio: '1:1',
    resolution: '1K',
    input_urls: [],
  }, caps)
  assert.equal(image.modelId, 'agnes/image-2.5-flash-text-to-image')
  assert.equal(image.provider, 'agnes-image')
  assert.equal(image.backendModelId, 'agnes-image-2.5-flash')
  assert.deepEqual(JSON.parse(JSON.stringify({ size: image.input.size, ratio: image.input.ratio })), { size: '1K', ratio: '1:1' })

  const video = await agnes.preparePresetVideo({
    prompt: 'camera orbit',
    aspect_ratio: '16:9',
    resolution: '720p',
    duration: 5,
    family: 'seedance-2',
  }, caps)
  assert.equal(video.modelId, 'agnes/video-2.5-flash-text-to-video')
  assert.equal(video.provider, 'agnes-video')
  assert.equal('generate_audio' in video.input, false)
})

test('dual keys honor preferred families and fall back to the other ready provider', async () => {
  const preferred = harness(true, true, { image: 'agnes-image', video: 'agnes-video' })
  const preferredCaps = preferred.captureMediaCapabilities()
  assert.equal(preferredCaps.presetImage, 'agnes')
  assert.equal(preferredCaps.presetVideo, 'agnes')
  assert.equal(preferredCaps.fingerprint, 'ark:true|agnes:true|img:agnes-image|vid:agnes-video')
  assert.equal((await preferred.preparePresetImage({
    prompt: 'poster',
    aspect_ratio: '1:1',
    resolution: '1K',
    input_urls: [],
  }, preferredCaps)).modelId, 'agnes/image-2.5-flash-text-to-image')

  const arkPreferred = harness(true, true, { image: 'ark-image', video: 'ark-video' })
  const arkCaps = arkPreferred.captureMediaCapabilities()
  assert.equal(arkCaps.presetImage, 'ark')
  assert.equal(arkCaps.presetVideo, 'ark')
  assert.equal(arkCaps.fingerprint, 'ark:true|agnes:true|img:ark-image|vid:ark-video')

  const mixed = harness(true, true, { image: 'agnes-image', video: 'ark-video' })
  const mixedCaps = mixed.captureMediaCapabilities()
  assert.equal(mixedCaps.presetImage, 'agnes')
  assert.equal(mixedCaps.presetVideo, 'ark')
  assert.equal(mixedCaps.fingerprint, 'ark:true|agnes:true|img:agnes-image|vid:ark-video')

  const fallback = harness(true, false, { image: 'agnes-image', video: 'agnes-video' })
  const fallbackCaps = fallback.captureMediaCapabilities()
  assert.equal(fallbackCaps.presetImage, 'ark')
  assert.equal(fallbackCaps.presetVideo, 'ark')

  const unavailable = harness(false, false, { image: 'agnes-image', video: 'ark-video' })
  const unavailableCaps = unavailable.captureMediaCapabilities()
  assert.equal(unavailableCaps.presetImage, 'unavailable')
  assert.equal(unavailableCaps.presetVideo, 'unavailable')
})

test('Agnes annotation presets keep source and guide and cap extra refs at four', async () => {
  const api = harness(false, true)
  const caps = api.captureMediaCapabilities()
  const refs = [
    'https://cdn.example/source.png',
    'https://cdn.example/guide.png',
    'https://cdn.example/a.png',
    'https://cdn.example/b.png',
    'https://cdn.example/c.png',
  ]
  const spec = await api.preparePresetImage({
    prompt: 'Follow the numbered points.',
    aspect_ratio: '1:1',
    resolution: '1K',
    input_urls: [],
    reference_images: refs,
  }, caps)
  assert.equal(spec.modelId, 'agnes/image-2.5-flash-reference-to-image')
  assert.deepEqual(spec.input.input_urls, refs.slice(0, 4))
})

test('Agnes preset rejects incompatible explicit media controls without clamping', async () => {
  const api = harness(false, true)
  const caps = api.captureMediaCapabilities()
  const base = {
    prompt: 'camera orbit',
    aspect_ratio: '16:9',
    resolution: '720p',
    duration: 5,
    family: 'seedance-2',
  }
  await assert.rejects(() => api.preparePresetVideo({ ...base, resolution: '480p' }, caps), /720P/i)
  await assert.rejects(() => api.preparePresetVideo({ ...base, aspect_ratio: 'adaptive' }, caps), /aspect ratio/i)
  await assert.rejects(() => api.preparePresetVideo({ ...base, duration: 13 }, caps), /4 to 12/i)
  await assert.rejects(() => api.preparePresetVideo({ ...base, generate_audio: false }, caps), /audio control/i)
  await assert.rejects(() => api.preparePresetVideo({
    ...base,
    reference_video_urls: ['https://cdn.example/ref.mp4'],
  }, caps), /reference video/i)
})

test('generate_image args keep one input_url as an edit and remap extras to references', () => {
  const tools = toolsHarness()
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

test('Agnes generate_image accepts official 16:9 and 2K without locking 1:1', () => {
  const tools = toolsHarness()
  const agnesCaps = {
    arkOk: false,
    agnesOk: true,
    presetImage: 'agnes',
    presetVideo: 'agnes',
    fingerprint: 'ark:false|agnes:true',
  }
  const parsed = tools.parseGenerateImageArgs(JSON.stringify({
    prompt: 'wide poster',
    aspect_ratio: '16:9',
    resolution: '2K',
  }), agnesCaps)
  assert.equal(parsed.aspect_ratio, '16:9')
  assert.equal(parsed.resolution, '2K')
})

test('generate_image schema follows the image family even when video stays Ark', () => {
  const tools = toolsHarness()
  const mixed = tools.buildOpenAiTools({
    arkOk: true,
    agnesOk: true,
    presetImage: 'agnes',
    presetVideo: 'ark',
    fingerprint: 'ark:true|agnes:true|img:agnes-image|vid:ark-video',
  })
  const image = mixed.find(tool => tool.function.name === 'generate_image')
  const video = mixed.find(tool => tool.function.name === 'generate_video')
  assert.deepEqual(JSON.parse(JSON.stringify(image.function.parameters.properties.aspect_ratio.enum)), ['1:1', '3:4', '4:3', '16:9', '9:16', '2:3', '3:2', '21:9'])
  assert.deepEqual(JSON.parse(JSON.stringify(image.function.parameters.properties.resolution.enum)), ['1K', '2K', '3K', '4K'])
  assert.match(image.function.parameters.properties.aspect_ratio.description, /Agnes Image 2\.5/)
  assert.equal('generate_audio' in video.function.parameters.properties, true)
})

test('dynamic preset tools reflect Agnes and unavailable capabilities', () => {
  const tools = toolsHarness()
  const agnesCaps = {
    arkOk: false,
    agnesOk: true,
    presetImage: 'agnes',
    presetVideo: 'agnes',
    fingerprint: 'ark:false|agnes:true',
  }
  const agnesTools = tools.buildOpenAiTools(agnesCaps)
  const video = agnesTools.find(tool => tool.function.name === 'generate_video')
  assert.ok(video)
  assert.equal('generate_audio' in video.function.parameters.properties, false)
  assert.match(video.function.parameters.properties.resolution.description, /720p/i)
  const parsed = tools.parseGenerateVideoArgs(JSON.stringify({
    name: 'Shot',
    prompt: 'camera orbit',
  }), agnesCaps)
  assert.equal(parsed.resolution, '720p')
  assert.equal(parsed.aspect_ratio, '16:9')
  assert.equal(parsed.generate_audio, undefined)

  const unavailable = tools.buildOpenAiTools({
    arkOk: false,
    agnesOk: false,
    presetImage: 'unavailable',
    presetVideo: 'unavailable',
    fingerprint: 'ark:false|agnes:false',
  })
  assert.equal(unavailable.some(tool => tool.function.name === 'generate_image'), false)
  assert.equal(unavailable.some(tool => tool.function.name === 'generate_video'), false)
  assert.equal(unavailable.some(tool => tool.function.name === 'export_zip'), true)
})

test('annotation and sketch generation keep generate_image even in Custom mode', () => {
  const tools = toolsHarness()
  const caps = {
    arkOk: true,
    agnesOk: true,
    presetImage: 'agnes',
    presetVideo: 'ark',
    fingerprint: 'ark:true|agnes:true',
  }
  const custom = tools.selectAgentLoopTools({
    caps,
    custom: true,
    selectedModelIds: ['agnes/image-2.5-flash-reference-to-image'],
  })
  assert.equal(custom.some(tool => tool.function.name === 'generate_image'), false)
  assert.equal(custom.some(tool => tool.function.name === 'generate_video'), false)

  const forced = tools.selectAgentLoopTools({
    caps,
    custom: true,
    selectedModelIds: ['agnes/image-2.5-flash-reference-to-image'],
    requiredTool: 'generate_image',
  })
  assert.equal(forced.some(tool => tool.function.name === 'generate_image'), true)
  assert.equal(tools.requiredToolIfListed('generate_image', forced), 'generate_image')
  assert.equal(tools.requiredToolIfListed('generate_image', custom), undefined)

  const unavailable = tools.selectAgentLoopTools({
    caps: { ...caps, presetImage: 'unavailable' },
    requiredTool: 'generate_image',
  })
  assert.equal(unavailable.some(tool => tool.function.name === 'generate_image'), true)
})

test('Agnes i2v omitted ratio is recommended 16:9 but marked uncertain', () => {
  const tools = toolsHarness()
  const agnesCaps = {
    arkOk: false,
    agnesOk: true,
    presetImage: 'agnes',
    presetVideo: 'agnes',
    fingerprint: 'ark:false|agnes:true',
  }
  const t2v = tools.parseGenerateVideoArgs(JSON.stringify({
    name: 'Shot',
    prompt: 'camera orbit',
  }), agnesCaps)
  assert.equal(t2v.aspect_ratio, '16:9')
  assert.equal(t2v.uncertain_fields.includes('aspect_ratio'), false)

  const i2v = tools.parseGenerateVideoArgs(JSON.stringify({
    name: 'Shot',
    prompt: 'camera orbit',
    first_frame: 'https://cdn.example/frame.png',
  }), agnesCaps)
  assert.equal(i2v.aspect_ratio, '16:9')
  assert.deepEqual(JSON.parse(JSON.stringify(i2v.uncertain_fields)), ['aspect_ratio'])

  const named = tools.parseGenerateVideoArgs(JSON.stringify({
    name: 'Shot',
    prompt: 'camera orbit',
    first_frame: 'https://cdn.example/frame.png',
    aspect_ratio: '9:16',
  }), agnesCaps)
  assert.equal(named.aspect_ratio, '9:16')
  assert.equal(named.uncertain_fields.includes('aspect_ratio'), false)
})

test('unavailable parse fails before applying Ark defaults', () => {
  const tools = toolsHarness()
  const unavailable = {
    arkOk: false,
    agnesOk: false,
    presetImage: 'unavailable',
    presetVideo: 'unavailable',
    fingerprint: 'ark:false|agnes:false',
  }
  assert.throws(
    () => tools.parseGenerateVideoArgs(JSON.stringify({ prompt: 'camera orbit' }), unavailable),
    error => error.failCode === 'MEDIA_PROVIDER_NOT_READY',
  )
  assert.throws(
    () => tools.parseGenerateImageArgs(JSON.stringify({ prompt: 'poster' }), unavailable),
    error => error.failCode === 'MEDIA_PROVIDER_NOT_READY',
  )
})

test('Agnes latest still stays local at resolve so confirmation can keep /media/', () => {
  const tools = toolsHarness()
  const agnesCaps = {
    arkOk: false,
    agnesOk: true,
    presetImage: 'agnes',
    presetVideo: 'agnes',
    fingerprint: 'ark:false|agnes:true',
  }
  const images = [{
    id: 'still-1',
    kind: 'still',
    status: 'success',
    prompt: 'frame',
    aspectRatio: '1:1',
    resolution: '1K',
    url: '/media/frame.png',
    error: '',
  }]
  const parsed = tools.parseGenerateVideoArgs(JSON.stringify({
    name: 'Shot',
    prompt: 'camera orbit',
    first_frame: 'latest',
    aspect_ratio: '16:9',
    resolution: '720p',
  }), agnesCaps)
  const resolved = tools.resolveGenerateVideoArgs(parsed, images, agnesCaps)
  assert.equal(resolved.first_frame_url, '/media/frame.png')
})

test('Agnes video stills that cannot be remapped fail at resolve', () => {
  const tools = toolsHarness()
  const agnesCaps = {
    arkOk: false,
    agnesOk: true,
    presetImage: 'agnes',
    presetVideo: 'agnes',
    fingerprint: 'ark:false|agnes:true',
  }
  const parsed = tools.parseGenerateVideoArgs(JSON.stringify({
    name: 'Shot',
    prompt: 'camera orbit',
    first_frame: 'latest',
    aspect_ratio: '16:9',
    resolution: '720p',
  }), agnesCaps)
  assert.throws(
    () => tools.resolveGenerateVideoArgs(parsed, [{
      id: 'upload-1',
      kind: 'still',
      status: 'success',
      prompt: 'frame',
      aspectRatio: '1:1',
      resolution: '1K',
      url: 'data:image/png;base64,aGVsbG8=',
      error: '',
    }], agnesCaps),
    error => error.failCode === 'AGNES_PUBLIC_IMAGE_REQUIRED' && /Seedance|text-to-video/i.test(error.message),
  )
})

test('Seedance image-to-video keeps local media paths', async () => {
  const api = harness()
  const local = '/media/generator/results/job/0.png'
  const spec = await api.preparePresetVideo({
    prompt: 'camera orbit',
    aspect_ratio: '16:9',
    resolution: '720p',
    duration: 5,
    generate_audio: true,
    family: 'seedance-2',
    first_frame_url: local,
  })
  assert.equal(spec.modelId, 'bytedance/seedance-2-image-to-video')
  assert.equal(spec.input.first_frame_url, local)
})

test('Agnes preset video remaps archived stills before sanitize', async () => {
  const local = '/media/generator/results/job/0.png'
  const api = load('server/agent/mediaModels.ts', {
    '~~/shared/utils/agentModels': { AGENT_MODELS: models },
    '../ai/media/arkImageInput': { sanitizeArkImageInput: (_model, input) => ({ ...input, image: true }) },
    '../ai/media/arkVideoInput': { sanitizeArkVideoInput: (_model, input) => ({ ...input, video: true }) },
    '../ai/media/resolve': {
      resolveMediaGenerationBackend: () => ({
        provider: 'agnes-video',
        backendModelId: 'agnes-video-2.5-flash',
        protocolVersion: 'agnes-video-tasks-v1',
      }),
    },
    '../utils/serviceSettings': {
      readServiceSettings: () => ({ selectedImageFamily: 'agnes-image', selectedVideoFamily: 'agnes-video' }),
      publicServiceStatus: () => ({
        providers: { ark: { ok: false }, agnes: { ok: true } },
        selectedImageFamily: 'agnes-image',
        selectedVideoFamily: 'agnes-video',
      }),
    },
    '../utils/publicMediaOrigin': {
      materializeAgnesVideoSources: async (raw) => ({
        ...raw,
        first_frame_url: raw.first_frame_url === local ? 'https://cdn.example/out.png' : raw.first_frame_url,
        reference_image_urls: Array.isArray(raw.reference_image_urls)
          ? raw.reference_image_urls.map(url => url === local ? 'https://cdn.example/out.png' : url)
          : raw.reference_image_urls,
      }),
    },
  })
  const caps = api.captureMediaCapabilities()
  const spec = await api.preparePresetVideo({
    prompt: 'camera orbit',
    aspect_ratio: '16:9',
    resolution: '720p',
    duration: 5,
    first_frame_url: local,
  }, caps)
  assert.equal(spec.modelId, 'agnes/video-2.5-flash-image-to-video')
  assert.equal(spec.input.first_frame, 'https://cdn.example/out.png')
  assert.equal(spec.requestBody.agnesVideo.input.first_frame, 'https://cdn.example/out.png')
})

test('Ark to Agnes fingerprint mismatch with 480p asks the user instead of clamping', () => {
  const tools = toolsHarness()
  const liveCaps = {
    arkOk: false,
    agnesOk: true,
    presetImage: 'agnes',
    presetVideo: 'agnes',
    fingerprint: 'ark:false|agnes:true',
  }
  const plan = tools.capabilityRequeueFallback(
    [{
      tool: 'generate_video',
      argsJson: JSON.stringify({
        prompt: 'camera orbit',
        aspect_ratio: 'adaptive',
        resolution: '480p',
        generate_audio: true,
      }),
    }],
    liveCaps,
    Object.assign(new Error('Agnes Video 2.5 Flash supports only 720P'), { failCode: 'MEDIA_CAPABILITIES_CHANGED' }),
  )
  assert.equal(plan.action, 'ask_user')
  assert.deepEqual(JSON.parse(JSON.stringify(plan.args.questions.map(question => question.id))), ['resolution', 'aspect_ratio', 'generate_audio'])
  assert.equal(plan.args.questions.find(question => question.id === 'resolution').recommendedId, '720p')

  const unavailable = tools.capabilityRequeueFallback(
    [{ tool: 'generate_video', argsJson: JSON.stringify({ prompt: 'camera orbit', resolution: '720p' }) }],
    { arkOk: false, agnesOk: false, presetImage: 'unavailable', presetVideo: 'unavailable', fingerprint: 'ark:false|agnes:false' },
    Object.assign(new Error('not ready'), { failCode: 'MEDIA_PROVIDER_NOT_READY' }),
  )
  assert.equal(unavailable.action, 'fail')
  assert.equal(unavailable.failCode, 'MEDIA_PROVIDER_NOT_READY')
})
