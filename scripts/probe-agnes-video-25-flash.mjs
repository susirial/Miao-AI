import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import sharp from 'sharp'
import { readServiceSettings } from '../server/utils/serviceSettings.ts'
import { closeDatabase } from '../server/utils/sqlite.ts'
import { sanitizeAgnesProbeValue } from './utils/agnesProbeSanitization.mjs'

const execFileAsync = promisify(execFile)
const root = fileURLToPath(new URL('..', import.meta.url))
const outputDir = resolve(root, 'scripts/fixtures/agnes-video-25-flash')
const createEndpoint = 'https://apihub.agnes-ai.com/v1/videos'
const queryEndpoint = 'https://apihub.agnes-ai.com/agnesapi'
const model = 'agnes-video-2.5-flash'
const pollDeadlineMs = 15 * 60 * 1000
const { agnesKey } = readServiceSettings()

if (!agnesKey)
  throw new Error('Configure an Agnes API key in Service Connection before probing.')

function sanitize(value) {
  return sanitizeAgnesProbeValue(value, agnesKey)
}

async function readResponse(response) {
  const text = await response.text()
  try {
    return text ? JSON.parse(text) : {}
  }
  catch {
    return { raw: text }
  }
}

async function createVideo(body) {
  const response = await fetch(createEndpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${agnesKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  })
  return { status: response.status, payload: await readResponse(response) }
}

async function queryVideo(videoId) {
  const url = new URL(queryEndpoint)
  url.searchParams.set('video_id', videoId)
  url.searchParams.set('model_name', model)
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${agnesKey}` },
    signal: AbortSignal.timeout(30_000),
  })
  return { status: response.status, payload: await readResponse(response) }
}

async function waitForVideo(created) {
  const videoId = typeof created?.payload?.video_id === 'string' ? created.payload.video_id : ''
  if (!videoId)
    return { terminal: null, observations: [], error: 'Creation response did not include video_id.' }
  const deadline = Date.now() + pollDeadlineMs
  const observations = []
  while (Date.now() < deadline) {
    const result = await queryVideo(videoId)
    const status = String(result.payload?.status || '')
    if (!observations.some(item => item.http === result.status && item.status === status))
      observations.push({ http: result.status, status })
    if (result.status === 404 || status === 'completed' || status === 'failed')
      return { terminal: result, observations, error: '' }
    if (result.status >= 400 && result.status !== 429 && result.status < 500)
      return { terminal: result, observations, error: `Polling stopped after HTTP ${result.status}.` }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 2_000))
  }
  return { terminal: null, observations, error: 'Polling exceeded 15 minutes.' }
}

async function audioObservation(terminal) {
  const url = terminal?.payload?.metadata?.url
  if (terminal?.payload?.status !== 'completed' || typeof url !== 'string' || !/^https:\/\//i.test(url))
    return { outcome: 'not_available', streams: [] }
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) })
  if (!response.ok)
    return { outcome: `download_failed_${response.status}`, streams: [] }
  const directory = await mkdtemp(join(tmpdir(), 'agnes-video-probe-'))
  const videoPath = join(directory, 'result.mp4')
  try {
    await writeFile(videoPath, Buffer.from(await response.arrayBuffer()))
    const { stdout } = await execFileAsync('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'a',
      '-show_entries',
      'stream=codec_name,channels',
      '-of',
      'json',
      videoPath,
    ], { timeout: 30_000 })
    const parsed = JSON.parse(stdout)
    const streams = Array.isArray(parsed.streams) ? parsed.streams : []
    return { outcome: streams.length ? 'audio_present' : 'no_audio_stream', streams }
  }
  catch (error) {
    return {
      outcome: 'ffprobe_failed',
      streams: [],
      error: error instanceof Error ? error.message : String(error),
    }
  }
  finally {
    await rm(directory, { recursive: true, force: true })
  }
}

await mkdir(outputDir, { recursive: true })

const textRequest = {
  model,
  prompt: 'A quiet silver paper airplane glides through a softly lit studio, slow camera pan.',
  seconds: '4',
  mode: 'text',
  size: '720P',
  aspect_ratio: '16:9',
}
const textCreated = await createVideo(textRequest)
const textPolled = await waitForVideo(textCreated)
const audio = await audioObservation(textPolled.terminal)

const source = await sharp({
  create: {
    width: 1280,
    height: 720,
    channels: 3,
    background: { r: 38, g: 91, b: 142 },
  },
}).png().toBuffer()
const sourceDataUri = `data:image/png;base64,${source.toString('base64')}`
const keyframeRequest = {
  model,
  prompt: 'The blue frame develops gentle moving light and a slow forward camera movement.',
  seconds: '4',
  mode: 'keyframe',
  size: '720P',
  aspect_ratio: '16:9',
  first_frame: sourceDataUri,
}
const keyframeCreated = await createVideo(keyframeRequest)
const keyframePolled = keyframeCreated.status >= 200 && keyframeCreated.status < 300
  ? await waitForVideo(keyframeCreated)
  : { terminal: null, observations: [], error: 'Creation rejected the Data URI.' }

const overLimit = await createVideo({
  model,
  prompt: 'Use the supplied images as visual references.',
  seconds: '4',
  mode: 'reference',
  size: '720P',
  aspect_ratio: '16:9',
  images: Array.from({ length: 6 }, (_, index) => `https://example.com/reference-${index + 1}.png`),
})

