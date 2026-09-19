import type { AgentMediaCapabilities } from './mediaModels'
import type {
  AgentImage,
  AskUserArgs,
  ChoiceOption,
  ChoiceQuestion,
  ConcatVideoArgs,
  GenerateImageArgs,
  GenerateVideoArgs,
  ResolvedGenerateVideo,
  UncertainField,
  VideoFamily,
} from './types'
import { AGNES_IMAGE_RATIOS, AGNES_IMAGE_SIZE_TIERS, AGNES_VIDEO_ASPECT_RATIOS, SEEDREAM_5_ASPECT_RATIOS, SEEDREAM_5_RESOLUTIONS } from '~~/shared/constants/aiModels'
import { withCustomChoiceOption } from '~~/shared/utils/agentChoices'
import { agnesPublicImageRequiredError } from '../utils/agnesVideoUrls'
import { canonicalMediaUrl, storedMediaKey } from '../utils/storedMediaUrl.mjs'
import { exportZipTool } from './exportZip'
import { isSeedance2AspectRatio, isSeedance2Resolution } from './seedance2'
import { AGENT_VIDEO_DURATIONS, SEEDANCE_2_ASPECT_RATIOS, SEEDANCE_2_RESOLUTIONS, UNCERTAIN_FIELDS } from './types'

export const GENERATE_IMAGE_TOOL = 'generate_image'
export const GENERATE_VIDEO_TOOL = 'generate_video'
export const CONCAT_VIDEO_TOOL = 'concat_videos'
export const ASK_USER_TOOL = 'ask_user'
export const MAX_CONCAT_CLIPS = 20
export const MAX_ASK_QUESTIONS = 6
export const MAX_ASK_OPTIONS = 8

