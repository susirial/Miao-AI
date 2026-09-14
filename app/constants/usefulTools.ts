export interface UsefulTool {
  slug: string
  title: string
  icon: string
  description: string
  to?: string
  group?: string
}

export const IMAGE_EDITOR_PATH = '/tools/image-to-image'
export const VIDEO_EDITOR_PATH = '/tools/reference-to-video'

const TOOL_SLUG_ALIASES: Record<string, string> = {
  'ai-image-editor': 'image-to-image',
  'image-editor': 'image-to-image',
  'ai-video-editor': 'reference-to-video',
  'video-editor': 'reference-to-video',
}

export function resolveToolSlug(slug: string) {
  return TOOL_SLUG_ALIASES[slug] || slug
}

export const USEFUL_TOOLS: UsefulTool[] = [
  {
    slug: 'image-to-image',
    title: 'AI Image Editor',
    icon: 'i-lucide-wand-sparkles',
    description: 'Upload a still and describe the change. An AI image editor for Image to Image only.',
    to: '/?agentTask=image-to-image#generator',
    group: 'Useful tools',
  },
  {
    slug: 'reference-to-video',
    title: 'AI Video Editor',
    icon: 'i-lucide-clapperboard',
    description: 'Upload a clip and describe the change. An AI video editor for Reference to Video only.',
    to: '/?agentTask=reference-to-video#generator',
    group: 'Useful tools',
  },
]

export const HOME_TOOL_COLLECTIONS = [
  {
    title: 'Useful tools',
    description: 'Everyday utilities for your images and videos.',
    items: USEFUL_TOOLS.map(tool => ({
      ...tool,
      to: tool.to || `/tools/${tool.slug}`,
    })),
  },
] as const

export function usefulToolBySlug(slug: string) {
  return USEFUL_TOOLS.find(tool => tool.slug === resolveToolSlug(slug))
}

export function studioToolBySlug(slug: string) {
  return usefulToolBySlug(slug)
}
