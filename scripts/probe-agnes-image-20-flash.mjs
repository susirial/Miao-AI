import { Buffer } from 'node:buffer'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { readServiceSettings } from '../server/utils/serviceSettings.ts'
import { closeDatabase } from '../server/utils/sqlite.ts'
import { sanitizeAgnesProbeValue } from './utils/agnesProbeSanitization.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const outputDir = resolve(root, 'scripts/fixtures/agnes-image-20-flash')
const endpoint = 'https://apihub.agnes-ai.com/v1/images/generations'
const model = 'agnes-image-2.0-flash'
const timeoutMs = 6 * 60 * 1000
const { agnesKey } = readServiceSettings()

if (!agnesKey)
  throw new Error('Configure an Agnes API key in Service Connection before probing.')

function sanitize(value) {
  return sanitizeAgnesProbeValue(value, agnesKey)
}

function parseSize(value) {
  const match = /^(\d+)x(\d+)$/.exec(value || '')
  return match ? { width: Number(match[1]), height: Number(match[2]) } : null
}

function sizeRatioError(requestedSize, actualSize) {
  const requested = parseSize(requestedSize)
  const actual = parseSize(actualSize)
  if (!requested || !actual)
    return null
  return Math.abs((actual.width / actual.height) - (requested.width / requested.height)) / (requested.width / requested.height)
}

async function request(body) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${agnesKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      })
      const text = await response.text()
      let payload
      try {
        payload = text ? JSON.parse(text) : {}
      }
      catch {
        payload = { raw: text }
      }
      return { status: response.status, payload }
    }
    catch (error) {
      if (attempt === 2) {
        return {
          status: 0,
          payload: { network_error: error instanceof Error ? error.message : String(error) },
        }
      }
    }
  }
  throw new Error('Unreachable image probe request state.')
}

function firstImage(payload) {
  const item = Array.isArray(payload?.data) ? payload.data[0] : null
  return item && typeof item === 'object' ? item : null
}

