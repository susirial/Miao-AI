import type { ImageFamilyId, VideoFamilyId } from '~~/shared/constants/modelCatalog'
import type { AgentQuality, AskUserArgs, ChoiceBody, ChoicePayload, ChoiceQuestion } from './types'
import { DEFAULT_IMAGE_FAMILY, DEFAULT_VIDEO_FAMILY, getMediaFamily, isImageFamilyId, isVideoFamilyId } from '~~/shared/constants/modelCatalog'
import { withCustomChoiceOption } from '~~/shared/utils/agentChoices'
import { normalizeAgentLocale } from '~~/shared/utils/agentLocale'

export const IMAGE_MODEL_QUESTION = 'image_model'
export const VIDEO_MODEL_QUESTION = 'video_model'
export const MODEL_PREFERENCE_QUESTION = 'model_preference'

export interface MediaFamilyReadiness {
  arkOk: boolean
  agnesOk: boolean
  lastUsedImage?: string
  lastUsedVideo?: string
  locale?: string
}

export interface MediaFamilyChoiceResult {
  imageFamily?: ImageFamilyId
  videoFamily?: VideoFamilyId
  quality?: AgentQuality
}

function zhLocale(locale?: string) {
  return normalizeAgentLocale(locale) !== 'en'
}

function familyReady(family: string | undefined, arkOk: boolean, agnesOk: boolean) {
  if (isImageFamilyId(family) || isVideoFamilyId(family))
    return family.startsWith('agnes-') ? agnesOk : arkOk
  return false
}

export function readyImageFamilies(arkOk: boolean, agnesOk: boolean): ImageFamilyId[] {
  const families: ImageFamilyId[] = []
  if (arkOk)
    families.push('ark-image')
  if (agnesOk)
    families.push('agnes-image')
  return families
}

export function readyVideoFamilies(arkOk: boolean, agnesOk: boolean): VideoFamilyId[] {
  const families: VideoFamilyId[] = []
  if (arkOk)
    families.push('ark-video')
  if (agnesOk)
    families.push('agnes-video')
  return families
}

export function shouldAskMediaFamily(
  sessionFamily: string | undefined,
  arkOk: boolean,
  agnesOk: boolean,
) {
  if (familyReady(sessionFamily, arkOk, agnesOk))
    return false
  return arkOk && agnesOk
}

function recommendedFamily<T extends string>(ready: T[], lastUsed?: string, fallback?: T) {
  if (lastUsed && ready.includes(lastUsed as T))
    return lastUsed as T
  return ready[0] || fallback
}

function familyOption(id: string, locale?: string) {
  const family = getMediaFamily(id)
  const zh = zhLocale(locale)
  const description = family?.provider === 'agnes'
    ? (zh ? '公开图像 URL 规则见服务连接说明。' : 'Public image URL rules still apply.')
    : (zh ? '火山方舟官方图像 / 视频模型。' : 'Official Ark image / video models.')
  return {
    id,
    label: family?.name || id,
    description,
  }
}

export function buildImageModelQuestion(input: MediaFamilyReadiness): ChoiceQuestion | null {
  const ready = readyImageFamilies(input.arkOk, input.agnesOk)
  if (ready.length < 2)
    return null
  const zh = zhLocale(input.locale)
  const recommendedId = recommendedFamily(ready, input.lastUsedImage, DEFAULT_IMAGE_FAMILY)
  return {
    id: IMAGE_MODEL_QUESTION,
    title: zh ? '生图模型' : 'Image model',
    prompt: zh ? '这一次用哪套生图模型？' : 'Which image model should this turn use?',
    recommendedId,
    options: withCustomChoiceOption(
      ready.map(id => familyOption(id, input.locale)),
      {
        label: zh ? '其他' : 'Other',
        description: zh ? '用 @模型 指定，或写明自定义组合。' : 'Mention @model, or type a custom combination.',
      },
    ),
  }
}

export function buildVideoModelQuestion(input: MediaFamilyReadiness): ChoiceQuestion | null {
  const ready = readyVideoFamilies(input.arkOk, input.agnesOk)
  if (ready.length < 2)
    return null
  const zh = zhLocale(input.locale)
  const recommendedId = recommendedFamily(ready, input.lastUsedVideo, DEFAULT_VIDEO_FAMILY)
  return {
    id: VIDEO_MODEL_QUESTION,
    title: zh ? '生视频模型' : 'Video model',
    prompt: zh ? '这一次用哪套生视频模型？' : 'Which video model should this turn use?',
    recommendedId,
    options: withCustomChoiceOption(
      ready.map(id => familyOption(id, input.locale)),
      {
        label: zh ? '其他' : 'Other',
        description: zh ? '用 @模型 指定，或写明自定义组合。' : 'Mention @model, or type a custom combination.',
      },
    ),
  }
}

