import type { StreamDelta } from '../ai/llm/types'
import type { ChatMessage, ToolCall } from './types'
import { completeText as registryCompleteText, streamChat as registryStreamChat } from '../ai/llm/registry'

export type { StreamDelta } from '../ai/llm/types'

export async function completeText(options: {
  signal?: AbortSignal
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
}) {
  return registryCompleteText(options)
}

export async function streamChat(options: {
  messages: ChatMessage[]
  tools: unknown[]
  requiredTool?: string
  disableTools?: boolean
  signal?: AbortSignal
  onDelta: (delta: StreamDelta) => void
}) {
  return registryStreamChat(options)
}

export function assembleToolCalls(parts: Array<{ index: number, id?: string, name?: string, arguments?: string }>): ToolCall[] {
  const byIndex = new Map<number, { id: string, name: string, arguments: string }>()
  for (const part of parts) {
    const current = byIndex.get(part.index) || { id: '', name: '', arguments: '' }
    if (part.id)
      current.id = part.id
    if (part.name)
      current.name = part.name
    if (part.arguments)
      current.arguments += part.arguments
    byIndex.set(part.index, current)
  }
  return [...byIndex.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, value]) => ({
      id: value.id || crypto.randomUUID(),
      type: 'function' as const,
      function: {
        name: value.name,
        arguments: value.arguments || '{}',
      },
    }))
}
