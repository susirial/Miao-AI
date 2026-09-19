export const GENERATOR_TASK_BY_SLUG = {
  'text-to-image': { category: 'Image', task: 'Text to Image' },
  'image-to-image': { category: 'Image', task: 'Image to Image' },
  'reference-to-image': { category: 'Image', task: 'Reference to Image' },
  'text-to-video': { category: 'Video', task: 'Text to Video' },
  'image-to-video': { category: 'Video', task: 'Image to Video' },
  'reference-to-video': { category: 'Video', task: 'Reference to Video' },
} as const

export type GeneratorTaskSlug = keyof typeof GENERATOR_TASK_BY_SLUG

export const GENERATOR_SLUG_BY_TASK: Record<string, GeneratorTaskSlug> = {
  'Text to Image': 'text-to-image',
  'Image to Image': 'image-to-image',
  'Reference to Image': 'reference-to-image',
  'Text to Video': 'text-to-video',
  'Image to Video': 'image-to-video',
  'Reference to Video': 'reference-to-video',
}

export function resolveGeneratorTaskSlug(slug: string) {
  return GENERATOR_TASK_BY_SLUG[slug as GeneratorTaskSlug] ?? null
}

export function generatorLocationForModel(model: { id: string, task: string }) {
  const slug = GENERATOR_SLUG_BY_TASK[model.task] ?? 'text-to-image'
  return {
    path: `/tools/${slug}`,
    query: { model: model.id },
  }
}
