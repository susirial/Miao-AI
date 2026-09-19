import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { sanitizeAgnesProbeValue } from './utils/agnesProbeSanitization.mjs'

test('sanitizes dynamic Agnes values without replacing response objects', () => {
  const sanitized = sanitizeAgnesProbeValue({
    created: {
      status: 503,
      payload: {
        error: {
          message: 'temporarily unavailable (request id: dynamic-123)',
        },
      },
    },
    created_at: 1786900000,
    video_id: 'video-secret',
  }, 'api-key')

  assert.deepEqual(sanitized, {
    created: {
      status: 503,
      payload: {
        error: {
          message: 'temporarily unavailable (request id: [ID])',
        },
      },
    },
    created_at: '[TIMESTAMP]',
    video_id: '[ID]',
  })
})

test('image size observations record requested, actual, and ratio error', () => {
  const rows = JSON.parse(readFileSync(new URL('./fixtures/agnes-image-20-flash/size-observations.json', import.meta.url), 'utf8'))
  const square = rows.find(item => item.requestedSize === '1024x1024')
  const landscape = rows.find(item => item.requestedSize === '1024x768')
  assert.equal(square.actualSize, '1024x1024')
  assert.equal(square.ratioError, 0)
  assert.equal(landscape.actualSize, '1152x864')
  assert.equal(landscape.ratioError, 0)
  assert.equal(landscape.product, true)
  const report = readFileSync(new URL('./fixtures/agnes-image-20-flash/probe-report.md', import.meta.url), 'utf8')
  assert.match(report, /requestedSize/)
  assert.match(report, /actualSize/)
  assert.match(report, /ratioError/)
})

test('Image 2.5 fixtures freeze extra_body.image and official size+ratio catalog', () => {
  const rows = JSON.parse(readFileSync(new URL('./fixtures/agnes-image-25-flash/size-observations.json', import.meta.url), 'utf8'))
  const report = readFileSync(new URL('./fixtures/agnes-image-25-flash/probe-report.md', import.meta.url), 'utf8')
  const compat = JSON.parse(readFileSync(new URL('./fixtures/agnes-image-25-flash/compat-probes.json', import.meta.url), 'utf8'))
  const product = rows.filter(item => item.product)
  assert.equal(compat.imageLocation, 'extra_body.image')
  assert.match(report, /extra_body\.image/)
  assert.match(report, /Product sizes: `1K`, `2K`, `3K`, `4K`/)
  assert.match(report, /Product ratios: `1:1`, `3:4`, `4:3`, `16:9`, `9:16`, `2:3`, `3:2`, `21:9`/)
  assert.equal(rows.filter(item => item.size === '1K' || item.size === '2K').every(item => item.product && item.status === 200), true)
  assert.ok(product.some(item => item.size === '3K' && item.ratio === '1:1'))
  assert.ok(product.some(item => item.size === '4K' && item.ratio === '1:1'))
  assert.doesNotMatch(report, /cpk-|sk-|Bearer /)
  assert.doesNotMatch(JSON.stringify(rows), /data:image|https?:\/\/[^"]*sign/)
})

test('video probe report stays a documentation contract without a completed fixture', () => {
  const report = readFileSync(new URL('./fixtures/agnes-video-25-flash/probe-report.md', import.meta.url), 'utf8')
  assert.match(report, /## Documentation Contract/)
  assert.match(report, /not.*frozen live protocol/i)
  assert.doesNotMatch(report, /## Frozen Decisions/)
  const videoFiles = readdirSync(new URL('./fixtures/agnes-video-25-flash', import.meta.url))
  assert.equal(videoFiles.some(name => /completed/i.test(name)), false)
})