export const openAiTools = [
  exportZipTool,
  {
    type: 'function',
    function: {
      name: GENERATE_IMAGE_TOOL,
      description: 'Generate or edit one still with the active image backend. The runtime shows and queues the actual model. Call once per image; submit independent images in the SAME turn. To edit one still, pass input_urls (at most one). To compose a new scene from identity or style stills, pass reference_images. Do not set both. Omit both for text-to-image.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', description: 'Required short story/action title in the user preferred conversation language, e.g. Shot 6 · Hiding in the cave. English request means English title, including image-to-video. Do not copy the language of source asset names, tool output, or internal examples; translate descriptive titles when reusing them. Include what happens, not just shot_6. Use the actual storyboard number; never reuse a number for a different scene.' },
          prompt: {
            type: 'string',
            description: 'Detailed prompt describing the image or the edit, written in one single language: the user\'s preferred language. Any text that should appear inside the image stays in the language the user asked for.',
          },
          aspect_ratio: {
            type: 'string',
            enum: [...SEEDREAM_5_ASPECT_RATIOS],
            description: 'Output aspect ratio. Use auto when editing unless the user asked for a specific crop.',
          },
          resolution: {
            type: 'string',
            enum: [...SEEDREAM_5_RESOLUTIONS],
            description: 'Output resolution. The runtime applies the active backend and quality preference (normally Economy/Hobby = 1K, High quality = 2K).',
          },
          input_urls: {
            type: 'array',
            description: 'One source still to edit. Public HTTP URL, session image id, or "latest". Empty or omitted means not an edit. Do not set this when using reference_images. Passing two or more values is treated as reference-to-image.',
            items: { type: 'string' },
          },
          reference_images: {
            type: 'array',
            description: 'Identity or style stills for a new scene (reference-to-image). Public HTTP URLs, session image ids, or "latest". Pass at most 10, in the order your prompt numbers them as image 1, image 2, and so on. Do not set input_urls when using this. Refer to every reference by type and position, numbering each type from 1, and write those tokens in the language of the prompt. Never identify a reference by URL, session id, or asset id.',
            items: { type: 'string' },
          },
          uncertain_fields: {
            type: 'array',
            description: 'Hint which inferred fields the user may want to edit. When generation confirmation is "review when needed", a non-empty list pauses for a click; empty auto-approves. This does not start generation by itself.',
            items: {
              type: 'string',
              enum: [...UNCERTAIN_FIELDS],
            },
          },
          reason: {
            type: 'string',
            description: 'Optional one-sentence hint shown on the confirmation card.',
          },
        },
        required: ['name', 'prompt', 'aspect_ratio', 'resolution', 'uncertain_fields'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: GENERATE_VIDEO_TOOL,
      description: 'Generate one video with the active video backend. Use first_frame for image-to-video and reference_images / reference_videos for reference-to-video. Omit both only for text-to-video. Call once per video. The runtime shows and queues the actual model and applies backend-compatible parameters.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', description: 'Required short story/action title in the user preferred conversation language, e.g. Shot 6 · Hiding in the cave. English request means English title, including image-to-video. Do not copy the language of source asset names, tool output, or internal examples; translate descriptive titles when reusing them. Include what happens, not just shot_6. Use the actual storyboard number; never reuse a number for a different scene.' },
          prompt: {
            type: 'string',
            description: 'Write motion and production instructions — subject, camera, atmosphere — in one single language: the user\'s preferred language. Dialogue, narration, and lyrics normally use that same language, leaving no language mixing in the prompt. When the user chose a different spoken language, keep the surrounding prompt in their preferred language, name the chosen language explicitly, and quote the actual lines in it. Preserve that choice across shots and retries. At least 3 characters. Refer to every reference by type and position, numbering each type from 1 in the order you pass it (image 1, image 2, video 1), and write those tokens in the language of the prompt. Never identify a reference by URL, session id, or asset id. For reference-to-video, give each numbered reference a role (character, product, style, camera, first/last frame if needed). For a video edit, name the source clip by its token, describe only what changes, and say which still replaces whom.',
          },
          first_frame: {
            type: 'string',
            description: 'Start frame for image-to-video: public HTTP URL, session image id, or "latest". Empty means not image-to-video. Do not set this when using reference_images.',
          },
          last_frame: {
            type: 'string',
            description: 'Optional end frame URL, session image id, or empty. Image-to-video only.',
          },
          reference_images: {
            type: 'array',
            description: 'Reference stills for reference-to-video (character, product, style). Public HTTP URLs, session image ids, or "latest". Pass at most 9, in the order your prompt numbers them as image 1, image 2, and so on; the runtime trims anything beyond the active model limit, which drops the tail of that numbering. Do not set first_frame when using this.',
            items: { type: 'string' },
          },
          reference_videos: {
            type: 'array',
            description: 'Reference clips for reference-to-video. Put the source clip here when editing a video. Public HTTP URLs, session video ids, or "latest". Pass at most 3, in the order your prompt numbers them as video 1, video 2, and so on; the runtime trims anything beyond the active model limit, which drops the tail of that numbering.',
            items: { type: 'string' },
          },
          aspect_ratio: {
            type: 'string',
            enum: [...SEEDANCE_2_ASPECT_RATIOS],
            description: 'Image-to-video: always adaptive. Reference-to-video or text-to-video: 16:9 unless the user named a ratio. Default adaptive for image-to-video, 16:9 otherwise.',
          },
          resolution: {
            type: 'string',
            enum: [...SEEDANCE_2_RESOLUTIONS],
            description: 'Use 480p unless the user named 720p, 1080p, or 4k. The runtime clamps this to the selected backend and model.',
          },
          duration: {
            type: 'integer',
            enum: [...AGENT_VIDEO_DURATIONS],
            description: 'Length in seconds. The runtime clamps this to the actual model; Ark Seedance 2 uses 4-15 seconds. Default 5.',
          },
          generate_audio: {
            type: 'boolean',
            description: 'Whether to generate synchronized audio. Default true.',
          },
          uncertain_fields: {
            type: 'array',
            description: 'Hint which inferred fields the user may want to edit. When generation confirmation is "review when needed", a non-empty list pauses for a click; empty auto-approves.',
            items: {
              type: 'string',
              enum: [...UNCERTAIN_FIELDS],
            },
          },
        },
        required: ['name', 'prompt'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: CONCAT_VIDEO_TOOL,
      description: 'Concatenate existing clips into one longer video with ffmpeg. Use after a storyboard of short Seedance clips. Pass the clip URLs or session video ids in story order. Do not mix with generate_video in the same turn. ',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          video_urls: {
            type: 'array',
            description: 'Clips in story order. Public HTTP URLs or session video ids. At least 2, at most 20. Do not use "latest".',
            items: { type: 'string' },
          },
        },
        required: ['video_urls'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: ASK_USER_TOOL,
      description: 'Show clickable choice cards in chat when you need a discrete pick (style, ratio, character, confirm a plan, yes/no). Do not list the options in markdown — the card shows them. Skip is always on the card so they can let you decide. Always include an Other option with allow_custom: true for every question so the user can type their own answer. Do not mix with generation tools or concat_videos in the same turn. After they answer, continue from the tool result.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          prompt: {
            type: 'string',
            description: 'Short intro above the cards, in the user\'s preferred language. Do not list the options here.',
          },
          recommendation: {
            type: 'string',
            description: 'In the user\'s preferred language, what you will do if they skip. Shown as a hint on the card.',
          },
          questions: {
            type: 'array',
            description: 'One or more related questions. Prefer one call with several questions over several calls.',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: {
                  type: 'string',
                  description: 'Stable id for this question, e.g. style or aspect_ratio.',
                },
                title: {
                  type: 'string',
                  description: 'Optional short section label, in the user\'s preferred language, e.g. Visual style.',
                },
                prompt: {
                  type: 'string',
                  description: 'The question, in the user\'s preferred language.',
                },
                recommended: {
                  type: 'string',
                  description: 'Option id you would pick if they skip this question.',
                },
                options: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      id: { type: 'string' },
                      label: { type: 'string', description: 'User-facing option label in the user\'s preferred language.' },
                      description: { type: 'string', description: 'User-facing option description in the user\'s preferred language.' },
                      allow_custom: {
                        type: 'boolean',
                        description: 'If true, selecting this option shows a text field. Use for Other.',
                      },
                    },
                    required: ['id', 'label'],
                  },
                },
              },
              required: ['id', 'prompt', 'options'],
            },
          },
        },
        required: ['questions'],
      },
    },
  },
]

