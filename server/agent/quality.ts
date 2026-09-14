import type { AgentConfirmPolicy, AgentQuality, GenerateImageArgs, GenerateVideoArgs, VideoFamily } from './types'
import { isSeedance2Duration, isSeedance2Resolution } from './seedance2'

export function parseAgentQuality(value: unknown): AgentQuality {
  if (value === 'high' || value === 'hobby' || value === 'custom')
    return value
  if (value === 'draft')
    return 'hobby'
  return 'economy'
}

export function parseAgentConfirmPolicy(value: unknown): AgentConfirmPolicy {
  if (value === 'auto' || value === 'when_needed' || value === 'always')
    return value
  return 'always'
}

export function parseVideoFamily(_value: unknown): VideoFamily {
  return 'seedance-2'
}

export function applyImageQuality(args: GenerateImageArgs, quality: AgentQuality): GenerateImageArgs {
  return {
    ...args,
    resolution: quality === 'high' ? '2K' : '1K',
    uncertain_fields: args.uncertain_fields.filter(field => field !== 'resolution'),
  }
}

export function clampVideoToFamily(args: GenerateVideoArgs, _family: VideoFamily = 'seedance-2'): GenerateVideoArgs {
  const duration = Math.min(15, Math.max(4, Math.floor(Number(args.duration) || 5)))
  return {
    ...args,
    family: 'seedance-2',
    resolution: isSeedance2Resolution(args.resolution) ? args.resolution : '480p',
    duration: isSeedance2Duration(duration) ? duration : 5,
    reference_images: args.reference_images.slice(0, 9),
    reference_videos: args.reference_videos.slice(0, 3),
  }
}

export function applyVideoQuality(args: GenerateVideoArgs, _quality: AgentQuality): GenerateVideoArgs {
  return clampVideoToFamily(args)
}
