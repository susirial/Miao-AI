import type { LlmSnapshot } from '../ai/llm/types'
import { captureLlmSnapshot } from '../ai/llm/registry'

export const agentEnv = {
  get textProvider() { return captureLlmSnapshot().provider },
}

const PROVIDER_NAMES: Record<LlmSnapshot['provider'], string> = {
  ark: 'Ark',
  deepseek: 'DeepSeek',
  zai: 'Z.ai',
  agnes: 'Agnes',
}

export function assertAgentSecrets(snapshot: LlmSnapshot = captureLlmSnapshot()) {
  const providerName = PROVIDER_NAMES[snapshot.provider]
  if (!snapshot.apiKey)
    throw new Error(`Configure the ${providerName} API key for the selected text model in Service connection.`)
  if (!snapshot.textReady)
    throw new Error(`Test the ${providerName} connection for the selected text model before sending a message.`)
}
