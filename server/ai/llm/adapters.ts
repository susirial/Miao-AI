import type { TextProviderId } from '../../../shared/types/provider'
import type { ImageMaterialization } from './materialize'
import type { CompleteTextOptions, LlmAdapter, LlmSnapshot, ProviderCapabilities, StreamChatOptions } from './types'
import { assertValidToolTranscript } from '../../agent/toolTranscript'
import { materializeMessages } from './materialize'
import { assertChatResponse, consumeChatCompletionSse } from './sse'

interface AdapterConfig {
  provider: TextProviderId
  name: string
  endpoint: string
  imageMaterialization: ImageMaterialization
  capabilities: ProviderCapabilities
}

export const PROVIDER_CONFIGS: Record<TextProviderId, AdapterConfig> = {
  ark: {
    provider: 'ark',
    name: 'Ark',
    endpoint: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
    imageMaterialization: 'data-url',
    capabilities: { vision: true, tools: true, toolChoice: true, parallelToolCalls: true, reasoning: true },
  },
  deepseek: {
    provider: 'deepseek',
    name: 'DeepSeek',
    endpoint: 'https://api.deepseek.com/chat/completions',
    imageMaterialization: 'data-url',
    capabilities: { vision: true, tools: true, toolChoice: true, parallelToolCalls: false, reasoning: true },
  },
  zai: {
    provider: 'zai',
    name: 'Z.ai',
    endpoint: 'https://api.z.ai/api/paas/v4/chat/completions',
    imageMaterialization: 'reject',
    capabilities: { vision: false, tools: true, toolChoice: true, parallelToolCalls: false, reasoning: true },
  },
  agnes: {
    provider: 'agnes',
    name: 'Agnes',
    endpoint: 'https://apihub.agnes-ai.com/v1/chat/completions',
    imageMaterialization: 'remote-url',
    capabilities: { vision: true, tools: true, toolChoice: true, parallelToolCalls: false, reasoning: true },
  },
}

function requestHeaders(snapshot: LlmSnapshot) {
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${snapshot.apiKey}`,
    'Content-Type': 'application/json',
  }
  return headers
}

export async function buildProviderRequest(
  snapshot: LlmSnapshot,
  kind: 'complete' | 'stream',
  options: CompleteTextOptions | StreamChatOptions,
) {
  const config = PROVIDER_CONFIGS[snapshot.provider]
  assertValidToolTranscript(options.messages)
  const body: Record<string, unknown> = {
    model: snapshot.model,
    messages: await materializeMessages(options.messages, config.imageMaterialization, options.signal),
    stream: kind === 'stream',
  }
  let forcedTool = false

  if (kind === 'complete') {
    const complete = options as CompleteTextOptions
    body.temperature = complete.temperature ?? 0.2
    body.max_tokens = complete.maxTokens ?? 32
  }
  else {
    const stream = options as StreamChatOptions
    body.temperature = 0.4
    const canUseTools = snapshot.capabilities.tools && stream.tools.length > 0
    const listedRequiredTool = stream.requiredTool
      && stream.tools.some(tool => Boolean(tool && typeof tool === 'object' && 'function' in tool && (tool as { function?: { name?: string } }).function?.name === stream.requiredTool))
      ? stream.requiredTool
      : undefined
    if (canUseTools) {
      // Withholding the tools is supported everywhere; tool_choice "none" is not.
      if (stream.disableTools) {
        delete body.tools
      }
      else {
        body.tools = stream.tools
        if (snapshot.capabilities.toolChoice) {
          body.tool_choice = listedRequiredTool
            ? { type: 'function', function: { name: listedRequiredTool } }
            : 'auto'
        }
        else if (listedRequiredTool) {
          throw new Error(`${config.name} does not support required tool choice.`)
        }
        if (snapshot.capabilities.parallelToolCalls)
          body.parallel_tool_calls = !listedRequiredTool
      }
    }
    forcedTool = Boolean(canUseTools && !stream.disableTools && listedRequiredTool)
  }

  if (snapshot.provider === 'zai') {
    // Z.ai rejects a forced tool_choice while thinking is enabled.
    body.thinking = { type: forcedTool ? 'disabled' : 'enabled' }
    body.reasoning_effort = kind === 'stream' ? 'high' : 'low'
  }
  else if (snapshot.provider === 'agnes') {
    // The recorded 2.5 Flash probe confirms reasoning_content and forced tools work together.
    body.chat_template_kwargs = { enable_thinking: kind === 'stream' }
  }

  return {
    url: config.endpoint,
    init: {
      method: 'POST',
      signal: options.signal,
      headers: requestHeaders(snapshot),
      body: JSON.stringify(body),
    } satisfies RequestInit,
  }
}

function createAdapter(config: AdapterConfig): LlmAdapter {
  return {
    provider: config.provider,
    capabilities: config.capabilities,
    async completeText(snapshot, options) {
      const request = await buildProviderRequest(snapshot, 'complete', options)
      const response = await fetch(request.url, request.init)
      await assertChatResponse(response, config.name)
      const payload = await response.json() as {
        choices?: Array<{ message?: { content?: string | null } }>
        error?: string | { message?: string }
      }
      if (payload.error)
        throw new Error(typeof payload.error === 'string' ? payload.error : payload.error.message || `${config.name} returned an error.`)
      return String(payload.choices?.[0]?.message?.content || '').trim()
    },
    async streamChat(snapshot, options) {
      const request = await buildProviderRequest(snapshot, 'stream', options)
      const response = await fetch(request.url, request.init)
      await consumeChatCompletionSse({
        response,
        providerName: config.name,
        signal: options.signal,
        onDelta: options.onDelta,
      })
    },
  }
}

export const LLM_ADAPTERS: Record<TextProviderId, LlmAdapter> = {
  ark: createAdapter(PROVIDER_CONFIGS.ark),
  deepseek: createAdapter(PROVIDER_CONFIGS.deepseek),
  zai: createAdapter(PROVIDER_CONFIGS.zai),
  agnes: createAdapter(PROVIDER_CONFIGS.agnes),
}
