export const AGENT_STOP_NOTE = 'Stopped.'
export const AGENT_STOP_WITH_GENERATIONS_NOTE = 'Stopped. In-progress generations will keep running.'
export const AGENT_INTERRUPT_NOTE = 'Connection interrupted. Please try again.'

export function agentStopNote(inFlightGenerations: number) {
  return inFlightGenerations > 0
    ? AGENT_STOP_WITH_GENERATIONS_NOTE
    : AGENT_STOP_NOTE
}

export function isAgentStopNote(value: unknown) {
  return value === AGENT_STOP_NOTE || value === AGENT_STOP_WITH_GENERATIONS_NOTE
}

export function isAgentInterruptNote(value: unknown) {
  return value === AGENT_INTERRUPT_NOTE
}

/** Local stop bubbles must not hide a still-open ask_user card after hydrate. */
export function dropStaleStopNotesForPendingChoice<T extends {
  role?: string
  content?: unknown
  choice?: unknown
  confirmation?: unknown
  imageIds?: unknown[]
  kind?: string
}>(messages: T[]): T[] {
  let next = messages
  while (next.length) {
    const last = next[next.length - 1]!
    if (
      last.role === 'assistant'
      && isAgentStopNote(last.content)
      && !last.choice
      && !last.confirmation
      && !last.imageIds?.length
      && last.kind !== 'error'
    ) {
      if (next === messages)
        next = messages.slice()
      next.pop()
      continue
    }
    break
  }
  return next
}
