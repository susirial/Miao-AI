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

const catalog = [
  { id: 'seedream/5-pro-text-to-image', name: 'Seedream 5.0 Pro', category: 'Image', task: 'Text to Image' },
  { id: 'agnes/image-2.5-flash-text-to-image', name: 'Agnes Image 2.5 Flash', category: 'Image', task: 'Text to Image' },
  { id: 'seedream/5-pro-image-to-image', name: 'Seedream 5.0 Pro', category: 'Image', task: 'Image to Image' },
  { id: 'agnes/image-2.5-flash-image-to-image', name: 'Agnes Image 2.5 Flash', category: 'Image', task: 'Image to Image' },
  { id: 'bytedance/seedance-2-text-to-video', name: 'Seedance 2.0', category: 'Video', task: 'Text to Video' },
  { id: 'agnes/video-2.5-flash-text-to-video', name: 'Agnes Video 2.5 Flash', category: 'Video', task: 'Text to Video' },
]

const api = load('shared/utils/generatorModelSelection.ts')

function modelsFor(task) {
  return catalog.filter(model => model.task === task)
}

test('first Generator load uses the preferred media family', () => {
  assert.equal(api.resolveGeneratorModelId({
    models: modelsFor('Text to Image'),
    catalog,
    imageFamily: 'agnes-image',
    videoFamily: 'ark-video',
  }), 'agnes/image-2.5-flash-text-to-image')
  assert.equal(api.resolveGeneratorModelId({
    models: modelsFor('Text to Video'),
    catalog,
    imageFamily: 'agnes-image',
    videoFamily: 'ark-video',
  }), 'bytedance/seedance-2-text-to-video')
})

test('explicit model selection is not overwritten by family preference', () => {
  assert.equal(api.resolveGeneratorModelId({
    models: modelsFor('Text to Image'),
    catalog,
    explicitModelId: 'seedream/5-pro-text-to-image',
    imageFamily: 'agnes-image',
    videoFamily: 'agnes-video',
  }), 'seedream/5-pro-text-to-image')
})

test('async preference load cannot replace a just-made explicit choice', () => {
  const explicit = 'seedream/5-pro-text-to-image'
  const afterStatus = api.resolveGeneratorModelId({
    models: modelsFor('Text to Image'),
    catalog,
    explicitModelId: explicit,
    imageFamily: 'agnes-image',
    videoFamily: 'agnes-video',
  })
  assert.equal(afterStatus, explicit)
})

test('unread last-used family falls back to the first ready provider', () => {
  assert.equal(api.resolveGeneratorModelId({
    models: modelsFor('Text to Image'),
    catalog,
    imageFamily: 'agnes-image',
    videoFamily: 'agnes-video',
    readyProviders: { ark: true, agnes: false },
  }), 'seedream/5-pro-text-to-image')
})

test('switching task keeps the same-family model after an explicit pick', () => {
  assert.equal(api.resolveGeneratorModelId({
    models: modelsFor('Image to Image'),
    catalog,
    explicitModelId: 'agnes/image-2.0-flash-text-to-image',
    imageFamily: 'ark-image',
    videoFamily: 'ark-video',
  }), 'agnes/image-2.5-flash-image-to-image')
})
