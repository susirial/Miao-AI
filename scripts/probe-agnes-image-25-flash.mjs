import { Buffer } from 'node:buffer'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { sanitizeAgnesProbeValue } from './utils/agnesProbeSanitization.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const outputDir = resolve(root, 'scripts/fixtures/agnes-image-25-flash')
const previewDir = resolve(root, 'tmp/agnes-image-25-lab')
const endpoint = 'https://apihub.agnes-ai.com/v1/images/generations'
const model = 'agnes-image-2.5-flash'
const timeoutMs = 6 * 60 * 1000
const agnesKey = process.env.AGNES_PROBE_KEY?.trim() || ''

if (!agnesKey)
  throw new Error('Set AGNES_PROBE_KEY before probing. Do not put the key in the repository.')

const EXPECTED = {
  '1K': {
    '1:1': '1024x1024',
    '3:4': '864x1152',
    '4:3': '1152x864',
    '16:9': '1312x736',
    '9:16': '736x1312',
    '2:3': '832x1248',
    '3:2': '1248x832',
    '21:9': '1568x672',
  },
  '2K': {
    '1:1': '2048x2048',
    '3:4': '1728x2304',
    '4:3': '2304x1728',
    '16:9': '2624x1472',
    '9:16': '1472x2624',
    '2:3': '1664x2496',
    '3:2': '2496x1664',
    '21:9': '3136x1344',
  },
  '3K': {
    '1:1': '3072x3072',
    '3:4': '2592x3456',
    '4:3': '3456x2592',
    '16:9': '3936x2208',
    '9:16': '2208x3936',
    '2:3': '2496x3744',
    '3:2': '3744x2496',
    '21:9': '4704x2016',
  },
  '4K': {
    '1:1': '4096x4096',
    '3:4': '3456x4608',
    '4:3': '4608x3456',
    '16:9': '5248x2944',
    '9:16': '2944x5248',
    '2:3': '3328x4992',
    '3:2': '4992x3328',
    '21:9': '6272x2688',
  },
}
const SIZES = Object.keys(EXPECTED)
const RATIOS = Object.keys(EXPECTED['1K'])

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

function validationHit(result) {
  if (result.status < 400 || result.status >= 500)
    return false
  const text = JSON.stringify(result.payload).toLowerCase()
  return /image|base64|data uri|invalid|response_format/.test(text)
}

async function mapPool(items, limit, worker) {
  const results = Array.from({ length: items.length })
  let index = 0
  async function run() {
    while (index < items.length) {
      const current = index++
      results[current] = await worker(items[current], current)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run))
  return results
}

await mkdir(outputDir, { recursive: true })
await mkdir(previewDir, { recursive: true })

const prompt = 'A matte orange cube centered on a neutral gray studio background.'
const retryFailed = process.argv.includes('--retry-failed')
const prior = retryFailed
  ? JSON.parse(await readFile(resolve(outputDir, 'size-observations.json'), 'utf8'))
  : []
const cells = SIZES.flatMap(size => RATIOS.map(ratio => ({ size, ratio, expected: EXPECTED[size][ratio] })))
  .filter(cell => !retryFailed || !prior.some(row => row.size === cell.size && row.ratio === cell.ratio && row.product))
const sizeResults = await mapPool(cells, retryFailed ? 1 : 2, async (cell) => {
  if (retryFailed)
    await new Promise(resolveWait => setTimeout(resolveWait, 4000))
  const result = await request({
    model,
    prompt,
    size: cell.size,
    ratio: cell.ratio,
    extra_body: { response_format: 'url' },
  })
  let actualSize = null
  let dimensionError = ''
  if (result.status >= 200 && result.status < 300) {
    try {
      const bytes = await imageBytes(firstImage(result.payload))
      const metadata = await sharp(bytes).metadata()
      if (!metadata.width || !metadata.height)
        throw new Error('Generated image dimensions could not be read.')
      actualSize = `${metadata.width}x${metadata.height}`
      const slug = `${cell.size}-${cell.ratio.replace(':', 'x')}`
      await writeFile(resolve(previewDir, `${slug}.png`), bytes)
    }
    catch (error) {
      dimensionError = error instanceof Error ? error.message : String(error)
    }
  }
  const ratioError = cell.expected && actualSize ? sizeRatioError(cell.expected, actualSize) : null
  console.log(`${cell.size} ${cell.ratio} -> HTTP ${result.status} actual ${actualSize || dimensionError || 'n/a'} product ${ratioError != null && ratioError <= 0.01}`)
  return {
    size: cell.size,
    ratio: cell.ratio,
    expectedSize: cell.expected,
    status: result.status,
    actualSize,
    ratioError,
    exactPixels: actualSize === cell.expected,
    product: ratioError != null && ratioError <= 0.01,
    dimensionError,
  }
})

