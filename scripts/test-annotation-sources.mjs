import assert from 'node:assert/strict'
import { test } from 'node:test'
import { annotationSourcesForChoice } from '../shared/utils/annotationSources.ts'

const media = new Map()
const mediaFor = message => media.get(message.id) || []

test('current request preserves attachment order', () => {
  const messages = [
    { id: 'request', role: 'user', imageIds: ['a', 'b'] },
    { id: 'choice', role: 'assistant' },
  ]
  media.set('request', [
    { id: 'a', url: 'https://example.com/a.png', kind: 'still' },
    { id: 'b', url: 'https://example.com/b.png', kind: 'still' },
  ])
  assert.deepEqual(annotationSourcesForChoice(messages, 'choice', mediaFor).map(item => item.id), ['a', 'b'])
})

test('missing explicit attachment never falls back to an older or project image', () => {
  const messages = [
    { id: 'old', role: 'assistant' },
    { id: 'request-missing', role: 'user', imageIds: ['deleted'] },
    { id: 'choice-missing', role: 'assistant' },
  ]
  media.set('old', [{ id: 'old-image', url: 'https://example.com/old.png', kind: 'still' }])
  media.set('project-gallery', [{ id: 'gallery', url: 'https://example.com/gallery.png', kind: 'still' }])
  assert.deepEqual(annotationSourcesForChoice(messages, 'choice-missing', mediaFor), [])
})

test('attachment-free follow-up uses only the nearest image-bearing message', () => {
  const messages = [
    { id: 'older', role: 'user' },
    { id: 'recent', role: 'assistant' },
    { id: 'follow-up', role: 'user' },
    { id: 'choice-follow-up', role: 'assistant' },
  ]
  media.set('older', [{ id: 'older-image', url: 'https://example.com/older.png', kind: 'still' }])
  media.set('recent', [{ id: 'recent-image', url: 'https://example.com/recent.png', kind: 'still' }])
  assert.deepEqual(annotationSourcesForChoice(messages, 'choice-follow-up', mediaFor).map(item => item.id), ['recent-image'])
})
