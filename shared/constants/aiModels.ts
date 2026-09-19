import type { AiCategory, AiModelConfig, AiTask, SchemaProperty } from '../types/aiModel'
import { SEEDANCE_2_ASPECT_RATIOS, SEEDANCE_2_DURATIONS, SEEDANCE_2_RESOLUTIONS } from '~~/shared/utils/seedance2'

export const AI_CATEGORIES: AiCategory[] = ['Image', 'Video']

export const AI_TASKS: Array<{ value: AiTask, category: AiCategory, abbr: string, comingSoon?: boolean }> = [
  { value: 'Text to Image', category: 'Image', abbr: 't2i' },
  { value: 'Image to Image', category: 'Image', abbr: 'i2i' },
  { value: 'Reference to Image', category: 'Image', abbr: 'r2i' },
  { value: 'Text to Video', category: 'Video', abbr: 't2v' },
  { value: 'Image to Video', category: 'Video', abbr: 'i2v' },
  { value: 'Reference to Video', category: 'Video', abbr: 'r2v' },
]

export const TASK_ABBR = Object.fromEntries(
  AI_TASKS.map(task => [task.value, task.abbr]),
) as Record<AiTask, string>

export const SEEDREAM_5_ASPECT_RATIOS = ['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9'] as const
export const SEEDREAM_5_RESOLUTIONS = ['1K', '2K'] as const
export const AGNES_IMAGE_SIZE_TIERS = ['1K', '2K', '3K', '4K'] as const
export const AGNES_IMAGE_RATIOS = ['1:1', '3:4', '4:3', '16:9', '9:16', '2:3', '3:2', '21:9'] as const
export const AGNES_IMAGE_SIZES = AGNES_IMAGE_SIZE_TIERS
export const AGNES_VIDEO_ASPECT_RATIOS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'] as const

export function getTaskAbbr(task: AiTask) {
  return TASK_ABBR[task]
}

const SEEDREAM_PROMPT: SchemaProperty = {
  'description': 'Describe the image or edit in detail.',
  'minLength': 1,
  'maxLength': 20000,
  'type': 'string',
  'x-placeholder': 'Describe the image you want to create',
  'x-ui-component': 'textarea',
}

const SEEDREAM_SOURCE_IMAGE: SchemaProperty = {
  'description': 'One source image to edit. JPEG, PNG, or WEBP. 30MB max.',
  'items': { type: 'string' },
  'maxItems': 1,
  'minItems': 1,
  'type': 'array',
  'x-accept': 'image/jpeg,image/png,image/webp',
  'x-label': 'Source image',
  'x-max-bytes': 30 * 1024 * 1024,
  'x-ui-component': 'uploaders',
}

const SEEDREAM_REFERENCE_IMAGES: SchemaProperty = {
  'description': 'Up to 10 identity or style reference images for a new scene. JPEG, PNG, or WEBP. 30MB max each.',
  'items': { type: 'string' },
  'maxItems': 10,
  'minItems': 1,
  'type': 'array',
  'x-accept': 'image/jpeg,image/png,image/webp',
  'x-label': 'Reference images',
  'x-max-bytes': 30 * 1024 * 1024,
  'x-ui-component': 'uploaders',
}

const SEEDREAM_ASPECT_RATIO: SchemaProperty = {
  default: 'auto',
  description: 'Aspect ratio of the generated image.',
  enum: [...SEEDREAM_5_ASPECT_RATIOS],
  type: 'string',
}

const SEEDREAM_RESOLUTION: SchemaProperty = {
  default: '2K',
  description: 'Resolution of the generated image.',
  enum: [...SEEDREAM_5_RESOLUTIONS],
  type: 'string',
}

function seedreamSchema(mode: 'text' | 'image' | 'reference') {
  const properties: Record<string, SchemaProperty> = {
    prompt: SEEDREAM_PROMPT,
    ...(mode === 'image' ? { input_urls: SEEDREAM_SOURCE_IMAGE } : {}),
    ...(mode === 'reference' ? { input_urls: SEEDREAM_REFERENCE_IMAGES } : {}),
    aspect_ratio: SEEDREAM_ASPECT_RATIO,
    resolution: SEEDREAM_RESOLUTION,
    watermark: {
      default: false,
      description: 'Add the provider watermark.',
      type: 'boolean',
    },
  }
  return {
    components: {
      schemas: {
        Input: {
          properties,
          'required': mode === 'text' ? ['prompt'] : ['prompt', 'input_urls'],
          'x-order-properties': Object.keys(properties),
        },
      },
    },
  }
}