async function imageBytes(item) {
  if (typeof item?.b64_json === 'string' && item.b64_json)
    return Buffer.from(item.b64_json, 'base64')
  if (typeof item?.url !== 'string' || !/^https:\/\//i.test(item.url))
    throw new Error('Image response did not contain a usable URL or b64_json.')
  const response = await fetch(item.url, { signal: AbortSignal.timeout(60_000) })
  if (!response.ok)
    throw new Error(`Generated image download failed (${response.status}).`)
  return Buffer.from(await response.arrayBuffer())
}

async function dimensions(payload) {
  const bytes = await imageBytes(firstImage(payload))
  const metadata = await sharp(bytes).metadata()
  if (!metadata.width || !metadata.height)
    throw new Error('Generated image dimensions could not be read.')
  return { width: metadata.width, height: metadata.height }
}

function validationHit(result) {
  if (result.status < 400 || result.status >= 500)
    return false
  const text = JSON.stringify(result.payload).toLowerCase()
  return /image|base64|data uri|invalid/.test(text)
}

await mkdir(outputDir, { recursive: true })

const base = {
  model,
  prompt: 'A matte orange cube centered on a neutral gray studio background.',
  size: '1024x1024',
  extra_body: { response_format: 'url' },
}
const t2i = await request(base)
const invalidDataUri = 'data:image/png;base64,NOT_VALID'
const extraBodyInvalid = await request({
  ...base,
  prompt: 'Preserve the source composition and turn the object blue.',
  extra_body: { image: [invalidDataUri], response_format: 'url' },
})
const topLevelInvalid = await request({
  ...base,
  prompt: 'Preserve the source composition and turn the object blue.',
  image: [invalidDataUri],
})

const source = await sharp({
  create: {
    width: 256,
    height: 256,
    channels: 3,
    background: { r: 237, g: 64, b: 54 },
  },
}).png().toBuffer()
const sourceDataUri = `data:image/png;base64,${source.toString('base64')}`
const imageLocation = validationHit(extraBodyInvalid)
  ? 'extra_body.image'
  : validationHit(topLevelInvalid)
    ? 'image'
    : 'unconfirmed'

let legalDataUri = null
if (imageLocation !== 'unconfirmed') {
  legalDataUri = await request(imageLocation === 'extra_body.image'
    ? {
        ...base,
        prompt: 'Keep the square composition and change the red field to deep blue.',
        extra_body: { image: [sourceDataUri], response_format: 'url' },
      }
    : {
        ...base,
        prompt: 'Keep the square composition and change the red field to deep blue.',
        image: [sourceDataUri],
      })
}

const requestedSizes = [
  '1024x1024',
  '1024x768',
  '768x1024',
  '1344x768',
  '768x1344',
  '1536x672',
  '1536x1024',
  '2048x2048',
]
const sizeResults = []
const fixtureDocuments = {}
for (const requestedSize of requestedSizes) {
  const result = requestedSize === '1024x1024'
    ? t2i
    : await request({ ...base, size: requestedSize })
  let actualSize = null
  let dimensionError = ''
  if (result.status >= 200 && result.status < 300) {
    try {
      const actual = await dimensions(result.payload)
      actualSize = `${actual.width}x${actual.height}`
    }
    catch (error) {
      dimensionError = error instanceof Error ? error.message : String(error)
    }
  }
  const ratioError = requestedSize && actualSize
    ? sizeRatioError(requestedSize, actualSize)
    : null
  sizeResults.push({
    requestedSize,
    status: result.status,
    actualSize,
    ratioError,
    supported: actualSize === requestedSize,
    dimensionError,
  })
  fixtureDocuments[`size-${requestedSize}.json`] = sanitize({
    request: { size: requestedSize },
    requestedSize,
    response: result,
    actualSize,
    ratioError,
    supported: actualSize === requestedSize,
  })
}

fixtureDocuments['size-observations.json'] = sizeResults.map(item => ({
  requestedSize: item.requestedSize,
  actualSize: item.actualSize,
  ratioError: item.ratioError,
  product: item.ratioError != null && item.ratioError <= 0.01,
}))

fixtureDocuments['image-field-probes.json'] = sanitize({
  extraBodyInvalid,
  topLevelInvalid,
  legalDataUri,
})

const report = `# Agnes Image 2.0 Flash Protocol Probe

- Model: \`${model}\`
- Endpoint: \`${endpoint}\`
- Key source: local SQLite service settings (value never logged)

## Image Field

| Probe | HTTP | Input validation observed |
| --- | ---: | --- |
| \`extra_body.image\` with invalid Data URI | ${extraBodyInvalid.status} | ${validationHit(extraBodyInvalid)} |
| top-level \`image\` with invalid Data URI | ${topLevelInvalid.status} | ${validationHit(topLevelInvalid)} |
| legal Data URI at selected location | ${legalDataUri?.status ?? 'not run'} | ${legalDataUri ? legalDataUri.status >= 200 && legalDataUri.status < 300 : false} |

Frozen location: **${imageLocation}**

The location is frozen only when the invalid Data URI triggered a client-visible input validation response. HTTP success alone is not treated as proof.

## Sizes

| requestedSize | HTTP | actualSize | ratioError | Exact pixels |
| --- | ---: | --- | ---: | --- |
${sizeResults.map(item => `| \`${item.requestedSize}\` | ${item.status} | ${item.actualSize ? `\`${item.actualSize}\`` : item.dimensionError || 'n/a'} | ${item.ratioError == null ? 'n/a' : item.ratioError} | ${item.supported} |`).join('\n')}

Product enum keeps the request string when ratioError is at most 1%. UI labels must not treat the request string as the output pixel count. See size-observations.json.

## Hygiene

Fixtures contain sanitized request/response summaries. API keys, Data URIs, generated bytes, signed URLs, dynamic IDs, and timestamps are not stored.
`

if (process.env.TRAE_PROBE_STDOUT === '1') {
  console.log(JSON.stringify({ fixtureDocuments, report }, null, 2))
}
else {
  for (const [filename, document] of Object.entries(fixtureDocuments))
    await writeFile(resolve(outputDir, filename), `${JSON.stringify(document, null, 2)}\n`)
  await writeFile(resolve(outputDir, 'probe-report.md'), report)
}
closeDatabase()

if (imageLocation === 'unconfirmed')
  throw new Error('Neither image field location produced a conclusive validation signal. Review the sanitized fixtures.')

console.log('Agnes Image 2.0 Flash probe completed. Review scripts/fixtures/agnes-image-20-flash/probe-report.md.')
