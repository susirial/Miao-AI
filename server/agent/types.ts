import type { SEEDREAM_5_ASPECT_RATIOS, SEEDREAM_5_RESOLUTIONS } from '~~/shared/constants/aiModels'
import { SEEDANCE_2_ASPECT_RATIOS, SEEDANCE_2_DURATIONS, SEEDANCE_2_RESOLUTIONS } from '~~/shared/utils/seedance2'

export { SEEDANCE_2_ASPECT_RATIOS, SEEDANCE_2_DURATIONS, SEEDANCE_2_RESOLUTIONS }

export const AGENT_VIDEO_DURATIONS = SEEDANCE_2_DURATIONS
export const AGENT_QUALITIES = ['high', 'economy', 'hobby', 'custom'] as const
export const AGENT_CONFIRM_POLICIES = ['auto', 'when_needed', 'always'] as const
export const VIDEO_FAMILIES = ['seedance-2'] as const

export const UNCERTAIN_FIELDS = ['prompt', 'aspect_ratio', 'resolution', 'duration'] as const

export type Seedream5AspectRatio = typeof SEEDREAM_5_ASPECT_RATIOS[number]
export type Seedream5Resolution = typeof SEEDREAM_5_RESOLUTIONS[number]
export type Seedance2AspectRatio = typeof SEEDANCE_2_ASPECT_RATIOS[number]
export type Seedance2Resolution = typeof SEEDANCE_2_RESOLUTIONS[number]
export type Seedance2Duration = typeof SEEDANCE_2_DURATIONS[number]
export type AgentQuality = typeof AGENT_QUALITIES[number]
export type AgentConfirmPolicy = typeof AGENT_CONFIRM_POLICIES[number]
export type VideoFamily = typeof VIDEO_FAMILIES[number]
export type UncertainField = typeof UNCERTAIN_FIELDS[number]

export interface GenerateImageArgs {
  name?: string
  prompt: string
  aspect_ratio: Seedream5AspectRatio
  resolution: Seedream5Resolution
  input_urls: string[]
  reference_images: string[]
  uncertain_fields: UncertainField[]
  reason: string
}

export interface GenerateVideoArgs {
  name?: string
  prompt: string
  aspect_ratio: Seedance2AspectRatio
  resolution: Seedance2Resolution
  duration: number
  generate_audio: boolean
  family: VideoFamily
  first_frame: string
  last_frame: string
  reference_images: string[]
  reference_videos: string[]
  uncertain_fields: UncertainField[]
}

export interface ConcatVideoArgs {
  video_urls: string[]
}

export interface ResolvedGenerateVideo {
  name?: string
  prompt: string
  aspect_ratio: Seedance2AspectRatio
  resolution: Seedance2Resolution
  duration: number
  generate_audio: boolean
  family: VideoFamily
  first_frame_url?: string
  last_frame_url?: string
  reference_image_urls?: string[]
  reference_video_urls?: string[]
  uncertain_fields?: UncertainField[]
}

export type AgentImageKind = 'still' | 'upload' | 'video'

export interface AgentImage {
  modelId?: string
  modelInput?: Record<string, unknown>
  name?: string
  id: string
  kind?: AgentImageKind
  status: 'generating' | 'success' | 'fail'
  prompt: string
  aspectRatio: string
  resolution: string
  url: string
  error: string
  failCode?: string
  retryable?: boolean
  sourceUrl?: string
  inputUrls?: string[]
  referenceVideoUrls?: string[]
  duration?: number
  videoMode?: 'text' | 'image' | 'reference' | 'concat'
  videoFamily?: VideoFamily
  providerTaskId?: string
}

export interface ConfirmationPayload {
  jobs?: Array<{
    id: string
    name: string
    modelName: string
    task: string
    inputUrls: string[]
    params: ConfirmationPayload['params']
  }>
  id: string
  kind: 'image' | 'video' | 'mixed'
  reason: string
  uncertainFields: string[]
  count: number

  modelName?: string
  task?: string
  inputUrls?: string[]
  approvedBy?: 'agent' | 'user'
  params: {
    modelId?: string
    modelInput?: Record<string, unknown>
    prompt: string
    aspectRatio: string
    resolution: string
    duration?: number
    videoMode?: 'text' | 'image' | 'reference'
    videoFamily?: VideoFamily
  }
}

export interface ChoiceOption {
  id: string
  label: string
  description?: string
  custom?: boolean
}

export interface ChoiceQuestion {
  id: string
  title?: string
  prompt: string
  options: ChoiceOption[]
  recommendedId?: string
}

export interface ChoicePayload {
  id: string
  prompt: string
  recommendation?: string
  questions: ChoiceQuestion[]
}

export interface ChoiceAnswer {
  questionId: string
  optionId?: string
  label?: string
  text?: string
  skipped?: boolean
}

export interface AskUserArgs {
  prompt: string
  recommendation: string
  questions: ChoiceQuestion[]
}

export type AgentEvent
  = | { type: 'session', sessionId: string }

    | { type: 'text', delta: string }
    | { type: 'text_replace', delta: string }
    | { type: 'status', status: 'thinking' | 'calling_tool' | 'generating' | 'queued' | 'idle' }
    | { type: 'title', title: string }
    | { type: 'queue', limit: number, active: number, message: string }
    | { type: 'tool', name: string, status: 'start' | 'end', callId: string }
    | { type: 'confirmation', confirmation: ConfirmationPayload }
    | { type: 'choice', choice: ChoicePayload }
    | { type: 'image', image: AgentImage, replay?: boolean }
    | { type: 'error', message: string, remaining?: number, required?: number }
    | { type: 'done' }

export type UserContentPart
  = | { type: 'text', text: string }
    | { type: 'image_url', image_url: { url: string } }

export interface ChatMessage {
  /** Stable public-history identity; excluded from provider requests. */
  historyId?: string
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | UserContentPart[] | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
  /** LLM-only turn; never surface in the chat UI transcript. */
  internal?: boolean
}

export interface ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export interface ConfirmBody {
  confirmationId: string
  action: 'confirm' | 'cancel' | 'abort'
  params?: {
    prompt?: string
    aspectRatio?: string
    resolution?: string
    duration?: number
  }
}

export interface ChoiceBody {
  choiceId: string
  action: 'submit' | 'skip'
  answers?: ChoiceAnswer[]
}
