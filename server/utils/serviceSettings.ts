import type { TextProviderId } from '../../shared/types/provider'
import { randomUUID } from 'node:crypto'
import { DEFAULT_TEXT_MODEL_ID, getTextModel } from '../../shared/constants/modelCatalog'
import { connectDatabase } from './sqlite'

export interface ServiceSettings {
  version: 3
  selectedTextModel: string
  arkKey: string
  deepSeekKey: string
  zaiKey: string
  tosAccessKeyId: string
  tosSecretAccessKey: string
  tosBucket: string
  tosPrefix: string
  revision: string
  arkOk: boolean
  deepSeekOk: boolean
  zaiOk: boolean
  tosOk: boolean
  arkCheckedAt: string
  deepSeekCheckedAt: string
  zaiCheckedAt: string
  tosCheckedAt: string
  checkedAt: string
}

export interface ServiceSettingsInput {
  selectedTextModel?: string
  arkKey?: string
  deepSeekKey?: string
  zaiKey?: string
  tosAccessKeyId?: string
  tosSecretAccessKey?: string
  tosBucket?: string
  tosPrefix?: string
}

export const TOS_REGION = 'cn-beijing'
export const TOS_ENDPOINT = 'https://tos-cn-beijing.volces.com'

function stringValue(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

export function normalizeTosBucket(value: unknown) {
  const bucket = stringValue(value).trim()
  if (!bucket)
    return ''
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket))
    throw new TypeError('TOS bucket must be 3-63 lowercase letters, numbers, or hyphens, and start and end with a letter or number.')
  return bucket
}

export function normalizeTosPrefix(value: unknown) {
  const rawPrefix = stringValue(value).trim()
  if (rawPrefix.length > 256)
    throw new TypeError('TOS prefix must be 256 characters or shorter.')
  const prefix = rawPrefix.replace(/\/+$/, '')
  if (!prefix)
    return ''
  if (
    prefix.startsWith('/')
    || prefix.includes('\\')
    || /\p{Cc}/u.test(prefix)
    || prefix.split('/').some(part => !part || part === '.' || part === '..' || !/^[a-z\d][\w.-]*$/i.test(part))
  ) {
    throw new TypeError('TOS prefix must be a safe relative path using letters, numbers, dots, underscores, or hyphens.')
  }
  return prefix
}

function normalizeServiceSettings(value: unknown): ServiceSettings {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const selectedTextModel = stringValue(raw.selectedTextModel)
  return {
    version: 3,
    selectedTextModel: getTextModel(selectedTextModel) ? selectedTextModel : DEFAULT_TEXT_MODEL_ID,
    arkKey: stringValue(raw.arkKey),
    deepSeekKey: stringValue(raw.deepSeekKey),
    zaiKey: stringValue(raw.zaiKey),
    tosAccessKeyId: stringValue(raw.tosAccessKeyId),
    tosSecretAccessKey: stringValue(raw.tosSecretAccessKey),
    tosBucket: stringValue(raw.tosBucket),
    tosPrefix: stringValue(raw.tosPrefix),
    revision: stringValue(raw.revision),
    arkOk: raw.arkOk === true,
    deepSeekOk: raw.deepSeekOk === true,
    zaiOk: raw.zaiOk === true,
    tosOk: raw.tosOk === true,
    arkCheckedAt: stringValue(raw.arkCheckedAt),
    deepSeekCheckedAt: stringValue(raw.deepSeekCheckedAt),
    zaiCheckedAt: stringValue(raw.zaiCheckedAt),
    tosCheckedAt: stringValue(raw.tosCheckedAt),
    checkedAt: stringValue(raw.checkedAt),
  }
}

export function readServiceSettings(): ServiceSettings {
  const db = connectDatabase()
  db.exec('CREATE TABLE IF NOT EXISTS local_service_settings (id INTEGER PRIMARY KEY CHECK (id = 1), body TEXT NOT NULL)')
  const row = db.prepare('SELECT body FROM local_service_settings WHERE id = 1').get()
  if (!row)
    return normalizeServiceSettings({})
  try {
    const parsed = JSON.parse(String(row.body))
    const normalized = normalizeServiceSettings(parsed)
    if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
      db.prepare('UPDATE local_service_settings SET body = ? WHERE id = 1').run(JSON.stringify(normalized))
    }
    return normalized
  }
  catch {
    return normalizeServiceSettings({})
  }
}

export function writeServiceSettings(settings: ServiceSettings) {
  readServiceSettings()
  const normalized = normalizeServiceSettings(settings)
  connectDatabase().prepare('INSERT INTO local_service_settings(id, body) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET body = excluded.body').run(JSON.stringify(normalized))
}