const fixtureDocuments = {
  'text-to-video.json': sanitize({
    request: textRequest,
    created: textCreated,
    polling: textPolled,
    audioObservation: audio,
  }),
  'keyframe-data-uri.json': sanitize({
    request: keyframeRequest,
    created: keyframeCreated,
    polling: keyframePolled,
  }),
  'reference-over-limit.json': sanitize({
    request: { ...textRequest, mode: 'reference', images: ['[SIX_REMOTE_URLS]'] },
    response: overLimit,
  }),
}

const textStatus = String(textPolled.terminal?.payload?.status || 'not_completed')
const keyframeStatus = String(keyframePolled.terminal?.payload?.status || 'not_completed')
const dataUriAccepted = keyframeCreated.status >= 200
  && keyframeCreated.status < 300
  && keyframeStatus === 'completed'
const overLimitDetail = sanitize(String(overLimit.payload?.detail || overLimit.payload?.error?.message || 'not reported'))
const report = `# Agnes Video 2.5 Flash Protocol Probe

- Model: \`${model}\`
- Create endpoint: \`${createEndpoint}\`
- Query endpoint: \`${queryEndpoint}?video_id=...&model_name=${model}\`
- Key source: local SQLite service settings (value never logged)

## Documentation Contract

Creation, polling, and query fields stay a documentation contract until a probe reaches \`completed\`. Do not write a fake completed fixture. Live create HTTP this run: ${textCreated.status}.

## Text-to-Video

- Create HTTP: ${textCreated.status}
- Create returned \`video_id\`: ${typeof textCreated.payload?.video_id === 'string'}
- Observed states: ${textPolled.observations.map(item => `${item.http}/${item.status || 'empty'}`).join(', ') || 'none'}
- Terminal status: ${textStatus}
- Completed URL present: ${typeof textPolled.terminal?.payload?.metadata?.url === 'string'}
- Audio sample observation: ${audio.outcome}

The audio observation is informational only. Frozen audio control capability: **none**.

## Data URI Keyframe

- Create HTTP: ${keyframeCreated.status}
- Create returned \`video_id\`: ${typeof keyframeCreated.payload?.video_id === 'string'}
- Terminal status: ${keyframeStatus}
- Data URI strategy accepted: **${dataUriAccepted}**

The Data URI strategy is enabled only when the task reaches \`completed\`.

## Reference Limits

- Six-image request HTTP: ${overLimit.status}
- Error detail: ${overLimitDetail}

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

if (textStatus !== 'completed')
  throw new Error(`Text-to-video probe did not complete: ${textPolled.error || textStatus}`)

console.log('Agnes Video 2.5 Flash probe completed. Review scripts/fixtures/agnes-video-25-flash/probe-report.md.')