const SEEDANCE_2_PROMPT: SchemaProperty = {
  'description': 'Describe the scene, subject motion, camera, and sound.',
  'minLength': 1,
  'type': 'string',
  'x-placeholder': 'Describe the video you want to generate',
  'x-ui-component': 'textarea',
}

const SEEDANCE_2_IMAGE: SchemaProperty = {
  'description': 'JPEG, PNG, or WEBP image. 30MB max.',
  'items': { type: 'string' },
  'maxItems': 1,
  'minItems': 1,
  'type': 'array',
  'x-accept': 'image/jpeg,image/png,image/webp',
  'x-max-bytes': 30 * 1024 * 1024,
  'x-ui-component': 'uploaders',
}

function seedance2Schema(mode: 'text' | 'image' | 'reference') {
  const properties: Record<string, SchemaProperty> = {
    prompt: SEEDANCE_2_PROMPT,
  }
  const required = ['prompt']
  if (mode === 'image') {
    properties.image_url = { ...SEEDANCE_2_IMAGE, 'x-label': 'First frame' }
    properties.end_image_url = { ...SEEDANCE_2_IMAGE, 'minItems': undefined, 'x-label': 'Last frame' }
    required.push('image_url')
  }
  if (mode === 'reference') {
    properties.image_urls = {
      ...SEEDANCE_2_IMAGE,
      'description': 'Up to 9 subject or style reference images.',
      'maxItems': 9,
      'minItems': undefined,
      'x-label': 'Reference images',
    }
    properties.video_urls = {
      'description': 'Up to 3 remote reference videos. Local files require Ark asset configuration.',
      'items': { type: 'string' },
      'maxItems': 3,
      'type': 'array',
      'x-accept': 'video/mp4,video/quicktime',
      'x-label': 'Reference videos',
      'x-ui-component': 'uploaders',
    }
    properties.audio_urls = {
      'description': 'Up to 3 remote reference audio files. Local files require Ark asset configuration.',
      'items': { type: 'string' },
      'maxItems': 3,
      'type': 'array',
      'x-accept': 'audio/mpeg,audio/wav',
      'x-label': 'Reference audio',
      'x-ui-component': 'uploaders',
    }
  }
  Object.assign(properties, {
    aspect_ratio: {
      default: 'adaptive',
      description: 'Aspect ratio of the generated video.',
      enum: [...SEEDANCE_2_ASPECT_RATIOS],
      type: 'string',
    },
    resolution: {
      default: '720p',
      description: 'Resolution of the generated video.',
      enum: [...SEEDANCE_2_RESOLUTIONS],
      type: 'string',
    },
    duration: {
      default: 5,
      description: 'Video length in seconds.',
      enum: [...SEEDANCE_2_DURATIONS],
      type: 'integer',
    },
    generate_audio: {
      default: true,
      description: 'Generate synchronized audio with the video.',
      type: 'boolean',
    },
    watermark: {
      default: false,
      description: 'Add the provider watermark.',
      type: 'boolean',
    },
    return_last_frame: {
      default: false,
      description: 'Return and save the generated last frame.',
      type: 'boolean',
    },
  })
  return {
    components: {
      schemas: {
        Input: {
          properties,
          required,
          'x-order-properties': Object.keys(properties),
        },
      },
    },
  }
}

function agnesImageSchema(mode: 'text' | 'image' | 'reference') {
  const properties: Record<string, SchemaProperty> = {
    prompt: SEEDREAM_PROMPT,
  }
  const required = ['prompt']
  if (mode !== 'text') {
    properties.input_urls = {
      ...(mode === 'image' ? SEEDREAM_SOURCE_IMAGE : SEEDREAM_REFERENCE_IMAGES),
      description: mode === 'image'
        ? 'One source image to edit. Local images are sent as Data URI.'
        : 'Up to 4 source or style images. Local images are sent as Data URI.',
      maxItems: mode === 'image' ? 1 : 4,
    }
    required.push('input_urls')
  }
  properties.size = {
    default: '1K',
    description: 'Output size tier. Request 1K, 2K, 3K, or 4K together with ratio. This is not a promise of exact output pixels.',
    enum: [...AGNES_IMAGE_SIZE_TIERS],
    type: 'string',
  }
  properties.ratio = {
    default: '1:1',
    description: 'Output aspect ratio for the selected size tier.',
    enum: [...AGNES_IMAGE_RATIOS],
    type: 'string',
  }
  return {
    components: {
      schemas: {
        Input: {
          properties,
          required,
          'x-order-properties': Object.keys(properties),
        },
      },
    },
  }
}

