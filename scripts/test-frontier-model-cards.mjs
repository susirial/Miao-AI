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
        if (id.startsWith('.') || id.startsWith('~~/') || id.startsWith('@/')) {
          const target = id.startsWith('~~/')
            ? resolve(root, id.slice(3))
            : id.startsWith('@/')
              ? resolve(root, 'app', id.slice(2))
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

const cards = load('shared/constants/aiModels.ts').getFrontierModelCards()
const routes = load('shared/utils/generatorRoutes.ts')
const indexSource = readFileSync(new URL('../app/pages/index.vue', import.meta.url), 'utf8')
const frontierSource = readFileSync(new URL('../app/components/home/FrontierModels.vue', import.meta.url), 'utf8')
const dialogSource = readFileSync(new URL('../app/components/ServiceConnectionDialog.vue', import.meta.url), 'utf8')

test('homepage shows the full frontier catalog including Agnes and Ark', () => {
  const agnes = cards.filter(card => card.modelId.startsWith('agnes/'))
  const ark = cards.filter(card => card.modelId.startsWith('seedream/') || card.modelId.startsWith('bytedance/'))
  assert.ok(agnes.length >= 6)
  assert.ok(ark.length >= 6)
  assert.ok(agnes.every(card => card.logo === '/brand/companies/agnes.svg'))
  assert.match(indexSource, /getFrontierModelCards\(\)/)
  assert.equal(indexSource.includes('slice(0, 6)'), false)
})

test('homepage and frontier cards are accessible controls that open the matching Generator model', () => {
  assert.match(indexSource, /<NuxtLink/)
  assert.match(indexSource, /applyGeneratorSelection\(model\.modelId\)/)
  assert.match(indexSource, /aria-label="`Open \$\{model\.title\} in Generator`"/)
  assert.match(frontierSource, /<button/)
  assert.match(frontierSource, /openFrontierGenerator\(card\.modelId\)/)
  assert.match(frontierSource, /aria-label="`Open \$\{card\.title\} in Generator`"/)

  const agnesImage = cards.find(card => card.modelId === 'agnes/image-2.5-flash-text-to-image')
  const seedream = cards.find(card => card.modelId === 'seedream/5-pro-text-to-image')
  assert.ok(agnesImage)
  assert.equal(agnesImage.name, 'Agnes Image 2.5 Flash')
  assert.ok(seedream)
  assert.deepEqual(JSON.parse(JSON.stringify(routes.generatorLocationForModel({ id: agnesImage.modelId, task: agnesImage.task }))), {
    path: '/tools/text-to-image',
    query: { model: 'agnes/image-2.5-flash-text-to-image' },
  })
  assert.deepEqual(JSON.parse(JSON.stringify(routes.generatorLocationForModel({ id: seedream.modelId, task: seedream.task }))), {
    path: '/tools/text-to-image',
    query: { model: 'seedream/5-pro-text-to-image' },
  })
})

test('service connection keeps the text model picker and leaves image/video families as last-used', () => {
  assert.match(dialogSource, /v-model="selectedTextModel"/)
  assert.doesNotMatch(dialogSource, /v-model="selectedImageFamily"/)
  assert.doesNotMatch(dialogSource, /v-model="selectedVideoFamily"/)
  assert.doesNotMatch(dialogSource, /selectedFamilyUnverified/)
})
