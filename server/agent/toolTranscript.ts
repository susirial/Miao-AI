import type { AgentImage, ChatMessage } from './types'

function toolCallIds(message: ChatMessage) {
  if (message.role !== 'assistant' || !message.tool_calls?.length)
    return []
  return message.tool_calls.map(call => call.id).filter(Boolean)
}

/**
 * Drop tool results that are not part of the immediately preceding assistant
 * tool-call block. This repairs older snapshots without inventing results for
 * incomplete calls.
 */
export function removeOrphanToolMessages(messages: ChatMessage[]) {
  const repaired: ChatMessage[] = []
  let pending: Set<string> | null = null
  let removed = 0

  for (const message of messages) {
    if (message.role === 'tool') {
      const id = message.tool_call_id || ''
      if (!pending?.delete(id)) {
        removed++
        continue
      }
      repaired.push(message)
      if (!pending.size)
        pending = null
      continue
    }

    pending = null
    repaired.push(message)
    const ids = toolCallIds(message)
    if (ids.length)
      pending = new Set(ids)
  }

  return {
    messages: removed ? repaired : messages,
    removed,
  }
}

/**
 * Return only calls from the trailing assistant tool-call block that still
 * need results. A result from an older image must never be appended at the end.
 */
export function trailingUnansweredToolCallIds(messages: ChatMessage[]) {
  let assistantIndex = -1
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index]?.role === 'assistant') {
      assistantIndex = index
      break
    }
  }
  if (assistantIndex < 0)
    return []

  const expected = toolCallIds(messages[assistantIndex]!)
  if (!expected.length)
    return []

  const unanswered = new Set(expected)
  for (const message of messages.slice(assistantIndex + 1)) {
    if (message.role !== 'tool')
      return []
    unanswered.delete(message.tool_call_id || '')
  }
  return expected.filter(id => unanswered.has(id))
}

export function recoverableToolResultImages(messages: ChatMessage[], images: AgentImage[]) {
  return trailingUnansweredToolCallIds(messages).flatMap((toolCallId) => {
    const image = images.find(item =>
      item.id === toolCallId
      && item.kind !== 'upload'
      && item.status !== 'generating',
    )
    return image ? [{ toolCallId, image }] : []
  })
}

/** Validate the OpenAI-compatible assistant/tool message protocol. */
export function assertValidToolTranscript(messages: ChatMessage[]) {
  let pending: Set<string> | null = null

  for (const [index, message] of messages.entries()) {
    if (message.role === 'tool') {
      const id = message.tool_call_id || ''
      if (!pending)
        throw new Error(`Invalid tool transcript: orphan tool result at message ${index}.`)
      if (!pending.delete(id))
        throw new Error(`Invalid tool transcript: unexpected or duplicate tool_call_id "${id}" at message ${index}.`)
      if (!pending.size)
        pending = null
      continue
    }

    if (pending?.size)
      throw new Error(`Invalid tool transcript: missing result for ${[...pending].join(', ')} before message ${index}.`)

    const ids = toolCallIds(message)
    if (!ids.length)
      continue
    if (new Set(ids).size !== ids.length)
      throw new Error(`Invalid tool transcript: duplicate tool call id at message ${index}.`)
    pending = new Set(ids)
  }

  if (pending?.size)
    throw new Error(`Invalid tool transcript: missing result for ${[...pending].join(', ')} at end of messages.`)
}
