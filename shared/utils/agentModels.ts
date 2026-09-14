import type { AiModelConfig, SchemaProperty } from '../types/aiModel'
import { AI_MODELS, COMPANY_LOGOS, MODEL_COMPANIES } from '../constants/aiModels'

// One catalog for the composer, model tools, validation metadata.
export const AGENT_MODELS: AiModelConfig[] = [...AI_MODELS]

export function agentModelToolName(id: string) {
  return `model_${id.replace(/[^a-z0-9]/gi, '_')}`
}
export function findAgentModelTool(tool: string) {
  return AGENT_MODELS.find(model => agentModelToolName(model.id) === tool)
}
export function agentModelLogo(model: AiModelConfig) {
  return COMPANY_LOGOS[MODEL_COMPANIES[model.name] || ''] || ''
}
export function modelMention(model: AiModelConfig) {
  return `@[${model.name} · ${model.task}](model:${model.id})`
}
export function readModelMentions(text: string) {
  return [...new Set([...text.matchAll(/@\[[^\]]+\]\(model:([^\s)]+)\)/g)].map(match => match[1]!))]
    .filter(id => AGENT_MODELS.some(model => model.id === id))
}
export function stripModelMentions(text: string) {
  return text.replace(/@\[[^\]]+\]\(model:[^\s)]+\)\s*/g, '')
}
export function displayModelMentions(text: string) {
  return text.replace(/@\[([^\]]+)\]\(model:[^\s)]+\)/g, '@$1')
}

function toolProperty(property: SchemaProperty): Record<string, unknown> {
  return Object.fromEntries(Object.entries(property)
    .filter(([key]) => !key.startsWith('x-') && key !== 'disabled')
    .map(([key, value]) => [key, key === 'items' ? toolProperty(value as SchemaProperty) : value]))
}

export function registeredModelToolsFor(models: readonly AiModelConfig[]) {
  return models.map((model) => {
    const inputSchema = agentModelInputSchema(model)
    return {
      type: 'function' as const,
      function: {
        name: agentModelToolName(model.id),
        description: `${model.name}: ${model.task}. Exact model ID: ${model.id}. Use when explicitly requested or in Custom mode. Required media must come from the user or actual session results. Apply documented defaults for omitted settings; ask_user for missing decisions, ask for uploads in chat for missing media. Never switch the user's requested model silently.`,
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ...Object.fromEntries(Object.entries(inputSchema.properties).filter(([key]) => key !== 'end_user_id').map(([key, prop]) => [key, toolProperty(prop as SchemaProperty)])),
            _name: { type: 'string', description: 'User-visible output title. Follow the latest explicit language preference; otherwise match the latest natural-language user request (retain conversation language for attachment-only requests). Ignore the language of image text, references, @model/task names, tool results, and previous assistant output. English request => English title; Chinese request => Chinese title.' },
            _uncertain_fields: { type: 'array', items: { type: 'string' }, description: 'Inferred settings needing user review under Review when needed.' },
          },
          required: inputSchema.required || [],
        },
      },
    }
  })
}

export const registeredModelTools = registeredModelToolsFor(AGENT_MODELS)

export function agentModelInputSchema(model: AiModelConfig) {
  return model.schema.components.schemas.Input
}

function validateValue(key: string, value: unknown, schema: SchemaProperty, errors: string[]) {
  const type = schema.type
  if (type === 'array') {
    if (!Array.isArray(value)) {
      errors.push(`${key} must be an array`)
      return
    }
    if (schema.minItems !== undefined && value.length < schema.minItems)
      errors.push(`${key} needs at least ${schema.minItems} items`)
    if (schema.maxItems !== undefined && value.length > schema.maxItems)
      errors.push(`${key} allows at most ${schema.maxItems} items`)
    if (schema.items)
      value.forEach((item, i) => validateValue(`${key}[${i}]`, item, schema.items!, errors))
  }
  else if (type === 'string') {
    if (typeof value !== 'string') {
      errors.push(`${key} must be a string`)
      return
    }
    if (schema.minLength !== undefined && value.trim().length < schema.minLength)
      errors.push(`${key} is too short`)
    if (schema.maxLength !== undefined && value.length > schema.maxLength)
      errors.push(`${key} is too long`)
  }
  else if (type === 'boolean' && typeof value !== 'boolean') {
    errors.push(`${key} must be a boolean`)
  }
  else if (type === 'number' || type === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value) || (type === 'integer' && !Number.isInteger(value))) {
      errors.push(`${key} must be ${type}`)
      return
    }
    if (schema.minimum !== undefined && value < schema.minimum)
      errors.push(`${key} must be >= ${schema.minimum}`)
    if (schema.maximum !== undefined && value > schema.maximum)
      errors.push(`${key} must be <= ${schema.maximum}`)
  }
  if (schema.enum && !schema.enum.includes(value as string | number))
    errors.push(`${key} must be one of: ${schema.enum.join(', ')}`)
}

export function validateAgentModelInput(model: AiModelConfig, raw: Record<string, unknown>) {
  const schema = model.schema.components.schemas.Input
  const input: Record<string, unknown> = {}
  const errors: string[] = []
  for (const key of Object.keys(raw)) {
    if (!(key in schema.properties) && key !== '_name' && key !== '_uncertain_fields')
      errors.push(`Unknown parameter: ${key}`)
  }
  for (const [key, prop] of Object.entries(schema.properties)) {
    const value = raw[key] ?? prop.default
    if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) {
      if (schema.required?.includes(key))
        errors.push(`Missing required parameter: ${key}`)
      continue
    }
    validateValue(key, value, prop, errors)
    input[key] = value
  }
  if (errors.length)
    throw new Error(`${model.name} (${model.task}): ${errors.join('; ')}. Ask the user for missing information or correct the parameters before generation. `)
  return input
}