const mergedSizeResults = cells.length
  ? [
      ...prior.filter(row => !sizeResults.some(item => item.size === row.size && item.ratio === row.ratio)),
      ...sizeResults,
    ].sort((left, right) => {
      const sizeOrder = SIZES.indexOf(left.size) - SIZES.indexOf(right.size)
      return sizeOrder !== 0 ? sizeOrder : RATIOS.indexOf(left.ratio) - RATIOS.indexOf(right.ratio)
    })
  : prior
const sizeResultsForReport = mergedSizeResults.length ? mergedSizeResults : sizeResults

const rows = sizeResultsForReport.map(item => ({
  size: item.size,
  ratio: item.ratio,
  expectedSize: item.expectedSize,
  actualSize: item.actualSize,
  ratioError: item.ratioError,
  exactPixels: item.exactPixels,
  product: item.product,
  status: item.status,
  dimensionError: item.dimensionError,
}))

let compat = retryFailed
  ? JSON.parse(await readFile(resolve(outputDir, 'compat-probes.json'), 'utf8'))
  : null
if (!compat) {
  const pixelLegacy = await request({
    model,
    prompt,
    size: '1024x1024',
    extra_body: { response_format: 'url' },
  })
  let pixelActual = null
  if (pixelLegacy.status >= 200 && pixelLegacy.status < 300) {
    try {
      const bytes = await imageBytes(firstImage(pixelLegacy.payload))
      const metadata = await sharp(bytes).metadata()
      pixelActual = metadata.width && metadata.height ? `${metadata.width}x${metadata.height}` : null
      if (bytes.length)
        await writeFile(resolve(previewDir, 'legacy-1024x1024.png'), bytes)
    }
    catch {
      pixelActual = null
    }
  }

  const topLevelFormat = await request({
    model,
    prompt,
    size: '1K',
    ratio: '1:1',
    response_format: 'url',
  })

  const invalidDataUri = 'data:image/png;base64,NOT_VALID'
  const extraBodyInvalid = await request({
    model,
    prompt: 'Preserve the source composition and turn the object blue.',
    size: '1K',
    ratio: '1:1',
    extra_body: { image: [invalidDataUri], response_format: 'url' },
  })
  const topLevelInvalid = await request({
    model,
    prompt: 'Preserve the source composition and turn the object blue.',
    size: '1K',
    ratio: '1:1',
    image: [invalidDataUri],
  })
  const imageLocation = validationHit(extraBodyInvalid)
    ? 'extra_body.image'
    : validationHit(topLevelInvalid)
      ? 'image'
      : 'unconfirmed'

  const source = await sharp({
    create: {
      width: 256,
      height: 256,
      channels: 3,
      background: { r: 237, g: 64, b: 54 },
    },
  }).png().toBuffer()
  const sourceDataUri = `data:image/png;base64,${source.toString('base64')}`
  const legalDataUri = imageLocation === 'unconfirmed'
    ? null
    : await request(imageLocation === 'extra_body.image'
      ? {
          model,
          prompt: 'Keep the square composition and change the red field to deep blue.',
          size: '1K',
          ratio: '1:1',
          extra_body: { image: [sourceDataUri], response_format: 'url' },
        }
      : {
          model,
          prompt: 'Keep the square composition and change the red field to deep blue.',
          size: '1K',
          ratio: '1:1',
          image: [sourceDataUri],
        })
  compat = sanitize({
    pixelLegacy: { status: pixelLegacy.status, actualSize: pixelActual },
    topLevelFormat: { status: topLevelFormat.status, validationHit: validationHit(topLevelFormat) },
    extraBodyInvalid: { status: extraBodyInvalid.status, validationHit: validationHit(extraBodyInvalid) },
    topLevelInvalid: { status: topLevelInvalid.status, validationHit: validationHit(topLevelInvalid) },
    legalDataUri: { status: legalDataUri?.status ?? null },
    imageLocation,
  })
}

