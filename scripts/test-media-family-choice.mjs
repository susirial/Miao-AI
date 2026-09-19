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

const api = load('server/agent/mediaFamilyChoice.ts', {
  '~~/shared/constants/modelCatalog': {
    DEFAULT_IMAGE_FAMILY: 'ark-image',
    DEFAULT_VIDEO_FAMILY: 'ark-video',
    isImageFamilyId: value => value === 'ark-image' || value === 'agnes-image',
    isVideoFamilyId: value => value === 'ark-video' || value === 'agnes-video',
    getMediaFamily: (id) => {
      const names = {
        'ark-image': { id, name: 'Seedream 5.0 Pro', provider: 'ark' },
        'agnes-image': { id, name: 'Agnes Image 2.5 Flash', provider: 'agnes' },
        'ark-video': { id, name: 'Seedance 2.0', provider: 'ark' },
        'agnes-video': { id, name: 'Agnes Video 2.5 Flash', provider: 'agnes' },
      }
      return names[id]
    },
  },
  '~~/shared/utils/agentChoices': {
    withCustomChoiceOption: options => options.some(option => option.custom)
      ? options
      : [...options, { id: 'other', label: 'Other', description: 'Type @model or a custom combination.', custom: true }],
  },
  '~~/shared/utils/agentLocale': {
    normalizeAgentLocale: locale => locale === 'en' ? 'en' : 'zh',
  },
})

function answer(questionId, optionId, text = '') {
  return {
    payload: {
      id: 'choice-1',
      prompt: '',
      questions: [{
        id: questionId,
        prompt: 'pick',
        recommendedId: questionId === 'model_preference' ? 'ark-economy' : 'ark-image',
        options: [
          { id: 'ark-image', label: 'Seedream' },
          { id: 'agnes-image', label: 'Agnes' },
          { id: 'ark-video', label: 'Seedance' },
          { id: 'agnes-video', label: 'Agnes Video' },
          { id: 'ark-economy', label: 'Economy' },
          { id: 'ark-high', label: 'High' },
          { id: 'agnes', label: 'Agnes stack' },
          { id: 'other', label: 'Other', custom: true },
        ],
      }],
    },
    body: {
      choiceId: 'choice-1',
      action: 'answer',
      answers: [{ questionId, optionId, text }],
    },
  }
}

test('dual ready providers require a card; a single ready provider or @model does not', () => {
  assert.equal(api.shouldAskMediaFamily(undefined, true, true), true)
  assert.equal(api.shouldAskMediaFamily('ark-image', true, true), false)
  assert.equal(api.shouldAskMediaFamily(undefined, true, false), false)
  assert.equal(api.shouldAskMediaFamily(undefined, false, true), false)
  assert.equal(api.shouldAskMediaFamily('agnes-image', true, false), false)

  const dual = api.mediaFamilyAskForGeneration({
    kinds: ['image'],
    arkOk: true,
    agnesOk: true,
    lastUsedImage: 'agnes-image',
    locale: 'zh',
  })
  assert.ok(dual)
  assert.equal(dual.questions[0].id, 'image_model')
  assert.deepEqual(JSON.parse(JSON.stringify(dual.questions[0].options.filter(option => !option.custom).map(option => option.id))), ['ark-image', 'agnes-image'])
  assert.equal(dual.questions[0].recommendedId, 'agnes-image')

  assert.equal(api.mediaFamilyAskForGeneration({
    kinds: ['image'],
    arkOk: true,
    agnesOk: false,
  }), null)
  assert.equal(api.mediaFamilyAskForGeneration({
    kinds: ['image'],
    imageFamily: 'ark-image',
    arkOk: true,
    agnesOk: true,
  }), null)
  assert.equal(api.mediaFamilyAskForGeneration({
    kinds: ['model'],
    arkOk: true,
    agnesOk: true,
  }), null)
})

test('same-thread family and video questions are independent', () => {
  const both = api.mediaFamilyAskForGeneration({
    kinds: ['image', 'video'],
    arkOk: true,
    agnesOk: true,
    lastUsedImage: 'ark-image',
    lastUsedVideo: 'ark-video',
  })
  assert.deepEqual(JSON.parse(JSON.stringify(both.questions.map(question => question.id))), ['image_model', 'video_model'])

  const onlyVideo = api.mediaFamilyAskForGeneration({
    kinds: ['image', 'video'],
    imageFamily: 'ark-image',
    arkOk: true,
    agnesOk: true,
  })
  assert.deepEqual(JSON.parse(JSON.stringify(onlyVideo.questions.map(question => question.id))), ['video_model'])
})

test('choice answers write session families; empty Other does not authorize', () => {
  const picked = api.mediaFamilyFromChoice(...Object.values(answer('image_model', 'agnes-image')))
  assert.equal(picked.imageFamily, 'agnes-image')
  assert.equal(picked.videoFamily, undefined)

  const skipped = api.mediaFamilyFromChoice(answer('image_model', 'agnes-image').payload, {
    choiceId: 'choice-1',
    action: 'skip',
    answers: [],
  })
  assert.equal(skipped.imageFamily, 'ark-image')

  const emptyOther = api.mediaFamilyFromChoice(...Object.values(answer('image_model', 'other')))
  assert.equal(emptyOther.imageFamily, undefined)
})

test('long-form runtime options include Agnes only when both media providers are ready', () => {
  const ready = api.buildLongformModelPreference({ arkOk: true, agnesOk: true, locale: 'zh' })
  assert.deepEqual(JSON.parse(JSON.stringify(ready.options.filter(option => !option.custom).map(option => option.id))), [
    'ark-economy',
    'ark-high',
    'ark-hobby',
    'agnes',
  ])
  assert.equal(ready.recommendedId, 'ark-economy')
  assert.match(ready.options.find(option => option.id === 'agnes').label, /Image 2\.5/)

  const arkOnly = api.buildLongformModelPreference({ arkOk: true, agnesOk: false })
  assert.equal(arkOnly.options.some(option => option.id === 'agnes'), false)

  const agnesPick = api.mediaFamilyFromChoice(...Object.values(answer('model_preference', 'agnes')))
  assert.equal(agnesPick.imageFamily, 'agnes-image')
  assert.equal(agnesPick.videoFamily, 'agnes-video')
  assert.equal(agnesPick.quality, 'hobby')

  const high = api.mediaFamilyFromChoice(...Object.values(answer('model_preference', 'ark-high')))
  assert.equal(high.imageFamily, 'ark-image')
  assert.equal(high.videoFamily, 'ark-video')
  assert.equal(high.quality, 'high')
})

test('hydrateAskUser replaces leftover Seedance-only model_preference options', () => {
  const hydrated = api.hydrateAskUserArgs({
    prompt: 'Choose a stack',
    questions: [{
      id: 'model_preference',
      prompt: 'legacy',
      recommendedId: 'economy',
      options: [
        { id: 'high', label: 'High' },
        { id: 'economy', label: 'Economy' },
        { id: 'hobby', label: 'Hobby' },
      ],
    }],
  }, { arkOk: true, agnesOk: true, locale: 'en' })
  assert.ok(hydrated.questions[0].options.some(option => option.id === 'agnes'))
  assert.ok(hydrated.questions[0].options.some(option => option.id === 'ark-economy'))
  assert.equal(hydrated.questions[0].options.some(option => option.id === 'economy'), false)
})
