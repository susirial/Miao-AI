const TIMESTAMP_KEYS = /^(?:created|created_at|completed_at|timestamp)$/
const ID_KEYS = /^(?:id|request_id|task_id|video_id)$/

function sanitizeString(value, key, apiKey) {
  if (value === apiKey)
    return '[REDACTED]'
  if (ID_KEYS.test(key))
    return '[ID]'
  if (/^https?:\/\//i.test(value))
    return '[REMOTE_URL]'
  if (/^data:/i.test(value))
    return '[DATA_URI]'
  return value.replace(/request id:\s*[^)\s]+/gi, 'request id: [ID]')
}

export function sanitizeAgnesProbeValue(value, apiKey, key = '') {
  if (typeof value === 'string')
    return sanitizeString(value, key, apiKey)
  if (Array.isArray(value))
    return value.map(item => sanitizeAgnesProbeValue(item, apiKey, key))
  if (!value || typeof value !== 'object')
    return TIMESTAMP_KEYS.test(key) && value !== null ? '[TIMESTAMP]' : value
  return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [
    childKey,
    sanitizeAgnesProbeValue(childValue, apiKey, childKey),
  ]))
}