export function requiredToolIfListed(requiredTool: string | undefined, tools: Array<{ function?: { name?: string } }>) {
  if (!requiredTool)
    return undefined
  return tools.some(tool => tool.function?.name === requiredTool) ? requiredTool : undefined
}

export function selectAgentLoopTools(options: {
  caps: AgentMediaCapabilities
  custom?: boolean
  selectedModelIds?: string[]
  requiredTool?: string
  registered?: Array<{ type: 'function', function: { name: string } }>
}) {
  const hidePresetMedia = options.requiredTool !== GENERATE_IMAGE_TOOL
    && options.requiredTool !== GENERATE_VIDEO_TOOL
    && (Boolean(options.custom) || Boolean(options.selectedModelIds?.length))
  const tools = [
    ...buildOpenAiTools(options.caps).filter(tool => !(hidePresetMedia && [GENERATE_IMAGE_TOOL, GENERATE_VIDEO_TOOL].includes(tool.function.name))),
    ...(options.registered || []),
  ]
  if (requiredToolIfListed(options.requiredTool, tools))
    return tools
  if (options.requiredTool !== GENERATE_IMAGE_TOOL && options.requiredTool !== GENERATE_VIDEO_TOOL && options.requiredTool !== ASK_USER_TOOL)
    return tools
  const extras = buildOpenAiTools({
    ...options.caps,
    presetImage: options.requiredTool === GENERATE_IMAGE_TOOL && options.caps.presetImage === 'unavailable' ? 'ark' : options.caps.presetImage,
    presetVideo: options.requiredTool === GENERATE_VIDEO_TOOL && options.caps.presetVideo === 'unavailable' ? 'ark' : options.caps.presetVideo,
  })
  const extra = extras.find(tool => tool.function.name === options.requiredTool)
  return extra ? [extra, ...tools] : tools
}

