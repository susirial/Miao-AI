/** Keep ask_user turns readable; hide generation-tool preambles in think tags. */

export function askUserPublicPrompt(calls: Array<{ name?: string, arguments?: string }>) {
  for (const call of calls) {
    if (call.name !== 'ask_user' || !call.arguments)
      continue
    try {
      const parsed = JSON.parse(call.arguments) as {
        prompt?: unknown
        intro?: unknown
        questions?: Array<{ prompt?: unknown, title?: unknown }>
      }
      const prompt = String(parsed.prompt ?? parsed.intro ?? '').trim()
      if (prompt)
        return prompt.slice(0, 400)
      const first = parsed.questions?.[0]
      const fallback = String(first?.prompt ?? first?.title ?? '').trim()
      if (fallback)
        return fallback.slice(0, 400)
    }
    catch {
      // Ignore malformed tool arguments and keep looking.
    }
  }
  return ''
}

export function wrapAssistantLoopText(input: {
  reasoning: string
  text: string
  hasToolCalls: boolean
  askingUser: boolean
  askUserPrompt?: string
}) {
  const { reasoning, text, hasToolCalls, askingUser, askUserPrompt = '' } = input
  if (!reasoning && !(hasToolCalls && text))
    return text
  if (askingUser) {
    const publicText = text.trim() || askUserPrompt.trim()
    return reasoning ? `<think>${reasoning}</think>${publicText}` : publicText
  }
  const thinking = [reasoning, hasToolCalls ? text : ''].filter(Boolean).join('\n\n')
  return `<think>${thinking}</think>${hasToolCalls ? '' : text}`
}