export function buildLongformModelPreference(input: MediaFamilyReadiness): ChoiceQuestion {
  const zh = zhLocale(input.locale)
  const options: ChoiceQuestion['options'] = []
  if (input.arkOk) {
    options.push(
      {
        id: 'ark-economy',
        label: zh ? '经济 · Seedream 1K + Seedance 480p' : 'Economy · Seedream 1K + Seedance 480p',
        description: zh ? '长片默认档，静帧 1K，镜头先按 480p。' : 'Default long-form stack. Stills at 1K; clips start at 480p.',
      },
      {
        id: 'ark-high',
        label: zh ? '高品质 · Seedream 2K + Seedance 1080p' : 'High quality · Seedream 2K + Seedance 1080p',
        description: zh ? '静帧 2K，镜头最高 1080p。' : 'Stills at 2K; clips up to 1080p.',
      },
      {
        id: 'ark-hobby',
        label: zh ? '爱好 · Seedream 1K + Seedance 480p' : 'Hobby · Seedream 1K + Seedance 480p',
        description: zh ? '与经济档同一套模型，适合试拍。' : 'Same models as Economy, for casual drafts.',
      },
    )
  }
  if (input.agnesOk) {
    options.push({
      id: 'agnes',
      label: zh ? 'Agnes · Image 2.5 + Video 2.5' : 'Agnes · Image 2.5 + Video 2.5',
      description: zh ? '720p 视频，固定比例，无 generate_audio。' : '720p video, fixed ratios, no generate_audio.',
    })
  }
  const recommendedId = input.arkOk ? 'ark-economy' : 'agnes'
  return {
    id: MODEL_PREFERENCE_QUESTION,
    title: zh ? '长片模型' : 'Film models',
    prompt: zh ? '先选定这支片子用的图像和视频模型。' : 'Choose the image and video stack for this film.',
    recommendedId: options.some(option => option.id === recommendedId) ? recommendedId : options[0]?.id,
    options: withCustomChoiceOption(options, {
      label: zh ? '其他' : 'Other',
      description: zh ? '用 @模型 指定静帧和镜头模型。' : 'Mention @model for stills and clips.',
    }),
  }
}

export function mediaFamilyAskForGeneration(input: MediaFamilyReadiness & {
  kinds: Array<'image' | 'video' | 'model'>
  imageFamily?: string | null
  videoFamily?: string | null
}): AskUserArgs | null {
  if (input.kinds.includes('model') && !input.kinds.includes('image') && !input.kinds.includes('video'))
    return null
  const questions: ChoiceQuestion[] = []
  const locale = input.locale
  if (input.kinds.includes('image') && shouldAskMediaFamily(input.imageFamily || undefined, input.arkOk, input.agnesOk)) {
    const question = buildImageModelQuestion(input)
    if (question)
      questions.push(question)
  }
  if (input.kinds.includes('video') && shouldAskMediaFamily(input.videoFamily || undefined, input.arkOk, input.agnesOk)) {
    const question = buildVideoModelQuestion(input)
    if (question)
      questions.push(question)
  }
  if (!questions.length)
    return null
  const zh = zhLocale(locale)
  return {
    prompt: zh ? '生成前先选定已就绪的模型。' : 'Choose a ready model before generating.',
    recommendation: zh ? '跳过则使用推荐项。' : 'Skip to use the recommended option.',
    questions,
  }
}

function resolveOption(question: ChoiceQuestion | undefined, body: ChoiceBody) {
  if (!question)
    return
  const answer = body.answers?.find(item => item.questionId === question.id)
  const skipped = body.action === 'skip' || !answer || answer.skipped
  const optionId = skipped ? question.recommendedId : answer.optionId
  const option = question.options.find(item => item.id === optionId)
  if (!option)
    return
  if (option.custom)
    return !skipped && answer?.text?.trim() ? option : undefined
  return option
}

function applyPreference(optionId: string, result: MediaFamilyChoiceResult) {
  if (optionId === 'ark-high' || optionId === 'high') {
    result.imageFamily = 'ark-image'
    result.videoFamily = 'ark-video'
    result.quality = 'high'
    return
  }
  if (optionId === 'ark-economy' || optionId === 'economy') {
    result.imageFamily = 'ark-image'
    result.videoFamily = 'ark-video'
    result.quality = 'economy'
    return
  }
  if (optionId === 'ark-hobby' || optionId === 'hobby') {
    result.imageFamily = 'ark-image'
    result.videoFamily = 'ark-video'
    result.quality = 'hobby'
    return
  }
  if (optionId === 'agnes') {
    result.imageFamily = 'agnes-image'
    result.videoFamily = 'agnes-video'
    result.quality = 'hobby'
    return
  }
  if (optionId === 'custom')
    result.quality = 'custom'
}

export function mediaFamilyFromChoice(payload: ChoicePayload, body: ChoiceBody): MediaFamilyChoiceResult {
  const result: MediaFamilyChoiceResult = {}
  const image = resolveOption(payload.questions.find(question => question.id === IMAGE_MODEL_QUESTION), body)
  if (image && isImageFamilyId(image.id))
    result.imageFamily = image.id
  const video = resolveOption(payload.questions.find(question => question.id === VIDEO_MODEL_QUESTION), body)
  if (video && isVideoFamilyId(video.id))
    result.videoFamily = video.id
  const preference = resolveOption(payload.questions.find(question => question.id === MODEL_PREFERENCE_QUESTION), body)
  if (preference) {
    applyPreference(preference.id, result)
    if (preference.custom)
      result.quality = 'custom'
  }
  return result
}

export function hydrateAskUserArgs(args: AskUserArgs, input: MediaFamilyReadiness): AskUserArgs {
  const questions = args.questions.map((question) => {
    if (question.id === MODEL_PREFERENCE_QUESTION)
      return buildLongformModelPreference(input)
    if (question.id === IMAGE_MODEL_QUESTION)
      return buildImageModelQuestion(input) || question
    if (question.id === VIDEO_MODEL_QUESTION)
      return buildVideoModelQuestion(input) || question
    return question
  })
  return { ...args, questions }
}
