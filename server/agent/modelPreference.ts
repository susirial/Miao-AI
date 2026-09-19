import type { AgentQuality, ChoiceBody, ChoicePayload } from './types'
import { mediaFamilyFromChoice } from './mediaFamilyChoice'

/** Only a matching model-preference card can change the generation preset. */
export function modelPreferenceFromChoice(payload: ChoicePayload, body: ChoiceBody): AgentQuality | undefined {
  return mediaFamilyFromChoice(payload, body).quality
}
