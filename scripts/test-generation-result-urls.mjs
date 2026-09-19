import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  excludeInputResultUrls,
  generationResultUrls,
  mergeSourceUrls,
  publicHttpImageUrl,
  publicHttpsImageUrl,
  publicOriginUrlFromJob,
  publicOriginUrlsFromJobs,
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

test('archived generation results expose a public origin URL for remote-url vision', () => {
  const archived = job({
    resultUrls: [battle],
    sourceUrls: ['https://cdn.example/battle.jpg'],
    resultAssets: [{
      sourceUrl: 'https://cdn.example/battle.jpg',
      localUrl: battle,
      localKey: 'generator/results/agent_call_battle/2.jpg',
      contentType: 'image/jpeg',
      status: 'uploaded',
      error: '',
    }],
  })
  assert.equal(publicOriginUrlFromJob(archived, battle), 'https://cdn.example/battle.jpg')
  assert.equal(publicOriginUrlFromJob(archived, `http://localhost:3001${battle}`), 'https://cdn.example/battle.jpg')
  assert.deepEqual(generationResultUrls(archived), [battle])
})

test('uploads, missing assets, loopback origins, and videos have no public origin', () => {
  const upload = '/media/uploads/still.png'
  assert.equal(publicOriginUrlFromJob(job({
    resultUrls: [upload],
    resultAssets: [{
      sourceUrl: upload,
      localUrl: upload,
      localKey: 'uploads/still.png',
      contentType: 'image/png',
      status: 'uploaded',
      error: '',
    }],
  }), upload), '')
  assert.equal(publicOriginUrlFromJob(job({
    resultUrls: [battle],
    resultAssets: [],
  }), battle), '')
  assert.equal(publicOriginUrlFromJob(job({
    resultUrls: [battle],
    resultAssets: [{
      sourceUrl: 'http://127.0.0.1/out.png',
      localUrl: battle,
      localKey: 'generator/results/agent_call_battle/2.jpg',
      contentType: 'image/jpeg',
      status: 'uploaded',
      error: '',
    }],
  }), battle), '')
  assert.equal(publicOriginUrlFromJob(job({
    category: 'Video',
    resultUrls: [battle],
    resultAssets: [{
      sourceUrl: 'https://cdn.example/out.mp4',
      localUrl: battle,
      localKey: 'generator/results/agent_call_battle/2.jpg',
      contentType: 'video/mp4',
      status: 'uploaded',
      error: '',
    }],
  }), battle), '')
  assert.equal(publicOriginUrlFromJob(job({
    deleted: true,
    resultUrls: [battle],
    resultAssets: [{
      sourceUrl: 'https://cdn.example/battle.jpg',
      localUrl: battle,
      localKey: 'generator/results/agent_call_battle/2.jpg',
      contentType: 'image/jpeg',
      status: 'uploaded',
      error: '',
    }],
  }), battle), '')
  assert.equal(publicHttpImageUrl('https://user:pass@cdn.example/image.png'), '')
  assert.equal(publicHttpsImageUrl('https://cdn.example/image.png'), 'https://cdn.example/image.png')
  assert.equal(publicHttpsImageUrl('http://cdn.example/image.png'), '')
  assert.equal(publicHttpsImageUrl('/media/generator/results/job/0.png'), '')
})

test('publicOriginUrlsFromJobs batch-maps locals including localhost aliases', () => {
  const archived = job({
    resultUrls: [battle],
    sourceUrls: ['https://cdn.example/battle.jpg'],
    resultAssets: [{
      sourceUrl: 'https://cdn.example/battle.jpg',
      localUrl: battle,
      localKey: 'generator/results/agent_call_battle/2.jpg',
      contentType: 'image/jpeg',
      status: 'uploaded',
      error: '',
    }],
  })
  const mapped = publicOriginUrlsFromJobs([archived], [
    battle,
    `http://localhost:3001${battle}`,
    '/media/uploads/still.png',
  ])
  assert.equal(mapped.get(battle), 'https://cdn.example/battle.jpg')
  assert.equal(mapped.get(`http://localhost:3001${battle}`), 'https://cdn.example/battle.jpg')
  assert.equal(mapped.has('/media/uploads/still.png'), false)
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
