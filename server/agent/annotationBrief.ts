import type { AskUserArgs, ChatMessage, ChoiceAnswer, ChoiceQuestion } from './types'
import { normalizeAgentLocale } from '~~/shared/utils/agentLocale'
import { ANNOTATION_EDIT_GENERATION_TOOL } from '~~/shared/utils/imageAnnotations'
import { latestUserRequestIndex, skillCommandRequested, userRequestImages, userRequestText } from './userRequest'

export const ANNOTATION_SKILL_ID = 'image-annotation-edit'
export const ANNOTATION_METHOD_QUESTION = 'image_edit_method'
export const ANNOTATION_METHOD_OPTION = 'annotate'

export interface AnnotationBrief {
  /** Stills the user can annotate: this request's attachments, else existing session stills. */
  sourceUrls: string[]
  /** The image_edit_method card was answered or skipped, so it must not be asked again. */
  methodAnswered: boolean
  /** Points were saved and the server rendered the numbered guide. */
  confirmed: boolean
  generationSubmitted: boolean
}

/**
 * Tracks the explicit `/image-annotation-edit` workflow. The skill markdown alone
 * cannot keep a model from replying with prose instead of opening the card, so the
 * loop uses this state to force the annotation checkpoint and then the generation.
 */
export function annotationBrief(messages: ChatMessage[], sessionStills: string[] = []): AnnotationBrief | null {
  const start = latestUserRequestIndex(messages)
  if (start < 0)
    return null
  const request = messages[start]
  if (!skillCommandRequested(userRequestText(request), ANNOTATION_SKILL_ID))
    return null

  const attached = userRequestImages(request)
  const sourceUrls = [...new Set(attached.length ? attached : sessionStills)]
  const questionsByCall = new Map<string, ChoiceQuestion[]>()
  let methodAnswered = false
  let confirmed = false
  let confirmedAt = -1

  for (const [offset, message] of messages.slice(start + 1).entries()) {
    for (const call of message.tool_calls || []) {
      if (call.function.name !== 'ask_user')
        continue
      try {
        questionsByCall.set(call.id, JSON.parse(call.function.arguments).questions || [])
      }
      catch {
        // Ignore malformed calls that do not belong to this workflow.
      }
    }
    if (message.role !== 'tool' || typeof message.content !== 'string')
      continue
    const questions = questionsByCall.get(message.tool_call_id || '')
    if (!questions?.some(question => question.id === ANNOTATION_METHOD_QUESTION))
      continue
    try {
      const result = JSON.parse(message.content) as {
        ok?: boolean
        skipped?: boolean
        answers?: ChoiceAnswer[]
      }
      if (!result.ok)
        continue
      const answer = result.answers?.find(item => item.questionId === ANNOTATION_METHOD_QUESTION)
      if (!result.skipped && !answer)
        continue
      methodAnswered = true
      if (answer?.optionId === ANNOTATION_METHOD_OPTION && answer.annotationEdit?.annotatedImageUrl) {
        confirmed = true
        confirmedAt = start + 1 + offset
      }
    }
    catch {
      // Ignore tool results unrelated to this workflow.
    }
  }

  const generationSubmitted = confirmedAt >= 0
    && messages.slice(confirmedAt + 1).some(message =>
      message.tool_calls?.some(call => call.function.name === ANNOTATION_EDIT_GENERATION_TOOL),
    )

  return { sourceUrls, methodAnswered, confirmed, generationSubmitted }
}

export function assertAnnotationQuestion(messages: ChatMessage[], questions: ChoiceQuestion[], sessionStills: string[] = []) {
  const brief = annotationBrief(messages, sessionStills)
  // Without a source still the agent must ask for an upload in chat, not on a card.
  if (!brief || !brief.sourceUrls.length)
    return
  if (brief.confirmed)
    throw new Error('The user saved the annotation. Call generate_image now with the server-supplied references; do not ask another question.')
  // Later cards in the same turn (for example result_fix_decision) stay unconstrained.
  if (brief.methodAnswered)
    return
  const method = questions.find(question => question.id === ANNOTATION_METHOD_QUESTION)
  if (questions.length !== 1 || !method)
    throw new Error(`Follow the image-annotation-edit skill: call ask_user with exactly one ${ANNOTATION_METHOD_QUESTION} question and wait.`)
  if (!method.options.some(option => option.id === ANNOTATION_METHOD_OPTION))
    throw new Error(`The ${ANNOTATION_METHOD_QUESTION} card must include an ${ANNOTATION_METHOD_OPTION} option.`)
  if (method.recommendedId !== ANNOTATION_METHOD_OPTION)
    throw new Error(`Recommend the ${ANNOTATION_METHOD_OPTION} option so the editor opens immediately.`)
}

/** Localized ask_user payload that opens the numbered-point editor. */
export function annotationAskUserArgs(locale?: string): AskUserArgs {
  const zh = normalizeAgentLocale(locale) === 'zh'
  return {
    prompt: zh ? '在图上标注要修改的位置。' : 'Mark the edits on the image.',
    recommendation: zh ? '点击图片添加编号点，并写清每个点要改什么。' : 'Click the image to add numbered points, then describe each change.',
    questions: [{
      id: ANNOTATION_METHOD_QUESTION,
      title: zh ? '标注修图' : 'Annotated edit',
      prompt: zh ? '点击图片放置编号点，并在右侧写下每个点的修改说明。' : 'Click the image to place numbered points, then describe each change.',
      recommendedId: ANNOTATION_METHOD_OPTION,
      options: [{
        id: ANNOTATION_METHOD_OPTION,
        label: zh ? '标注修改位置' : 'Mark locations',
        description: zh ? '点击图片添加 1–16 个编号点' : 'Click the image to add 1–16 numbered points',
      }],
    }],
  }
}
