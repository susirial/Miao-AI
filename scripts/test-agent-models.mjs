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

function load(file, mocks) {
  const code = ts.transpileModule(readFileSync(resolve(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const module = { exports: {} }
  vm.runInNewContext(code, { module, exports: module.exports, require: id => id in mocks ? mocks[id] : require(id) })
  return module.exports
}

const models = [
  {
    id: 'seedream/5-pro-text-to-image',
    name: 'Seedream 5.0 Pro',
    category: 'Image',
    task: 'Text to Image',
    schema: { components: { schemas: { Input: { properties: { prompt: { type: 'string' }, resolution: { type: 'string', enum: ['1K', '2K'], default: '2K' } }, required: ['prompt'] } } } },
  },
  {
    id: 'bytedance/seedance-2-text-to-video',
    name: 'Seedance 2.0',
    category: 'Video',
    task: 'Text to Video',
    schema: { components: { schemas: { Input: { properties: { prompt: { type: 'string' }, duration: { type: 'integer', minimum: 4, maximum: 15, default: 5 } }, required: ['prompt'] } } } },
  },
]

const api = load('shared/utils/agentModels.ts', {
  '../constants/aiModels': {
    AI_MODELS: models,
    MODEL_COMPANIES: { 'Seedream 5.0 Pro': 'ByteDance', 'Seedance 2.0': 'ByteDance' },
    COMPANY_LOGOS: { ByteDance: '/brand/companies/bytedance.svg' },
    canonicalizeAgnesImageModelId: id => String(id || '').replace('image-2.0-flash', 'image-2.5-flash'),
  },
})

test('Agent model registry contains only the supplied Ark logical models', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(api.AGENT_MODELS.map(model => model.id))), models.map(model => model.id))
  assert.equal(new Set(api.registeredModelTools.map(tool => tool.function.name)).size, models.length)
  assert.ok(api.registeredModelTools.every(tool => tool.function.name.startsWith('model_')))
})

test('model mentions resolve and schema defaults validate', () => {
  const mention = `@[Seedream](model:${models[0].id})`
  assert.deepEqual(JSON.parse(JSON.stringify(api.readModelMentions(mention))), [models[0].id])
  const value = api.validateAgentModelInput(models[0], { prompt: 'acid-lime poster' })
  assert.equal(value.prompt, 'acid-lime poster')
  assert.equal(value.resolution, '2K')
  assert.throws(() => api.validateAgentModelInput(models[0], { resolution: '4K' }), /Missing required parameter: prompt/)
})

test('model list metadata is stable for the composer', () => {
  assert.equal(api.agentModelLogo(models[0]), '/brand/companies/bytedance.svg')
  assert.equal(api.modelMention(models[1]), '@[Seedance 2.0 · Text to Video](model:bytedance/seedance-2-text-to-video)')
})
