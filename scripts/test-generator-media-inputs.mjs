import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createDefaultValues,
  getInputSchema,
  isFormValid,
  parseFieldConfigs,
} from '../app/lib/aiModelSchema.ts'
import { AI_MODELS } from '../shared/constants/aiModels.ts'

function fieldsFor(modelId) {
  const model = AI_MODELS.find(entry => entry.id === modelId)
  assert.ok(model, `Missing model ${modelId}`)
  return parseFieldConfigs(getInputSchema(model.schema))
}

test('Agnes text-to-image exposes official size tiers and ratios', () => {
  const fields = fieldsFor('agnes/image-2.5-flash-text-to-image')
  const size = fields.find(field => field.key === 'size')
  const ratio = fields.find(field => field.key === 'ratio')
  assert.deepEqual(JSON.parse(JSON.stringify(size?.property.enum)), ['1K', '2K', '3K', '4K'])
  assert.equal(size?.property.default, '1K')
  assert.deepEqual(JSON.parse(JSON.stringify(ratio?.property.enum)), ['1:1', '3:4', '4:3', '16:9', '9:16', '2:3', '3:2', '21:9'])
  assert.equal(ratio?.property.default, '1:1')
  assert.equal(fields.some(field => field.key === 'aspect_ratio' || /\d+x\d+/.test(String(field.property.enum || ''))), false)
})

test('Agnes image-to-video uses public URL fields instead of local uploads', () => {
  const fields = fieldsFor('agnes/video-2.5-flash-image-to-video')
  const firstFrame = fields.find(field => field.key === 'image_url')
  const lastFrame = fields.find(field => field.key === 'end_image_url')

  assert.equal(firstFrame?.widget, 'url-list')
  assert.equal(firstFrame?.required, true)
  assert.equal(firstFrame?.property.maxItems, 1)
  assert.equal(lastFrame?.widget, 'url-list')
})

test('Agnes reference-to-video uses bounded public URL lists', () => {
  const fields = fieldsFor('agnes/video-2.5-flash-reference-to-video')
  const images = fields.find(field => field.key === 'image_urls')
  const audio = fields.find(field => field.key === 'audio_urls')

  assert.equal(images?.widget, 'url-list')
  assert.equal(images?.property.maxItems, 5)
  assert.equal(audio?.widget, 'url-list')
  assert.equal(audio?.property.maxItems, 3)
})

test('URL list defaults and required validation use array values', () => {
  const fields = fieldsFor('agnes/video-2.5-flash-image-to-video')
  const defaults = createDefaultValues(fields)

  assert.deepEqual(defaults.image_url, [])
  assert.equal(isFormValid(fields, { ...defaults, prompt: 'A sunrise' }), false)
  assert.equal(isFormValid(fields, { ...defaults, prompt: 'A sunrise', image_url: [''] }), false)
  assert.equal(isFormValid(fields, {
    ...defaults,
    prompt: 'A sunrise',
    image_url: ['https://cdn.example/frame.png'],
  }), true)
})
