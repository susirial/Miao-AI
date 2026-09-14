import type { ServiceSettings } from './serviceSettings'
import TosClient from '@volcengine/tos-sdk'
import { DEFAULT_TEXT_MODEL_ID, getTextModel } from '../../shared/constants/modelCatalog'
import { publicServiceStatus, readServiceSettings, TOS_ENDPOINT, TOS_REGION, writeServiceSettings } from './serviceSettings'

interface ConnectionTestResult {
  ok: boolean
  message: string
  skipped?: boolean
  mediaGenerationVerified?: false
}

const PROVIDER_ENDPOINTS = {
  ark: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
  deepseek: 'https://api.deepseek.com/chat/completions',
  zai: 'https://api.z.ai/api/paas/v4/chat/completions',
} as const

async function checkChatCompletion(options: {
  name: string
  endpoint: string
  apiKey: string
  model: string
  headers?: Record<string, string>
  body?: Record<string, unknown>
}): Promise<ConnectionTestResult> {
  if (!options.apiKey)
    return { ok: false, skipped: true, message: `${options.name} API key is not configured.` }
  try {
    const response = await fetch(options.endpoint, {
      method: 'POST',
      signal: AbortSignal.timeout(20000),
      headers: {
        'Authorization': `Bearer ${options.apiKey}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
      body: JSON.stringify({
        model: options.model,
        messages: [{ role: 'user', content: 'Reply OK.' }],
        max_tokens: 8,
        stream: false,
        ...options.body,
      }),
    })
    const payload = await response.json() as { error?: unknown, choices?: unknown[] }
    if (!response.ok || payload.error || !Array.isArray(payload.choices) || !payload.choices.length)
      return { ok: false, message: `${options.name} test failed (${response.status}). Check the key, model access, and available balance.` }
    return { ok: true, message: `${options.name} responded successfully.` }
  }
  catch {
    return { ok: false, message: `${options.name} could not be reached. Check your connection and try again.` }
  }
}

function checkArk(settings: ServiceSettings) {
  const selected = getTextModel(settings.selectedTextModel)
  const model = selected?.provider === 'ark'
    ? selected
    : getTextModel(DEFAULT_TEXT_MODEL_ID)!
  return checkChatCompletion({
    name: 'Ark',
    endpoint: PROVIDER_ENDPOINTS.ark,
    apiKey: settings.arkKey,
    model: model.upstreamModelId,
  })
}

function checkDeepSeek(settings: ServiceSettings) {
  return checkChatCompletion({
    name: 'DeepSeek',
    endpoint: PROVIDER_ENDPOINTS.deepseek,
    apiKey: settings.deepSeekKey,
    model: getTextModel('deepseek/deepseek-v4.1-flash')!.upstreamModelId,
  })
}

function checkZai(settings: ServiceSettings) {
  return checkChatCompletion({
    name: 'Z.ai',
    endpoint: PROVIDER_ENDPOINTS.zai,
    apiKey: settings.zaiKey,
    model: getTextModel('zai/glm-5.3')!.upstreamModelId,
    body: {
      thinking: { type: 'enabled' },
      reasoning_effort: 'low',
    },
  })
}

async function checkTos(settings: ServiceSettings): Promise<ConnectionTestResult> {
  if (!settings.tosAccessKeyId || !settings.tosSecretAccessKey || !settings.tosBucket)
    return { ok: false, skipped: true, message: 'TOS reference media storage is not configured.' }
  try {
    const client = new TosClient({
      accessKeyId: settings.tosAccessKeyId,
      accessKeySecret: settings.tosSecretAccessKey,
      bucket: settings.tosBucket,
      region: TOS_REGION,
      endpoint: TOS_ENDPOINT,
      requestTimeout: 20_000,
      connectionTimeout: 10_000,
    })
    // This is intentionally read-only: never create, upload, or delete test objects.
    await client.headBucket(settings.tosBucket)
    return { ok: true, message: 'TOS bucket access was verified with a read-only check.' }
  }
  catch {
    return { ok: false, message: 'TOS bucket check failed. Verify the credentials, bucket, and cn-beijing region.' }
  }
}

export async function testServiceConnections(settings: ServiceSettings) {
  const [ark, deepSeek, zai, tos] = await Promise.all([
    checkArk(settings),
    checkDeepSeek(settings),
    checkZai(settings),
    checkTos(settings),
  ])
  if (readServiceSettings().revision !== settings.revision)
    return { ...publicServiceStatus(), ark, deepSeek, zai, tos, superseded: true }

  const checkedAt = new Date().toISOString()
  const checked: ServiceSettings = {
    ...settings,
    arkOk: ark.ok,
    deepSeekOk: deepSeek.ok,
    zaiOk: zai.ok,
    tosOk: tos.ok,
    arkCheckedAt: ark.skipped ? '' : checkedAt,
    deepSeekCheckedAt: deepSeek.skipped ? '' : checkedAt,
    zaiCheckedAt: zai.skipped ? '' : checkedAt,
    tosCheckedAt: tos.skipped ? '' : checkedAt,
    checkedAt,
  }
  writeServiceSettings(checked)
  return { ...publicServiceStatus(checked), ark, deepSeek, zai, tos, superseded: false }
}
