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
      require: (id) => {
        if (id in mocks)
          return mocks[id]
        if (id.startsWith('.') || id.startsWith('~~/')) {
          const target = id.startsWith('~~/') ? resolve(root, id.slice(3)) : resolve(dirname(file), id)
          return moduleAt(/\.[cm]?[jt]s$/.test(target) ? target : `${target}.ts`)
        }
        return require(id)
      },
      Buffer,
      Response,
      AbortSignal,
      URL,
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

test('Agnes image sanitizer freezes size+ratio and remaps 2.0 IDs and pixel sizes', () => {
  const input = load('server/ai/media/agnesImageInput.ts')
  assert.deepEqual(json(input.sanitizeAgnesImageInput('agnes/image-2.5-flash-text-to-image', {
    prompt: 'A clean poster',
    size: '1K',
    ratio: '16:9',
  })), {
    prompt: 'A clean poster',
    size: '1K',
    ratio: '16:9',
  })
  assert.deepEqual(json(input.sanitizeAgnesImageInput('agnes/image-2.0-flash-image-to-image', {
    prompt: 'Turn it blue',
    input_urls: ['https://cdn.example/source.png'],
    size: '1024x768',
  })), {
    prompt: 'Turn it blue',
    size: '1K',
    ratio: '4:3',
    input_urls: ['https://cdn.example/source.png'],
  })
  assert.deepEqual(json(input.sanitizeAgnesImageInput('agnes/image-2.0-flash-text-to-image', {
    prompt: 'Square',
    size: '2048x2048',
  })), {
    prompt: 'Square',
    size: '2K',
    ratio: '1:1',
  })
  assert.throws(() => input.sanitizeAgnesImageInput('agnes/image-2.5-flash-text-to-image', {
    prompt: 'x',
    size: '1344x768',
  }), /size/i)
  assert.throws(() => input.sanitizeAgnesImageInput('agnes/image-2.5-flash-image-to-image', {
    prompt: 'x',
    input_urls: [],
  }), /source image/i)
  assert.throws(() => input.sanitizeAgnesImageInput('agnes/image-2.5-flash-reference-to-image', {
    prompt: 'x',
    input_urls: Array.from({ length: 5 }, (_, index) => `https://cdn.example/${index}.png`),
  }), /at most 4/i)
})

test('Agnes image backend sends 2.5 plus size+ratio and remaps leftover 2.0 snapshots', async () => {
  const calls = []
  const downloads = []
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const api = load('server/ai/media/agnesImage.ts', {
    '../../utils/generationJobs': { generationProvider: job => job.provider },
    '../../utils/serviceSettings': { readServiceSettings: () => ({ agnesKey: 'test-agnes-key' }) },
    '../../utils/mediaExport': {
      downloadExportMedia: async (url) => {
        downloads.push(url)
        return { bytes: png, mime: 'image/png' }
      },
    },
    './materialize': {
      assertArkRequestSize: () => {},
      materializeArkImageSources: async values => values,
      materializeArkImageResults: async (_taskId, data) => ({
        urls: data.map(item => item.url),
        errors: [],
        results: data,
      }),
    },
  }, {
    fetch: async (url, options) => {
      calls.push([url, options])
      return new Response(JSON.stringify({ data: [{ url: 'https://cdn.example/result.png' }] }), { status: 200 })
    },
  })
  const job = {
    provider: 'agnes-image',
    taskId: 'job_agnes_image',
    model: 'agnes/image-2.0-flash-image-to-image',
    backendModelId: 'agnes-image-2.0-flash',
    requestBody: {
      agnesImage: {
        model: 'agnes-image-2.0-flash',
        input: {
          prompt: 'Turn it blue',
          size: '1024x768',
          input_urls: ['https://cdn.example/source.png'],
        },
      },
    },
    providerMetadata: { agnesImage: { submissionState: 'not_started' } },
    state: 'waiting',
    failCode: '',
    failMsg: '',
    markModified() {},
    async save() {},
  }

  const result = await api.agnesImageBackend.start(job)
  assert.equal(result.status, 'completed')
  assert.deepEqual(downloads, ['https://cdn.example/source.png'])
  assert.equal(calls[0][0], 'https://apihub.agnes-ai.com/v1/images/generations')
  assert.equal(calls[0][1].headers.Authorization, 'Bearer test-agnes-key')
  const body = JSON.parse(calls[0][1].body)
  assert.deepEqual(body, {
    model: 'agnes-image-2.5-flash',
    prompt: 'Turn it blue',
    size: '1K',
    ratio: '4:3',
    extra_body: {
      image: [`data:image/png;base64,${png.toString('base64')}`],
      response_format: 'url',
    },
  })
  assert.equal('image' in body, false)
  assert.equal('response_format' in body, false)
  assert.equal('tags' in body, false)
})

test('Agnes image payload keeps already-inlined data URLs and does not redownload them', async () => {
  const downloads = []
  const api = load('server/ai/media/agnesImage.ts', {
    '../../utils/generationJobs': { generationProvider: job => job.provider },
    '../../utils/serviceSettings': { readServiceSettings: () => ({ agnesKey: 'test-agnes-key' }) },
    '../../utils/mediaExport': {
      downloadExportMedia: async (url) => {
        downloads.push(url)
        return { bytes: Buffer.from('nope'), mime: 'image/png' }
      },
    },
    './materialize': {
      assertArkRequestSize: () => {},
      materializeArkImageSources: async values => values,
      materializeArkImageResults: async () => ({ urls: [], errors: [], results: [] }),
    },
  })
  const payload = await api.buildAgnesImagePayload({
    model: 'agnes/image-2.5-flash-image-to-image',
    backendModelId: 'agnes-image-2.5-flash',
    requestBody: {
      agnesImage: {
        model: 'agnes-image-2.5-flash',
        input: {
          prompt: 'Keep the data URL',
          size: '1K',
          ratio: '1:1',
          input_urls: ['data:image/png;base64,AQID'],
        },
      },
    },
    input: {},
    providerMetadata: {},
  })
  assert.deepEqual(downloads, [])
  assert.deepEqual(json(payload.extra_body.image), ['data:image/png;base64,AQID'])
})