export class ServiceSettingsRevisionError extends Error {
  constructor() {
    super('Service settings changed in another window.')
    this.name = 'ServiceSettingsRevisionError'
  }
}

export function updateServiceSettings(input: ServiceSettingsInput, expectedRevision?: string) {
  const current = readServiceSettings()
  if (expectedRevision !== undefined && expectedRevision !== current.revision)
    throw new ServiceSettingsRevisionError()

  const selectedTextModel = input.selectedTextModel?.trim() || current.selectedTextModel
  if (!getTextModel(selectedTextModel))
    throw new TypeError('Unknown text model.')

  const tosAccessKeyId = input.tosAccessKeyId === undefined ? current.tosAccessKeyId : input.tosAccessKeyId.trim()
  const tosSecretAccessKey = input.tosSecretAccessKey === undefined ? current.tosSecretAccessKey : input.tosSecretAccessKey.trim()
  const tosBucket = normalizeTosBucket(input.tosBucket === undefined ? current.tosBucket : input.tosBucket)
  const tosPrefix = normalizeTosPrefix(input.tosPrefix === undefined ? current.tosPrefix : input.tosPrefix)
  const tosParts = [tosAccessKeyId, tosSecretAccessKey, tosBucket]
  if (tosParts.some(Boolean) && !tosParts.every(Boolean))
    throw new TypeError('TOS access key ID, secret access key, and bucket must be configured together.')

  const settings: ServiceSettings = {
    version: 3,
    selectedTextModel,
    arkKey: input.arkKey === undefined ? current.arkKey : input.arkKey.trim(),
    deepSeekKey: input.deepSeekKey === undefined ? current.deepSeekKey : input.deepSeekKey.trim(),
    zaiKey: input.zaiKey === undefined ? current.zaiKey : input.zaiKey.trim(),
    tosAccessKeyId,
    tosSecretAccessKey,
    tosBucket,
    tosPrefix,
    revision: randomUUID(),
    arkOk: false,
    deepSeekOk: false,
    zaiOk: false,
    tosOk: false,
    arkCheckedAt: '',
    deepSeekCheckedAt: '',
    zaiCheckedAt: '',
    tosCheckedAt: '',
    checkedAt: '',
  }
  writeServiceSettings(settings)
  return settings
}

export function publicServiceStatus(settings = readServiceSettings()) {
  const model = getTextModel(settings.selectedTextModel) ?? getTextModel(DEFAULT_TEXT_MODEL_ID)!
  const tosConfigured = Boolean(settings.tosAccessKeyId && settings.tosSecretAccessKey && settings.tosBucket)
  const providerValues = {
    ark: {
      configured: Boolean(settings.arkKey),
      ok: Boolean(settings.arkCheckedAt) && settings.arkOk,
      checkedAt: settings.arkCheckedAt,
      validation: 'text-request' as const,
      mediaGenerationVerified: false as const,
    },
    deepseek: {
      configured: Boolean(settings.deepSeekKey),
      ok: Boolean(settings.deepSeekCheckedAt) && settings.deepSeekOk,
      checkedAt: settings.deepSeekCheckedAt,
      validation: 'text-request' as const,
      mediaGenerationVerified: false as const,
    },
    zai: {
      configured: Boolean(settings.zaiKey),
      ok: Boolean(settings.zaiCheckedAt) && settings.zaiOk,
      checkedAt: settings.zaiCheckedAt,
      validation: 'text-request' as const,
      mediaGenerationVerified: false as const,
    },
  }
  const textProvider = model.provider as TextProviderId
  const textReady = providerValues[textProvider].ok
  const arkReady = providerValues.ark.ok
  return {
    version: settings.version,
    revision: settings.revision,
    selectedTextModel: settings.selectedTextModel,
    selectedTextProvider: textProvider,
    selectedTextCapabilities: model.capabilities,
    providers: providerValues,
    textReady,
    imageReady: arkReady,
    videoReady: arkReady,
    mediaValidation: {
      image: { backend: 'ark' as const, actualGenerationVerified: false as const },
      video: { backend: 'ark' as const, actualGenerationVerified: false as const },
    },
    tosConfigured,
    tosOk: Boolean(settings.tosCheckedAt) && settings.tosOk,
    tosCheckedAt: settings.tosCheckedAt,
    tosBucket: settings.tosBucket,
    tosPrefix: settings.tosPrefix,
    tosRegion: TOS_REGION,
    tosEndpoint: TOS_ENDPOINT,
    connected: textReady && arkReady,
    checkedAt: settings.checkedAt,
  }
}
