import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildOptimisticGenerationImages } from '../app/utils/agentOptimisticGeneration.ts'

function job(id, task) {
  return {
    id,
    task,
    name: `${task} result`,
    inputUrls: ['https://example.test/reference.png'],
    params: {
      prompt: 'A quiet product frame',
      aspectRatio: '16:9',
      resolution: '2K',
      duration: 5,
      modelId: 'model/example',
    },
  }
}

test('optimistic media keeps stable job ids and skips existing SSE items', () => {
  const staged = buildOptimisticGenerationImages({
    kind: 'mixed',
    jobs: [
      job('already-present', 'image-to-image'),
      job('image-job', 'image-to-image'),
      job('video-job', 'reference-to-video'),
    ],
  }, ['already-present'])

  assert.deepEqual(staged.map(item => item.id), ['image-job', 'video-job'])
  assert.equal(staged[0].kind, 'still')
  assert.equal(staged[1].kind, 'video')
  assert.equal(staged[0].status, 'generating')
  assert.equal(staged[0].optimistic, true)
  assert.equal(staged[0].sourceUrl, 'https://example.test/reference.png')
})
