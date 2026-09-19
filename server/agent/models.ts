import type { SchemaProperty } from '~~/shared/types/aiModel'
import type { GenerationProvider } from '~~/shared/types/generation'
import type { AgentMediaCapabilities } from './mediaModels'
import type { AgentSession } from './session'
import type { AgentEvent, AgentImage } from './types'
import { AGENT_MODELS, agentModelInputSchema, findAgentModelTool, readModelMentions, validateAgentModelInput } from '~~/shared/utils/agentModels'
import { canonicalMediaUrl } from '../utils/storedMediaUrl.mjs'
import { annotationReferenceImages, confirmedAnnotationEdit } from './imageAnnotations'
import { availableAgentModels, resolveAgentGenerationSpec } from './mediaModels'
import { runQueuedAgentGeneration } from './queuedGeneration'

export interface ModelGeneration {
  modelId: string
  name: string
  input: Record<string, unknown>
  requestModel: string
  provider?: GenerationProvider
  protocolVersion?: string
  providerMetadata?: Record<string, unknown>
  requestBody?: Record<string, unknown>
  uncertainFields: string[]
  inputUrls: string[]
}
export function selectedModelIds(session: Pick<AgentSession, 'messages'>) {
  for (const message of [...session.messages].reverse()) {
    if (message.role !== 'user' || message.internal)
      continue
    const text = typeof message.content === 'string' ? message.content : Array.isArray(message.content) ? message.content.filter(part => part.type === 'text').map(part => part.text).join('\n') : ''
    const ids = readModelMentions(text)
    return ids
  }
  return []
}
export async function prepareModelGeneration(
  tool: string,
  json: string,
  session: AgentSession,
  caps: AgentMediaCapabilities,
): Promise<ModelGeneration> {
  const requestedModel = findAgentModelTool(tool)
  if (!requestedModel)
    throw new Error('Unknown model')
  if (!availableAgentModels().some(item => item.id === requestedModel.id))
    throw new Error(`${requestedModel.name} is not available.`)
  const annotation = confirmedAnnotationEdit(session)
  const model = annotation && requestedModel.category === 'Image'
    ? AGENT_MODELS.find(item => item.id === 'seedream/5-pro-reference-to-image')!
    : requestedModel
  if (!availableAgentModels().some(item => item.id === model.id))
    throw new Error(`${model.name} is not available.`)
  const inputSchema = agentModelInputSchema(model)
  const selected = selectedModelIds(session)
  const categorySelections = selected.filter(id => AGENT_MODELS.find(item => item.id === id)?.category === requestedModel.category)
  if (categorySelections.length && !categorySelections.includes(requestedModel.id))
    throw new Error(`The user selected ${categorySelections.join(', ')}. Use that exact model tool, or ask before changing models.`)
  const raw = JSON.parse(json)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('Model parameters must be an object')
  if (annotation && requestedModel.category === 'Image') {
    const additional = ['reference_images', 'input_urls', 'image_urls', 'image_input', 'images']
      .flatMap(key => Array.isArray(raw[key]) ? raw[key] : raw[key] === undefined ? [] : [raw[key]])
      .map((value) => {
        if (typeof value !== 'string')
          throw new Error('Annotation reference images must be valid media.')
        const url = canonicalMediaUrl(value)
        if (url)
          return url
        const media = value === 'latest'
          ? session.images.find(image => image.status === 'success' && image.kind !== 'video' && image.url)
          : session.images.find(image => image.id === value && image.status === 'success' && image.kind !== 'video' && image.url)
        if (!media)
          throw new Error('Missing annotation reference image. Select it from the project or session.')
        return media.url
      })
    for (const key of ['reference_images', 'input_urls', 'image_urls', 'image_input', 'images']) {
      if (!(key in inputSchema.properties))
        delete raw[key]
    }
    const imageField = ['reference_images', 'input_urls', 'image_urls', 'image_input', 'images']
      .find(key => key in inputSchema.properties)
    if (!imageField)
      throw new Error('Seedream reference-to-image cannot accept annotation references.')
    raw[imageField] = annotationReferenceImages(annotation, additional)
  }
  // Session IDs and latest are resolved only for actual media fields.
  for (const [key, property] of Object.entries(inputSchema.properties) as [string, SchemaProperty][]) {
    if (!key.includes('url') && property['x-ui-component'] !== 'uploaders')
      continue
    const resolve = (value: unknown) => {
      if (typeof value !== 'string')
        return value
      const url = canonicalMediaUrl(value)
      if (url)
        return url
      const media = value === 'latest'
        ? session.images.find(image => image.status === 'success' && image.url && (key.includes('video') ? image.kind === 'video' : image.kind !== 'video'))
        : session.images.find(image => image.id === value && image.status === 'success' && image.url)
      if (!media)
        throw new Error(`Missing media for ${key}. Ask the user to upload it; never invent a URL.`)
      return media.url
    }
    if (raw[key] !== undefined)
      raw[key] = Array.isArray(raw[key]) ? raw[key].map(resolve) : resolve(raw[key])
  }
  const validated = validateAgentModelInput(model, raw)
  const spec = await resolveAgentGenerationSpec(model, validated, caps)
  return {
    modelId: model.id,
    name: String(raw._name || model.name).slice(0, 100),
    input: spec.input,
    requestModel: spec.backendModelId,
    provider: spec.provider,
    protocolVersion: spec.protocolVersion,
    providerMetadata: spec.providerMetadata,
    requestBody: spec.requestBody,
    uncertainFields: Array.isArray(raw._uncertain_fields) ? raw._uncertain_fields.filter((key: unknown) => typeof key === 'string' && key in inputSchema.properties) : [],
    inputUrls: Object.entries(validated).filter(([key]) => key.includes('url') || inputSchema.properties[key]?.['x-ui-component'] === 'uploaders').flatMap(([, value]) => Array.isArray(value) ? value : [value]).map(canonicalMediaUrl).filter(Boolean),
  }
}
export function modelConfirmation(args: ModelGeneration) {
  const model = AGENT_MODELS.find(model => model.id === args.modelId)!
  return {
    name: args.name,
    modelName: model.name,
    task: model.task,
    inputUrls: args.inputUrls,
    params: {
      prompt: String(args.input.prompt || ''),
      aspectRatio: String(args.input.aspect_ratio || ''),
      resolution: String(args.input.resolution || ''),
      duration: Number(args.input.duration) || undefined,
      modelId: args.modelId,
      modelInput: args.input,
    },
  }
}
export async function runModelGeneration(session: AgentSession, callId: string, args: ModelGeneration, emit: (event: AgentEvent) => void, signal?: AbortSignal) {
  const model = AGENT_MODELS.find(model => model.id === args.modelId)!
  let resolved
  try {
    resolved = args.provider && args.protocolVersion && args.requestBody
      ? {
          modelId: model.id,
          modelName: model.name,
          category: model.category,
          task: model.task,
          input: args.input,
          provider: args.provider,
          backendModelId: args.requestModel,
          protocolVersion: args.protocolVersion,
          providerMetadata: args.providerMetadata || {},
          requestBody: args.requestBody,
        }
      : await resolveAgentGenerationSpec(model, args.input)
  }
  catch (error) {
    const message = error instanceof Error ? error.message : 'Generation could not be prepared'
    emit({ type: 'tool', name: model.id, status: 'start', callId })
    emit({ type: 'tool', name: model.id, status: 'end', callId })
    return JSON.stringify({ ok: false, error: message })
  }
  const inputSchema = agentModelInputSchema(model)
  const mediaUrls = (kind: 'image' | 'video' | 'audio') => Object.entries(args.input)
    .filter(([key]) => (key.includes('url') || inputSchema.properties[key]?.['x-ui-component'] === 'uploaders') && (kind === 'image' ? !key.includes('video') && !key.includes('audio') : key.includes(kind)))
    .flatMap(([, value]) => Array.isArray(value) ? value : [value])
    .map(canonicalMediaUrl)
    .filter(Boolean)
  const image: AgentImage = {
    id: callId,
    name: args.name,
    modelId: model.id,
    modelInput: args.input,
    kind: model.category === 'Video' ? 'video' : 'still',
    status: 'generating',
    prompt: String(args.input.prompt || ''),
    aspectRatio: String(args.input.aspect_ratio || ''),
    resolution: String(args.input.resolution || ''),
    duration: Number(args.input.duration) || undefined,
    inputUrls: mediaUrls('image'),
    referenceVideoUrls: mediaUrls('video'),
    url: '',
    error: '',
  }
  return runQueuedAgentGeneration({
    session,
    callId,
    toolName: model.id,
    image,
    spec: resolved,
    emit,
    signal,
  })
}