function agnesVideoSchema(mode: 'text' | 'image' | 'reference') {
  const properties: Record<string, SchemaProperty> = {
    prompt: SEEDANCE_2_PROMPT,
  }
  const required = ['prompt']
  if (mode === 'image') {
    properties.image_url = { ...SEEDANCE_2_IMAGE, 'description': 'Public HTTPS first-frame image URL. Local uploads are not supported.', 'x-label': 'First frame', 'x-ui-component': 'url-list' }
    properties.end_image_url = { ...SEEDANCE_2_IMAGE, 'description': 'Optional public HTTPS last-frame image URL. Local uploads are not supported.', 'minItems': undefined, 'x-label': 'Last frame', 'x-ui-component': 'url-list' }
    required.push('image_url')
  }
  if (mode === 'reference') {
    properties.image_urls = {
      ...SEEDANCE_2_IMAGE,
      'description': 'Up to 5 public HTTPS reference image URLs.',
      'maxItems': 5,
      'minItems': undefined,
      'x-label': 'Reference images',
      'x-ui-component': 'url-list',
    }
    properties.audio_urls = {
      'description': 'Up to 3 public HTTPS reference audio URLs.',
      'items': { type: 'string' },
      'maxItems': 3,
      'type': 'array',
      'x-accept': 'audio/mpeg,audio/wav',
      'x-label': 'Reference audio',
      'x-ui-component': 'url-list',
    }
  }
  Object.assign(properties, {
    aspect_ratio: {
      default: '16:9',
      description: 'Aspect ratio of the generated video.',
      enum: [...AGNES_VIDEO_ASPECT_RATIOS],
      type: 'string',
    },
    duration: {
      default: 5,
      description: 'Video length in seconds.',
      enum: Array.from({ length: 9 }, (_, index) => index + 4),
      type: 'integer',
    },
  })
  return {
    components: {
      schemas: {
        Input: {
          properties,
          required,
          'x-order-properties': Object.keys(properties),
        },
      },
    },
  }
}

export const AI_MODELS: AiModelConfig[] = [
  {
    id: 'seedream/5-pro-text-to-image',
    name: 'Seedream 5.0 Pro',
    category: 'Image',
    task: 'Text to Image',
    icon: 'lucide:image',
    schema: seedreamSchema('text'),
  },
  {
    id: 'seedream/5-pro-image-to-image',
    name: 'Seedream 5.0 Pro',
    category: 'Image',
    task: 'Image to Image',
    icon: 'lucide:images',
    schema: seedreamSchema('image'),
  },
  {
    id: 'seedream/5-pro-reference-to-image',
    name: 'Seedream 5.0 Pro',
    category: 'Image',
    task: 'Reference to Image',
    icon: 'lucide:layers',
    schema: seedreamSchema('reference'),
  },
  {
    id: 'bytedance/seedance-2-text-to-video',
    name: 'Seedance 2.0',
    category: 'Video',
    task: 'Text to Video',
    icon: 'lucide:clapperboard',
    schema: seedance2Schema('text'),
  },
  {
    id: 'bytedance/seedance-2-image-to-video',
    name: 'Seedance 2.0',
    category: 'Video',
    task: 'Image to Video',
    icon: 'lucide:clapperboard',
    schema: seedance2Schema('image'),
  },
  {
    id: 'bytedance/seedance-2-reference-to-video',
    name: 'Seedance 2.0',
    category: 'Video',
    task: 'Reference to Video',
    icon: 'lucide:clapperboard',
    schema: seedance2Schema('reference'),
  },
  {
    id: 'agnes/image-2.5-flash-text-to-image',
    name: 'Agnes Image 2.5 Flash',
    category: 'Image',
    task: 'Text to Image',
    icon: 'lucide:image',
    schema: agnesImageSchema('text'),
  },
  {
    id: 'agnes/image-2.5-flash-image-to-image',
    name: 'Agnes Image 2.5 Flash',
    category: 'Image',
    task: 'Image to Image',
    icon: 'lucide:images',
    schema: agnesImageSchema('image'),
  },
  {
    id: 'agnes/image-2.5-flash-reference-to-image',
    name: 'Agnes Image 2.5 Flash',
    category: 'Image',
    task: 'Reference to Image',
    icon: 'lucide:layers',
    schema: agnesImageSchema('reference'),
  },
  {
    id: 'agnes/video-2.5-flash-text-to-video',
    name: 'Agnes Video 2.5 Flash',
    category: 'Video',
    task: 'Text to Video',
    icon: 'lucide:clapperboard',
    schema: agnesVideoSchema('text'),
  },
  {
    id: 'agnes/video-2.5-flash-image-to-video',
    name: 'Agnes Video 2.5 Flash',
    category: 'Video',
    task: 'Image to Video',
    icon: 'lucide:clapperboard',
    schema: agnesVideoSchema('image'),
  },
  {
    id: 'agnes/video-2.5-flash-reference-to-video',
    name: 'Agnes Video 2.5 Flash',
    category: 'Video',
    task: 'Reference to Video',
    icon: 'lucide:clapperboard',
    schema: agnesVideoSchema('reference'),
  },
]