export function buildOpenAiTools(caps: AgentMediaCapabilities) {
  const tools = JSON.parse(JSON.stringify(openAiTools)) as typeof openAiTools
  const available = tools.filter((tool) => {
    if (tool.function.name === GENERATE_IMAGE_TOOL)
      return caps.presetImage !== 'unavailable'
    if (tool.function.name === GENERATE_VIDEO_TOOL)
      return caps.presetVideo !== 'unavailable'
    return true
  })
  if (caps.presetImage === 'agnes') {
    const image = available.find(tool => tool.function.name === GENERATE_IMAGE_TOOL)
    const properties = image?.function.parameters.properties as Record<string, { description?: string, enum?: string[] }> | undefined
    if (properties?.aspect_ratio) {
      properties.aspect_ratio.enum = [...AGNES_IMAGE_RATIOS]
      properties.aspect_ratio.description = 'Agnes Image 2.5 Flash ratios: 1:1, 3:4, 4:3, 16:9, 9:16, 2:3, 3:2, 21:9. Default 1:1. Do not use auto.'
    }
    if (properties?.resolution) {
      properties.resolution.enum = [...AGNES_IMAGE_SIZE_TIERS]
      properties.resolution.description = 'Agnes Image 2.5 Flash size tiers: 1K, 2K, 3K, 4K. Economy/Hobby default to 1K; high quality uses 2K.'
    }
  }
  if (caps.presetVideo !== 'agnes')
    return available
  const video = available.find(tool => tool.function.name === GENERATE_VIDEO_TOOL)
  if (!video)
    return available
  const properties = video.function.parameters.properties as Record<string, { description?: string }>
  delete properties.generate_audio
  if (properties.resolution)
    properties.resolution.description = 'Agnes Video 2.5 Flash uses 720p. Omit this field unless the user explicitly asks for 720p.'
  if (properties.aspect_ratio)
    properties.aspect_ratio.description = 'Use one of 21:9, 16:9, 4:3, 1:1, 3:4, or 9:16. Text-to-video and reference-to-video default to 16:9. For image-to-video, omit aspect_ratio only when you also mark it uncertain; do not treat 16:9 as already chosen.'
  if (properties.duration)
    properties.duration.description = 'Length in seconds from 4 through 12. Default 5.'
  return available
}

function asString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function isHttpUrl(value: string) {
  return Boolean(canonicalMediaUrl(value))
}

function isStillAsset(image: AgentImage) {
  return image.status === 'success' && isHttpUrl(image.url) && image.kind !== 'video'
}

export function latestStill(images: AgentImage[]) {
  return images.find(isStillAsset)
}

export function resolveSessionUrl(token: string, images: AgentImage[], label: string) {
  const value = token.trim()
  const latest = latestStill(images)
  const useLatest = !value || /^(?:latest|last|newest)$/i.test(value)
  if (useLatest) {
    if (!latest)
      throw new Error(`No still in this session for ${label}. Generate or upload an image first, or pass a local media path or public HTTP URL.`)
    return latest
  }

  const byId = images.find(item => (item.id === value || item.name === value) && isStillAsset(item))
  if (byId)
    return byId

  if (!isHttpUrl(value))
    throw new Error(`${label} must be a local media path, public HTTP URL, session image id, or "latest"`)

  const byUrl = images.find(item => item.url === value && isStillAsset(item))
  return byUrl || {
    id: '',
    kind: 'still' as const,
    status: 'success' as const,
    prompt: '',
    aspectRatio: 'auto',
    resolution: '',
    url: canonicalMediaUrl(value),
    error: '',
  }
}

export function mediaProviderNotReadyError() {
  return Object.assign(
    new Error('Configure and test the selected media provider in Service connection before using this media tool.'),
    { failCode: 'MEDIA_PROVIDER_NOT_READY' as const },
  )
}

