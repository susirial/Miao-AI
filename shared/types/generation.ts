export type GenerationJobState = 'queued' | 'waiting' | 'queuing' | 'generating' | 'moderating' | 'archiving' | 'success' | 'fail'

export type GenerationProvider = 'agnes-image' | 'agnes-video' | 'ark-image' | 'ark-video' | 'local'

export const GENERATION_ACTIVE_STATES = ['waiting', 'queuing', 'generating', 'moderating', 'archiving'] as const
export const GENERATION_NON_RETRYABLE_FAIL_CODES = ['submission_unknown'] as const

export type GenerationActiveState = typeof GENERATION_ACTIVE_STATES[number]

export function isGenerationFailureRetryable(failCode: unknown) {
  const code = String(failCode || '').trim()
  return !(GENERATION_NON_RETRYABLE_FAIL_CODES as readonly string[]).includes(code)
}

export function isNonRetryableGenerationFailure(failure: {
  failCode?: unknown
  retryable?: unknown
}) {
  return failure.retryable === false || !isGenerationFailureRetryable(failure.failCode)
}

export function isGenerationActive(state: GenerationJobState) {
  return (GENERATION_ACTIVE_STATES as readonly string[]).includes(state)
}

export function isGenerationQueued(state: GenerationJobState) {
  return state === 'queued'
}

/** Map provider/DB internals to a short user-safe fail reason. */
export function publicGenerationFailMessage(error: unknown, fallback = 'Generation failed') {
  const raw = String(error instanceof Error ? error.message : error || '').trim()
  if (!raw)
    return fallback
  if (/No matching document found|modifiedPaths|VersionError|E11000|SQLITE_ERROR|SQLITE_CONSTRAINT|__v\b|ObjectId\(/i.test(raw))
    return fallback
  if (/node_modules|at Object\.|at Module\.|stack trace|ECONNREFUSED|ETIMEDOUT/i.test(raw))
    return fallback
  if (raw.length > 160)
    return fallback
  return raw
}

export interface GenerationJobPublic {
  taskId: string
  projectId: string
  model: string
  category: string
  task: string
  prompt: string
  input: Record<string, unknown>
  state: GenerationJobState
  resultUrls: string[]
  failCode: string
  failMsg: string
  createdAt: string
  updatedAt: string
  completedAt: string

}

export interface GenerationJobsList {
  items: GenerationJobPublic[]
  total: number
  page: number
  limit: number
}

export function isGenerationTerminal(state: GenerationJobState) {
  return state === 'success' || state === 'fail'
}
