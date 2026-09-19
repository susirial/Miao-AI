import type { ChatMessage } from '../../agent/types'
import type { LlmSnapshot } from './types'

export interface ErrorChainItem {
  name?: string
  message: string
  code?: string | number
  errno?: string | number
  syscall?: string
}

export interface LlmRequestLog {
  phase: 'start' | 'fail'
  kind: 'complete' | 'stream'
  provider: string
  catalogModelId: string
  model: string
  textReady: boolean
  hasApiKey: boolean
  settingsRevision: string
  endpoint: string
  host: string
  bodyBytes: number
  messages: number
  imageParts: number
  tools: string[]
  requiredTool?: string
  disableTools?: boolean
  aborted?: boolean
  elapsedMs?: number
  status?: number
  ok?: boolean
  error?: ErrorChainItem[]
}

export function safeLlmSnapshot(snapshot: Pick<LlmSnapshot, 'provider' | 'catalogModelId' | 'model' | 'apiKey' | 'textReady' | 'settingsRevision'>) {
  return {
    provider: snapshot.provider,
    catalogModelId: snapshot.catalogModelId,
    model: snapshot.model,
    textReady: snapshot.textReady,
    hasApiKey: Boolean(snapshot.apiKey),
    settingsRevision: snapshot.settingsRevision,
  }
}

export function describeErrorChain(error: unknown) {
  const chain: ErrorChainItem[] = []
  const seen = new Set<unknown>()
  let current: unknown = error
  for (let depth = 0; current != null && depth < 5 && !seen.has(current); depth++) {
    seen.add(current)
    if (current instanceof Error) {
      const extra = current as Error & { code?: string | number, errno?: string | number, syscall?: string }
      chain.push(errorItem(extra.message, extra.name, extra))
      current = extra.cause
      continue
    }
    if (typeof current === 'object') {
      const record = current as { message?: unknown, name?: unknown, code?: string | number, errno?: string | number, syscall?: string, cause?: unknown }
      chain.push(errorItem(
        typeof record.message === 'string' ? record.message : String(current),
        typeof record.name === 'string' ? record.name : undefined,
        record,
      ))
      current = record.cause
      continue
    }
    chain.push({ message: String(current) })
    break
  }
  return chain
}

export function describeLlmRequest(input: {
  kind: 'complete' | 'stream'
  snapshot: Pick<LlmSnapshot, 'provider' | 'catalogModelId' | 'model' | 'apiKey' | 'textReady' | 'settingsRevision'>
  url: string
  body?: unknown
  messages?: ChatMessage[]
  tools?: unknown[]
  requiredTool?: string
  disableTools?: boolean
  aborted?: boolean
  elapsedMs?: number
  status?: number
  ok?: boolean
  error?: unknown
}): Omit<LlmRequestLog, 'phase'> {
  return {
    kind: input.kind,
    ...safeLlmSnapshot(input.snapshot),
    endpoint: input.url,
    host: hostOf(input.url),
    bodyBytes: typeof input.body === 'string' ? input.body.length : 0,
    messages: input.messages?.length || 0,
    imageParts: imagePartCount(input.messages || []),
    tools: toolNames(input.tools),
    requiredTool: input.requiredTool,
    disableTools: input.disableTools,
    aborted: input.aborted,
    elapsedMs: input.elapsedMs,
    status: input.status,
    ok: input.ok,
    error: input.error === undefined ? undefined : describeErrorChain(input.error),
  }
}

export function logLlmRequestStart(meta: Omit<LlmRequestLog, 'phase'>) {
  console.info('[llm request]', { phase: 'start', ...withoutError(meta) })
}

export function logLlmRequestFail(meta: Omit<LlmRequestLog, 'phase'> & { error?: unknown }) {
  console.error('[llm request]', {
    phase: 'fail',
    ...withoutError(meta),
    error: describeErrorChain(meta.error),
  })
}

function withoutError<T extends { error?: unknown }>(meta: T) {
  const { error: _error, ...rest } = meta
  return rest
}

function errorItem(
  message: string,
  name: string | undefined,
  extra: { code?: string | number, errno?: string | number, syscall?: string },
): ErrorChainItem {
  return {
    name,
    message,
    code: extra.code,
    errno: extra.errno,
    syscall: extra.syscall,
  }
}

function hostOf(url: string) {
  try {
    return new URL(url).host
  }
  catch {
    return ''
  }
}

function toolNames(tools: unknown[] | undefined) {
  if (!Array.isArray(tools))
    return []
  return tools.flatMap((tool) => {
    const name = tool && typeof tool === 'object' && 'function' in tool
      ? String((tool as { function?: { name?: string } }).function?.name || '')
      : ''
    return name ? [name] : []
  })
}

function imagePartCount(messages: ChatMessage[]) {
  let count = 0
  for (const message of messages) {
    if (!Array.isArray(message.content))
      continue
    for (const part of message.content) {
      if (part.type === 'image_url')
        count += 1
    }
  }
  return count
}