export function parseGenerateImageArgs(raw: string, caps?: AgentMediaCapabilities): GenerateImageArgs {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>
  }
  catch {
    throw new Error('generate_image arguments were not valid JSON')
  }
  if (caps?.presetImage === 'unavailable')
    throw mediaProviderNotReadyError()

  const prompt = asString(parsed.prompt)
  if (!prompt)
    throw new Error('prompt is required')
  if (prompt.length > 20_000)
    throw new Error('prompt must be 20000 characters or fewer')

  const aspectRatio = asString(parsed.aspect_ratio) || '1:1'
  const allowedRatios = caps?.presetImage === 'agnes' ? AGNES_IMAGE_RATIOS : SEEDREAM_5_ASPECT_RATIOS
  if (!(allowedRatios as readonly string[]).includes(aspectRatio))
    throw new Error(`Invalid aspect_ratio: ${aspectRatio}`)

  const resolution = asString(parsed.resolution) || '1K'
  const allowedResolutions = caps?.presetImage === 'agnes' ? AGNES_IMAGE_SIZE_TIERS : SEEDREAM_5_RESOLUTIONS
  if (!(allowedResolutions as readonly string[]).includes(resolution))
    throw new Error(`Invalid resolution: ${resolution}`)

  const uncertain = Array.isArray(parsed.uncertain_fields)
    ? parsed.uncertain_fields
        .filter((item): item is UncertainField => typeof item === 'string' && (UNCERTAIN_FIELDS as readonly string[]).includes(item))
    : []

  const inputTokens = Array.isArray(parsed.input_urls)
    ? parsed.input_urls.map(item => asString(item)).filter(Boolean)
    : []
  const referenceTokens = Array.isArray(parsed.reference_images)
    ? parsed.reference_images.map(item => asString(item)).filter(Boolean)
    : []
  if (inputTokens.length && referenceTokens.length)
    throw new Error('Do not set both input_urls and reference_images')
  if (referenceTokens.length > 10)
    throw new Error('A maximum of 10 reference images is allowed')
  if (inputTokens.length > 1) {
    if (inputTokens.length > 10)
      throw new Error('A maximum of 10 reference images is allowed')
    return {
      name: asString(parsed.name).slice(0, 100),
      prompt,
      aspect_ratio: aspectRatio as GenerateImageArgs['aspect_ratio'],
      resolution: resolution as GenerateImageArgs['resolution'],
      input_urls: [],
      reference_images: inputTokens,
      uncertain_fields: uncertain,
      reason: asString(parsed.reason),
    }
  }

  return {
    name: asString(parsed.name).slice(0, 100),
    prompt,
    aspect_ratio: aspectRatio as GenerateImageArgs['aspect_ratio'],
    resolution: resolution as GenerateImageArgs['resolution'],
    input_urls: inputTokens,
    reference_images: referenceTokens,
    uncertain_fields: uncertain,
    reason: asString(parsed.reason),
  }
}

export function resolveGenerateImageArgs(args: GenerateImageArgs, images: AgentImage[]): GenerateImageArgs {
  return {
    ...args,
    input_urls: args.input_urls.map(token => resolveSessionUrl(token, images, 'input_urls').url),
    reference_images: (args.reference_images || []).map(token => resolveSessionUrl(token, images, 'reference_images').url),
  }
}

function asStringList(value: unknown, max: number, label: string) {
  if (!Array.isArray(value))
    return []
  const list = value.map(item => asString(item)).filter(Boolean)
  if (list.length > max)
    throw new Error(`${label} allows at most ${max} items`)
  return list
}

function isVideoAsset(image: AgentImage) {
  return image.status === 'success' && isHttpUrl(image.url) && image.kind === 'video'
}

export function latestVideo(images: AgentImage[]) {
  return images.find(isVideoAsset)
}

export function resolveSessionVideo(token: string, images: AgentImage[], label: string) {
  const value = token.trim()
  const latest = latestVideo(images)
  const useLatest = !value || /^(?:latest|last|newest)$/i.test(value)
  if (useLatest) {
    if (!latest)
      throw new Error(`No video in this session for ${label}. Generate a clip first, or pass a local media path or public HTTP URL.`)
    return latest
  }

  const byId = images.find(item => (item.id === value || item.name === value) && isVideoAsset(item))
  if (byId)
    return byId

  if (!isHttpUrl(value))
    throw new Error(`${label} must be a local media path, public HTTP URL, session video id, or "latest"`)

  const byUrl = images.find(item => item.url === value && isVideoAsset(item))
  return byUrl || {
    id: '',
    kind: 'video' as const,
    status: 'success' as const,
    prompt: '',
    aspectRatio: 'auto',
    resolution: '',
    url: canonicalMediaUrl(value),
    error: '',
  }
}

