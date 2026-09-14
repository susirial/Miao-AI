import type { TextModelCatalogEntry } from '../../../shared/types/provider'
import type { ChatMessage } from '../../agent/types'

export interface StreamToolCallDelta {
  index: number
  id?: string
  name?: string
  arguments?: string
}

export interface StreamDelta {
  content?: string
  reasoning?: string
  toolCalls?: StreamToolCallDelta[]
  finishReason?: string | null
}

export interface ProviderCapabilities {
  vision: boolean
  tools: boolean
  toolChoice: boolean
  parallelToolCalls: boolean
  reasoning: boolean
}

export interface LlmSnapshot {
  provider: TextModelCatalogEntry['provider']
  catalogModelId: string
  model: string
  apiKey: string
  textReady: boolean
  capabilities: ProviderCapabilities
  settingsRevision: string
}

export interface CompleteTextOptions {
  signal?: AbortSignal
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
}

export interface StreamChatOptions {
  messages: ChatMessage[]
  tools: unknown[]
  requiredTool?: string
  disableTools?: boolean
  signal?: AbortSignal
  onDelta: (delta: StreamDelta) => void
}

export interface LlmAdapter {
  readonly provider: LlmSnapshot['provider']
  readonly capabilities: ProviderCapabilities
  completeText: (snapshot: LlmSnapshot, options: CompleteTextOptions) => Promise<string>
  streamChat: (snapshot: LlmSnapshot, options: StreamChatOptions) => Promise<void>
}
