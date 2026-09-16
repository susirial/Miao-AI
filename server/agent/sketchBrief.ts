import type { AgentImage, ChatMessage, ChoiceAnswer, ChoiceQuestion } from './types'
import {
  SKETCH_MAX_INPUTS,
  SKETCH_TO_IMAGE_GENERATION_TOOL,
  SKETCH_TO_IMAGE_MODEL,
} from '~~/shared/utils/sketchToImage'
import { latestUserRequestIndex, skillCommandRequested, userRequestImages, userRequestText } from './userRequest'

export const SKETCH_QUESTIONS = ['sketch_references', 'sketch_understanding'] as const

interface SketchReference {
  url: string
  name: string
}

interface SketchChoiceAnswer extends ChoiceAnswer {
  referenceImages?: SketchReference[]
}

export function sketchBrief(messages: ChatMessage[]) {
  const start = latestUserRequestIndex(messages)
  if (start < 0)
    return null
  const request = messages[start]
  const text = userRequestText(request)
  if (!text.includes('(model:sketch-to-image)') && !skillCommandRequested(text, 'sketch-to-image'))
    return null

  const initialUrls = userRequestImages(request)
  let referencesDone = false
  let understandingDone = false
  let confirmedUnderstanding = ''
  let cancelled = false
  let references: SketchReference[] = []
  const calls = new Map<string, ChoiceQuestion[]>()

  for (const message of messages.slice(start + 1)) {
    for (const call of message.tool_calls || []) {
      if (call.function.name !== 'ask_user')
        continue
      try {
        calls.set(call.id, JSON.parse(call.function.arguments).questions || [])
      }
      catch {
        // Ignore malformed calls that do not belong to this workflow.
      }
    }
    if (message.role !== 'tool' || typeof message.content !== 'string')
      continue
    const questions = calls.get(message.tool_call_id || '')
    if (questions?.length !== 1)
      continue
    const question = questions[0]!
    try {
      const result = JSON.parse(message.content)
      if (!result.ok)
        continue
      const answer = (result.answers as SketchChoiceAnswer[] | undefined)?.find(item => item.questionId === question.id)
      const skipped = Boolean(result.skipped || answer?.skipped)
      if (question.id === 'sketch_references' && (skipped || ['yes', 'no'].includes(answer?.optionId || ''))) {
        referencesDone = true
        references = answer?.optionId === 'yes' ? answer.referenceImages || [] : []
        understandingDone = false
        confirmedUnderstanding = ''
      }
      if (question.id === 'sketch_understanding' && referencesDone) {
        cancelled = answer?.optionId === 'cancel'
        understandingDone = !skipped && answer?.optionId === 'correct'
        confirmedUnderstanding = understandingDone
          ? String(result.confirmedUnderstanding || question.prompt || '')
          : ''
      }
    }
    catch {
      // Ignore tool results unrelated to this workflow.
    }
  }

  const inputUrls = [...new Set([...initialUrls, ...references.map(image => image.url)])]
  return {
    inputUrls,
    referencesDone,
    understandingDone,
    confirmedUnderstanding,
    cancelled,
  }
}

export function sketchGenerationSubmitted(messages: ChatMessage[], images: AgentImage[]) {
  const start = latestUserRequestIndex(messages)
  if (start < 0)
    return false
  return messages.slice(start + 1).some(message => message.tool_calls?.some(call =>
    call.function.name === SKETCH_TO_IMAGE_GENERATION_TOOL
    && images.some(image => image.id === call.id && image.modelId === SKETCH_TO_IMAGE_MODEL),
  ))
}

export function assertSketchQuestion(messages: ChatMessage[], questions: ChoiceQuestion[]) {
  const brief = sketchBrief(messages)
  if (!brief)
    return
  if (!brief.inputUrls.length)
    throw new Error('Save the sketch in the project before asking questions.')
  if (brief.inputUrls.length > SKETCH_MAX_INPUTS)
    throw new Error(`Sketch to Image accepts at most ${SKETCH_MAX_INPUTS} total images.`)
  if (brief.cancelled)
    throw new Error('The sketch workflow was cancelled. Wait for a new user request.')
  if (brief.understandingDone)
    throw new Error('The user confirmed the understanding. Call generate_image now with every input in reference_images; do not ask another question.')

  const next = !brief.referencesDone ? 'sketch_references' : 'sketch_understanding'
  if (questions.length !== 1 || questions[0]?.id !== next)
    throw new Error(`Follow the sketch-to-image skill: call ask_user with exactly one ${next} question and wait.`)
  const required = next === 'sketch_understanding' ? ['correct', 'adjust'] : ['yes', 'no']
  if (required.some(id => !questions[0]!.options.some(option => option.id === id)))
    throw new Error(`The ${next} card must include ${required.join(', ')} options.`)
}

export function validateSketchReferences(value: unknown, occupiedInputs = 1) {
  const remaining = Math.max(0, SKETCH_MAX_INPUTS - occupiedInputs)
  if (!Array.isArray(value) || !value.length)
    throw new Error(`Choose between 1 and ${remaining} additional reference images, or select No.`)
  const result: SketchReference[] = []
  for (const item of value) {
    if (!item || typeof item.url !== 'string' || !/^https?:\/\//i.test(item.url))
      throw new Error('Choose a valid uploaded or project image.')
    if (!result.some(image => image.url === item.url))
      result.push({ url: item.url, name: String(item.name || 'Reference image').slice(0, 100) })
  }
  if (result.length > remaining)
    throw new Error(`Choose between 1 and ${remaining} additional reference images, or select No.`)
  return result
}