export function parseGenerateVideoArgs(raw: string, caps?: AgentMediaCapabilities): GenerateVideoArgs {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>
  }
  catch {
    throw new Error('generate_video arguments were not valid JSON')
  }
  if (caps?.presetVideo === 'unavailable')
    throw mediaProviderNotReadyError()

  const prompt = asString(parsed.prompt)
  if (!prompt)
    throw new Error('prompt is required')
  if (prompt.length < 3)
    throw new Error('prompt must be at least 3 characters')
  if (prompt.length > 30_000)
    throw new Error('prompt must be 30000 characters or fewer')

  const firstFrame = asString(parsed.first_frame) || asString(parsed.first_frame_url)
  const lastFrame = asString(parsed.last_frame) || asString(parsed.last_frame_url)
  const referenceImages = asStringList(parsed.reference_images ?? parsed.reference_image_urls, 30, 'reference_images')
  const referenceVideos = asStringList(parsed.reference_videos ?? parsed.reference_video_urls, 10, 'reference_videos')
  const hasRefs = Boolean(referenceImages.length || referenceVideos.length)
  const namedAspectRatio = asString(parsed.aspect_ratio)
  const agnesI2vOmit = caps?.presetVideo === 'agnes' && Boolean(firstFrame) && !hasRefs && !namedAspectRatio
  const aspectRatio = namedAspectRatio
    || (caps?.presetVideo === 'agnes' ? '16:9' : firstFrame && !hasRefs ? 'adaptive' : '16:9')
  if (!isSeedance2AspectRatio(aspectRatio))
    throw new Error(`Invalid aspect_ratio: ${aspectRatio}`)

  const resolutionRaw = asString(parsed.resolution) === '4K'
    ? '4k'
    : (asString(parsed.resolution) || (caps?.presetVideo === 'agnes' ? '720p' : '480p'))
  if (!isSeedance2Resolution(resolutionRaw))
    throw new Error('resolution must be 480p, 720p, 1080p, or 4k')

  const duration = Math.floor(Number(parsed.duration ?? 5))
  if (!Number.isInteger(duration) || duration < 2 || duration > 30)
    throw new Error('duration must be 2-30 seconds')

  const family: VideoFamily = 'seedance-2'
  const uncertain = Array.isArray(parsed.uncertain_fields)
    ? parsed.uncertain_fields
        .filter((item): item is UncertainField => typeof item === 'string' && (UNCERTAIN_FIELDS as readonly string[]).includes(item))
    : []
  if (agnesI2vOmit && !uncertain.includes('aspect_ratio'))
    uncertain.push('aspect_ratio')

  return {
    name: asString(parsed.name).slice(0, 100),
    prompt,
    aspect_ratio: aspectRatio,
    resolution: resolutionRaw,
    duration,
    ...(Object.hasOwn(parsed, 'generate_audio')
      ? { generate_audio: parsed.generate_audio === true }
      : caps?.presetVideo === 'agnes' ? {} : { generate_audio: true }),
    family,
    first_frame: firstFrame,
    last_frame: lastFrame,
    reference_images: referenceImages,
    reference_videos: referenceVideos,
    uncertain_fields: uncertain,
  }
}

export function resolveGenerateVideoArgs(
  args: GenerateVideoArgs,
  images: AgentImage[],
  caps?: AgentMediaCapabilities,
): ResolvedGenerateVideo {
  const resolved: ResolvedGenerateVideo = {
    name: args.name,
    prompt: args.prompt,
    aspect_ratio: args.aspect_ratio,
    resolution: args.resolution,
    duration: args.duration,
    ...(args.generate_audio !== undefined ? { generate_audio: args.generate_audio } : {}),
    family: args.family,
    uncertain_fields: args.uncertain_fields,
  }

  const referenceImages = args.reference_images.map(token => resolveSessionUrl(token, images, 'reference_images').url)
  const referenceVideos = args.reference_videos.map(token => resolveSessionVideo(token, images, 'reference_videos').url)

  if (referenceImages.length || referenceVideos.length) {
    if (referenceImages.length)
      resolved.reference_image_urls = referenceImages
    if (referenceVideos.length)
      resolved.reference_video_urls = referenceVideos
    assertAgnesVideoPublicUrls(resolved, caps)
    return resolved
  }

  if (args.first_frame) {
    const first = resolveSessionUrl(args.first_frame, images, 'first_frame')
    resolved.first_frame_url = first.url
    if (caps?.presetVideo !== 'agnes')
      resolved.aspect_ratio = 'adaptive'
  }

  if (args.last_frame)
    resolved.last_frame_url = resolveSessionUrl(args.last_frame, images, 'last_frame').url

  assertAgnesVideoPublicUrls(resolved, caps)
  return resolved
}

function isPublicHttpsUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password
  }
  catch {
    return false
  }
}

function isAgnesAllowedVideoStill(url: string) {
  return storedMediaKey(url) !== null || isPublicHttpsUrl(url)
}

