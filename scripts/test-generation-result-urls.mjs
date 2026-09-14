import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  excludeInputResultUrls,
  generationResultUrls,
  mergeSourceUrls,
  toPublicJob,
} from '../server/utils/generationResults.ts'

const white = '/media/generator/results/agent_call_white/0.jpg'
const olive = '/media/generator/results/agent_call_olive/0.jpg'
const battle = '/media/generator/results/agent_call_battle/2.jpg'

function job(overrides = {}) {
  const now = new Date('2026-09-13T15:12:49.022Z')
  return {
    taskId: 'agent_call_battle',
    projectId: 'project-1',
    model: 'seedream/5-pro-reference-to-image',
    category: 'Image',
    task: 'Reference to Image',
    input: {
      prompt: '两台机甲在废墟都市黄昏决战',
      input_urls: [white, olive],
    },
    state: 'success',
    resultUrls: [white, olive, battle],
    resultAssets: [],
    sourceUrls: [white, olive, battle],
    failCode: '',
    failMsg: '',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

test('public result URLs drop the two reference stills and keep the generated image', () => {
  const publicJob = toPublicJob(job())
  assert.deepEqual(publicJob.resultUrls, [battle])
  assert.deepEqual(generationResultUrls(job()), [battle])
})

test('a shadow persist job whose only result is a reference publishes no cards', () => {
  assert.deepEqual(generationResultUrls(job({
    taskId: 'agent_call_battle_1',
    resultUrls: [olive],
    sourceUrls: [white, olive],
  })), [])
})

test('text-to-image results are unchanged when there are no input references', () => {
  assert.deepEqual(generationResultUrls(job({
    input: { prompt: 'olive mecha sheet' },
    resultUrls: [olive],
    sourceUrls: [olive],
  })), [olive])
})

test('mergeSourceUrls archives only provider results, not local references', () => {
  const current = job({
    sourceUrls: [white, olive],
    resultAssets: [],
    resultUrls: [],
  })
  mergeSourceUrls(current, [white, olive, 'https://cdn.example/battle.jpg'])
  assert.deepEqual(current.sourceUrls, ['https://cdn.example/battle.jpg'])
  assert.equal(current.resultAssets.length, 1)
  assert.equal(current.resultAssets[0].sourceUrl, 'https://cdn.example/battle.jpg')
})

test('session recovery sees one output URL so it does not create _1/_2 echo images', () => {
  const resultUrls = generationResultUrls(job())
  const sessionIds = resultUrls.map((url, index) => ({
    id: index ? `call_battle_${index}` : 'call_battle',
    url,
  }))
  assert.deepEqual(sessionIds, [{ id: 'call_battle', url: battle }])
})

test('excludeInputResultUrls also honors extra source/input URL lists used by persist', () => {
  assert.deepEqual(
    excludeInputResultUrls([olive], undefined, [white, olive]),
    [],
  )
  assert.deepEqual(
    excludeInputResultUrls([battle], undefined, [white, olive]),
    [battle],
  )
})