export const ARK_IMAGE_MODEL_IDS = [
  'seedream/5-pro-text-to-image',
  'seedream/5-pro-image-to-image',
  'seedream/5-pro-reference-to-image',
] as const

export function isArkImageModelId(modelId: string) {
  return (ARK_IMAGE_MODEL_IDS as readonly string[]).includes(modelId)
}

export const ARK_VIDEO_MODEL_IDS = [
  'bytedance/seedance-2-text-to-video',
  'bytedance/seedance-2-image-to-video',
  'bytedance/seedance-2-reference-to-video',
] as const

export function isArkVideoModelId(modelId: string) {
  return (ARK_VIDEO_MODEL_IDS as readonly string[]).includes(modelId)
}

export const AGNES_IMAGE_MODEL_IDS = [
  'agnes/image-2.5-flash-text-to-image',
  'agnes/image-2.5-flash-image-to-image',
  'agnes/image-2.5-flash-reference-to-image',
] as const

export const AGNES_IMAGE_LEGACY_MODEL_IDS = [
  'agnes/image-2.0-flash-text-to-image',
  'agnes/image-2.0-flash-image-to-image',
  'agnes/image-2.0-flash-reference-to-image',
] as const

export function canonicalizeAgnesImageModelId(modelId: string) {
  return modelId.replace('image-2.0-flash', 'image-2.5-flash')
}

export function isAgnesImageModelId(modelId: string) {
  return (AGNES_IMAGE_MODEL_IDS as readonly string[]).includes(modelId)
    || (AGNES_IMAGE_LEGACY_MODEL_IDS as readonly string[]).includes(modelId)
}

export const AGNES_VIDEO_MODEL_IDS = [
  'agnes/video-2.5-flash-text-to-video',
  'agnes/video-2.5-flash-image-to-video',
  'agnes/video-2.5-flash-reference-to-video',
] as const

export function isAgnesVideoModelId(modelId: string) {
  return (AGNES_VIDEO_MODEL_IDS as readonly string[]).includes(modelId)
}

export const MODEL_COMPANIES: Record<string, string> = {
  'Agnes 2.5 Flash': 'Agnes',
  'Agnes 3.0 Flash': 'Agnes',
  'Agnes Image 2.5 Flash': 'Agnes',
  'Agnes Image 2.0 Flash': 'Agnes',
  'Agnes Video 2.5 Flash': 'Agnes',
  'Seedream 5.0 Pro': 'ByteDance',
  'Seedance 2.0': 'ByteDance',
}

export const COMPANY_LOGOS: Record<string, string> = {
  Agnes: '/brand/companies/agnes.svg',
  ByteDance: '/brand/companies/bytedance.svg',
}

export function getModelCompanyLogo(name?: string) {
  if (!name)
    return undefined
  const company = MODEL_COMPANIES[name]
  return company ? COMPANY_LOGOS[company] : undefined
}

export interface FrontierModelCard {
  name: string
  title: string
  company: string
  logo?: string
  task: AiTask
  taskAbbr: string
  icon?: string
  modelId: string
  category: AiCategory
}

export function getFrontierModelCards(): FrontierModelCard[] {
  return AI_MODELS.map((model) => {
    const company = MODEL_COMPANIES[model.name] || ''
    const taskAbbr = getTaskAbbr(model.task)
    return {
      name: model.name,
      title: `${model.name} ${taskAbbr}`,
      company,
      logo: COMPANY_LOGOS[company],
      task: model.task,
      taskAbbr,
      icon: model.icon,
      modelId: model.id,
      category: model.category,
    }
  })
}