function assertAgnesPublicHttps(url: string, label: string) {
  if (!isAgnesAllowedVideoStill(url))
    throw agnesPublicImageRequiredError(label)
}

function assertAgnesVideoPublicUrls(resolved: ResolvedGenerateVideo, caps?: AgentMediaCapabilities) {
  if (caps?.presetVideo !== 'agnes')
    return
  if (resolved.first_frame_url)
    assertAgnesPublicHttps(resolved.first_frame_url, 'first_frame')
  if (resolved.last_frame_url)
    assertAgnesPublicHttps(resolved.last_frame_url, 'last_frame')
  for (const url of resolved.reference_image_urls || [])
    assertAgnesPublicHttps(url, 'reference_images')
  for (const url of resolved.reference_video_urls || [])
    assertAgnesPublicHttps(url, 'reference_videos')
}

export type AgnesIncompatibleVideoField = 'resolution' | 'aspect_ratio' | 'generate_audio'

export function agnesIncompatiblePresetVideoFields(raw: string | Record<string, unknown>): AgnesIncompatibleVideoField[] {
  const parsed = typeof raw === 'string'
    ? JSON.parse(raw) as Record<string, unknown>
    : raw
  const fields: AgnesIncompatibleVideoField[] = []
  const resolution = asString(parsed.resolution).toLowerCase()
  if (resolution && resolution !== '720p')
    fields.push('resolution')
  if (asString(parsed.aspect_ratio) === 'adaptive')
    fields.push('aspect_ratio')
  if (Object.hasOwn(parsed, 'generate_audio'))
    fields.push('generate_audio')
  return fields
}

export function buildAgnesCapabilityAskUser(fields: AgnesIncompatibleVideoField[]): AskUserArgs {
  const questions: ChoiceQuestion[] = []
  if (fields.includes('resolution')) {
    questions.push({
      id: 'resolution',
      prompt: 'Agnes Video 2.5 Flash supports only 720p. Choose a resolution.',
      recommendedId: '720p',
      options: withCustomChoiceOption([{ id: '720p', label: '720p' }]),
    })
  }
  if (fields.includes('aspect_ratio')) {
    questions.push({
      id: 'aspect_ratio',
      prompt: 'Agnes Video 2.5 Flash does not support adaptive. Choose a fixed ratio.',
      recommendedId: '16:9',
      options: withCustomChoiceOption(AGNES_VIDEO_ASPECT_RATIOS.map(id => ({ id, label: id }))),
    })
  }
  if (fields.includes('generate_audio')) {
    questions.push({
      id: 'generate_audio',
      prompt: 'Agnes Video 2.5 Flash cannot guarantee audio on or off. Continue without an audio switch?',
      recommendedId: 'omit',
      options: withCustomChoiceOption([{ id: 'omit', label: 'Omit generate_audio' }]),
    })
  }
  return {
    prompt: 'The media backend changed. Agnes Video 2.5 Flash cannot use the previous settings.',
    recommendation: 'Use 720p and a fixed ratio such as 16:9. Omit generate_audio.',
    questions,
  }
}

export function capabilityRequeueFallback(
  items: Array<{ tool?: string, argsJson: string }>,
  liveCaps: AgentMediaCapabilities,
  error: unknown,
): { action: 'ask_user', args: AskUserArgs } | { action: 'fail', failCode: string, message: string } {
  const failCode = String((error as { failCode?: unknown })?.failCode || 'MEDIA_CAPABILITIES_CHANGED')
  const message = error instanceof Error ? error.message : 'Media capabilities changed'
  if (liveCaps.presetImage === 'unavailable' && liveCaps.presetVideo === 'unavailable') {
    const notReady = mediaProviderNotReadyError()
    return { action: 'fail', failCode: notReady.failCode, message: notReady.message }
  }
  if (failCode === 'MEDIA_PROVIDER_NOT_READY')
    return { action: 'fail', failCode, message }

  const fields = [...new Set(
    items
      .filter(item => item.tool === GENERATE_VIDEO_TOOL)
      .flatMap(item => agnesIncompatiblePresetVideoFields(item.argsJson)),
  )]
  if (liveCaps.presetVideo === 'agnes' && fields.length)
    return { action: 'ask_user', args: buildAgnesCapabilityAskUser(fields) }
  return { action: 'fail', failCode, message }
}

