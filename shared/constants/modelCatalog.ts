import type { TextModelCatalogEntry } from '../types/provider'

export const DEFAULT_TEXT_MODEL_ID = 'ark/seed-2.1-pro'

export const TEXT_MODEL_CATALOG: readonly TextModelCatalogEntry[] = [
  {
    id: DEFAULT_TEXT_MODEL_ID,
    name: 'Seed 2.1 Pro',
    provider: 'ark',
    upstreamModelId: 'doubao-seed-2-1-pro-260628',
    capabilities: { vision: true, tools: true, reasoning: true },
    description: 'Vision, tools, and reasoning',
  },
  {
    id: 'ark/seed-2.1-turbo',
    name: 'Seed 2.1 Turbo',
    provider: 'ark',
    upstreamModelId: 'doubao-seed-2-1-turbo-260628',
    capabilities: { vision: true, tools: true, reasoning: true },
    description: 'Faster vision model',
  },
  {
    id: 'deepseek/deepseek-v4.1-flash',
    name: 'DeepSeek V4.1 Flash',
    provider: 'deepseek',
    upstreamModelId: 'deepseek-flash',
    capabilities: { vision: true, tools: true, reasoning: true },
    description: 'DeepSeek official · Vision and tools',
  },
  {
    id: 'zai/glm-5.3',
    name: 'GLM 5.3',
    provider: 'zai',
    upstreamModelId: 'glm-5.3',
    capabilities: { vision: false, tools: true, reasoning: true },
    description: 'Z.ai official · Text only, reasoning always on',
  },
] as const

export function getTextModel(modelId: string) {
  return TEXT_MODEL_CATALOG.find(model => model.id === modelId)
}
