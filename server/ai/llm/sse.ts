import type { StreamDelta } from './types'

interface ChatCompletionChunk {
  choices?: Array<{
    delta?: {
      content?: string | null
      reasoning?: string | null
      reasoning_content?: string | null
      tool_calls?: Array<{
        index?: number
        id?: string
        function?: {
          name?: string
          arguments?: string
        }
      }>
    }
    finish_reason?: string | null
  }>
  error?: string | {
    message?: string
    code?: string | number
  }
}

function payloadError(error: ChatCompletionChunk['error']) {
  if (!error)
    return ''
  if (typeof error === 'string')
    return error
  return error.message || (error.code == null ? 'Provider returned an error.' : `Provider error (${error.code}).`)
}

const MAX_PROVIDER_DETAIL = 300

/** Providers answer with JSON envelopes; chat should read the message, not the envelope. */
export function providerFailureMessage(body: string, providerName: string, status: number) {
  const text = body.trim()
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text) as {
        error?: string | { message?: string, code?: string | number }
        message?: string
      }
      const detail = typeof parsed.error === 'string'
        ? parsed.error
        : parsed.error?.message || parsed.message
      if (detail?.trim())
        return `${providerName}: ${detail.trim().slice(0, MAX_PROVIDER_DETAIL)}`
    }
    catch {
      // Fall through to the raw body below.
    }
  }
  return text ? `${providerName}: ${text.slice(0, MAX_PROVIDER_DETAIL)}` : `${providerName} request failed (${status}).`
}

export async function assertChatResponse(response: Response, providerName: string) {
  if (response.ok)
    return
  const text = await response.text().catch(() => '')
  throw new Error(providerFailureMessage(text, providerName, response.status))
}

export async function consumeChatCompletionSse(options: {
  response: Response
  providerName: string
  signal?: AbortSignal
  onDelta: (delta: StreamDelta) => void
}) {
  await assertChatResponse(options.response, options.providerName)
  if (!options.response.body)
    throw new Error(`${options.providerName} returned an empty stream.`)

  const reader = options.response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let sawChoice = false
  const abortReader = () => {
    void reader.cancel(options.signal?.reason).catch(() => {})
  }
  options.signal?.addEventListener('abort', abortReader, { once: true })
  if (options.signal?.aborted)
    abortReader()

  const consumeLine = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:'))
      return
    const data = trimmed.slice(5).trim()
    if (!data || data === '[DONE]')
      return

    let chunk: ChatCompletionChunk
    try {
      chunk = JSON.parse(data) as ChatCompletionChunk
    }
    catch {
      return
    }
    const error = payloadError(chunk.error)
    if (error)
      throw new Error(error)
    const choice = chunk.choices?.[0]
    if (!choice)
      return
    sawChoice = true
    const delta = choice.delta || {}
    options.onDelta({
      content: delta.content || undefined,
      reasoning: delta.reasoning || delta.reasoning_content || undefined,
      toolCalls: (delta.tool_calls || []).map(item => ({
        index: item.index ?? 0,
        id: item.id,
        name: item.function?.name,
        arguments: item.function?.arguments,
      })),
      finishReason: choice.finish_reason,
    })
  }

  try {
    while (true) {
      options.signal?.throwIfAborted()
      const { done, value } = await reader.read()
      if (done)
        break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() || ''
      for (const line of lines)
        consumeLine(line)
    }
    buffer += decoder.decode()
    if (buffer.trim())
      consumeLine(buffer)
  }
  finally {
    options.signal?.removeEventListener('abort', abortReader)
    reader.releaseLock()
  }

  options.signal?.throwIfAborted()
  if (!sawChoice)
    throw new Error(`${options.providerName} returned an empty stream.`)
}