export function parseConcatVideoArgs(raw: string): ConcatVideoArgs {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>
  }
  catch {
    throw new Error('concat_videos arguments were not valid JSON')
  }

  const tokens = asStringList(parsed.video_urls ?? parsed.urls, MAX_CONCAT_CLIPS, 'video_urls')
  if (tokens.length < 2)
    throw new Error('concat_videos needs at least two clips, in story order')
  if (tokens.some(token => /^(?:latest|last|newest)$/i.test(token)))
    throw new Error('concat_videos cannot use "latest"; pass each clip URL or session id in order')

  return { video_urls: tokens }
}

export function resolveConcatVideoUrls(args: ConcatVideoArgs, images: AgentImage[]) {
  return args.video_urls.map((token, index) => resolveSessionVideo(token, images, `video_urls[${index}]`).url)
}

const CUSTOM_OPTION_RE = /^(?:other|custom|其他|其它|自定义)\b/i

function clipAsk(value: unknown, max: number) {
  return asString(value).slice(0, max)
}

function optionAllowsCustom(id: string, label: string, flag: unknown) {
  if (flag === true)
    return true
  return CUSTOM_OPTION_RE.test(id) || CUSTOM_OPTION_RE.test(label)
}

function parseAskOption(raw: unknown, index: number, seen: Set<string>): ChoiceOption | null {
  if (!raw || typeof raw !== 'object')
    return null
  const row = raw as Record<string, unknown>
  const label = clipAsk(row.label ?? row.title ?? row.text, 120)
  if (!label)
    return null
  const id = clipAsk(row.id ?? row.value, 64) || `opt_${index + 1}`
  const unique = seen.has(id) ? `${id}_${index + 1}` : id
  seen.add(unique)
  const description = clipAsk(row.description ?? row.hint, 200)
  const custom = optionAllowsCustom(unique, label, row.allow_custom ?? row.allowCustom ?? row.custom)
  return {
    id: unique,
    label,
    ...(description ? { description } : {}),
    ...(custom ? { custom: true } : {}),
  }
}

function parseAskQuestion(raw: unknown, index: number, seen: Set<string>): ChoiceQuestion | null {
  if (!raw || typeof raw !== 'object')
    return null
  const row = raw as Record<string, unknown>
  const prompt = clipAsk(row.prompt ?? row.question ?? row.label, 280)
  if (!prompt)
    return null
  const optionSeen = new Set<string>()
  const source = Array.isArray(row.options) ? row.options : []
  const options: ChoiceOption[] = []
  for (const [optionIndex, item] of source.entries()) {
    if (options.length >= MAX_ASK_OPTIONS)
      break
    const option = parseAskOption(item, optionIndex, optionSeen)
    if (option)
      options.push(option)
  }
  if (!options.length)
    return null
  const id = clipAsk(row.id, 64) || `q_${index + 1}`
  const unique = seen.has(id) ? `${id}_${index + 1}` : id
  seen.add(unique)
  const title = clipAsk(row.title, 80)
  const recommendedRaw = clipAsk(row.recommended ?? row.recommended_id ?? row.recommendedId, 64)
  const recommendedId = options.some(item => item.id === recommendedRaw) ? recommendedRaw : undefined
  return {
    id: unique,
    prompt,
    options: withCustomChoiceOption(options),
    ...(title ? { title } : {}),
    ...(recommendedId ? { recommendedId } : {}),
  }
}

export function parseAskUserArgs(raw: string): AskUserArgs {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>
  }
  catch {
    throw new Error('ask_user arguments were not valid JSON')
  }

  const source = Array.isArray(parsed.questions)
    ? parsed.questions
    : parsed.question
      ? [parsed.question]
      : []
  const seen = new Set<string>()
  const questions: ChoiceQuestion[] = []
  for (const [index, item] of source.entries()) {
    if (questions.length >= MAX_ASK_QUESTIONS)
      break
    const question = parseAskQuestion(item, index, seen)
    if (question)
      questions.push(question)
  }
  if (!questions.length)
    throw new Error('ask_user needs at least one question with options')

  return {
    prompt: clipAsk(parsed.prompt ?? parsed.intro, 400),
    recommendation: clipAsk(parsed.recommendation ?? parsed.hint, 400),
    questions,
  }
}