const fixtureDocuments = {
  'size-observations.json': rows.map(({ dimensionError: _dimensionError, ...item }) => item),
  'compat-probes.json': compat,
}

const productRows = rows.filter(item => item.product)
const productSizes = [...new Set(productRows.map(item => item.size))]
const productRatios = [...new Set(productRows.map(item => item.ratio))]
const report = `# Agnes Image 2.5 Flash Protocol Probe

- Date: ${new Date().toISOString().slice(0, 10)}
- Model: \`${model}\`
- Endpoint: \`${endpoint}\`
- Key source: AGNES_PROBE_KEY (value never logged)

## Frozen Decisions

- Image input location: **${compat.imageLocation}**
- Top-level \`response_format\` validation: ${compat.topLevelFormat?.validationHit}
- Pixel \`size=1024x1024\` HTTP: ${compat.pixelLegacy?.status}; actual: ${compat.pixelLegacy?.actualSize ? `\`${compat.pixelLegacy.actualSize}\`` : 'n/a'}
- Product sizes: ${productSizes.map(item => `\`${item}\``).join(', ') || 'none'}
- Product ratios: ${productRatios.map(item => `\`${item}\``).join(', ') || 'none'}

Only \`product: true\` cells may enter the catalog. Labels must not treat the request string as the output pixel count.

## Size matrix

| size | ratio | HTTP | expected | actual | ratioError | product |
| --- | --- | ---: | --- | --- | ---: | --- |
${rows.map(item => `| \`${item.size}\` | \`${item.ratio}\` | ${item.status} | \`${item.expectedSize}\` | ${item.actualSize ? `\`${item.actualSize}\`` : item.dimensionError || 'n/a'} | ${item.ratioError == null ? 'n/a' : item.ratioError} | ${item.product} |`).join('\n')}

## Image field

| Probe | HTTP | Input validation observed |
| --- | ---: | --- |
| \`extra_body.image\` with invalid Data URI | ${compat.extraBodyInvalid?.status} | ${compat.extraBodyInvalid?.validationHit} |
| top-level \`image\` with invalid Data URI | ${compat.topLevelInvalid?.status} | ${compat.topLevelInvalid?.validationHit} |
| legal Data URI at selected location | ${compat.legalDataUri?.status ?? 'not run'} | ${compat.legalDataUri?.status >= 200 && compat.legalDataUri?.status < 300}

## Hygiene

Fixtures contain sanitized summaries only. API keys, Data URIs, generated bytes, signed URLs, dynamic IDs, timestamps, and account data are not stored. Local previews stay in gitignored \`tmp/agnes-image-25-lab/\`.
`

if (process.env.TRAE_PROBE_STDOUT === '1') {
  console.log(JSON.stringify({ fixtureDocuments, report }, null, 2))
}
else {
  for (const [filename, document] of Object.entries(fixtureDocuments))
    await writeFile(resolve(outputDir, filename), `${JSON.stringify(document, null, 2)}\n`)
  await writeFile(resolve(outputDir, 'probe-report.md'), report)
}
if (!productSizes.includes('1K') || !productSizes.includes('2K'))
  throw new Error('1K or 2K did not produce a product-true cell. Do not change product code.')
if (compat.imageLocation === 'unconfirmed')
  throw new Error('Neither image field location produced a conclusive validation signal. Review the sanitized fixtures.')

console.log('Agnes Image 2.5 Flash probe completed. Review scripts/fixtures/agnes-image-25-flash/probe-report.md.')
