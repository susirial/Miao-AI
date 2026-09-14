import type { ServiceSettings } from '../../utils/serviceSettings'
import type { CompleteTextOptions, LlmSnapshot, StreamChatOptions } from './types'
import { AsyncLocalStorage } from 'node:async_hooks'
import { DEFAULT_TEXT_MODEL_ID, getTextModel } from '../../../shared/constants/modelCatalog'
import { readServiceSettings } from '../../utils/serviceSettings'
import { LLM_ADAPTERS } from './adapters'

const requestSnapshot = new AsyncLocalStorage<LlmSnapshot>()

export function captureLlmSnapshot(settings: ServiceSettings = readServiceSettings()): LlmSnapshot {
  const catalogModel = getTextModel(settings.selectedTextModel) ?? getTextModel(DEFAULT_TEXT_MODEL_ID)!
  const adapter = LLM_ADAPTERS[catalogModel.provider]
  const key = {
    ark: settings.arkKey,
    deepseek: settings.deepSeekKey,
    zai: settings.zaiKey,
  }[catalogModel.provider]
  const textReady = {
    ark: Boolean(settings.arkCheckedAt) && settings.arkOk,
    deepseek: Boolean(settings.deepSeekCheckedAt) && settings.deepSeekOk,
    zai: Boolean(settings.zaiCheckedAt) && settings.zaiOk,
  }[catalogModel.provider]
  return Object.freeze({
    provider: catalogModel.provider,
    catalogModelId: catalogModel.id,
    model: catalogModel.upstreamModelId,
    apiKey: key,
    textReady,
    capabilities: Object.freeze({
      vision: catalogModel.capabilities.vision && adapter.capabilities.vision,
      tools: catalogModel.capabilities.tools && adapter.capabilities.tools,
      toolChoice: adapter.capabilities.toolChoice,
      parallelToolCalls: adapter.capabilities.parallelToolCalls,
      reasoning: catalogModel.capabilities.reasoning && adapter.capabilities.reasoning,
    }),
    settingsRevision: settings.revision,
  })
}

export function activeLlmSnapshot() {
  return requestSnapshot.getStore() ?? captureLlmSnapshot()
}

export function withLlmSnapshot<T>(snapshot: LlmSnapshot, run: () => T): T {
  return requestSnapshot.run(snapshot, run)
}

export function completeText(options: CompleteTextOptions) {
  const snapshot = activeLlmSnapshot()
  return LLM_ADAPTERS[snapshot.provider].completeText(snapshot, options)
}

export function streamChat(options: StreamChatOptions) {
  const snapshot = activeLlmSnapshot()
  return LLM_ADAPTERS[snapshot.provider].streamChat(snapshot, options)
}
