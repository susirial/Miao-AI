export type TextProviderId = 'ark' | 'deepseek' | 'zai'
export type ProviderId = TextProviderId
export type ServiceCapability = 'text' | 'image' | 'video'

export interface TextModelCapabilities {
  vision: boolean
  tools: boolean
  reasoning: boolean
}

export interface TextModelCatalogEntry {
  id: string
  name: string
  provider: TextProviderId
  upstreamModelId: string
  capabilities: TextModelCapabilities
  description: string
}

export interface PublicProviderStatus {
  configured: boolean
  ok: boolean
  checkedAt: string
  validation: 'text-request'
  mediaGenerationVerified: false
}
