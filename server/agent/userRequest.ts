import type { ChatMessage } from './types'

/** The turn's originating request: the last message the user actually sent. */
export function latestUserRequestIndex(messages: ChatMessage[]) {
  return messages.findLastIndex(message => message.role === 'user' && !message.internal)
}

export function userRequestText(message?: ChatMessage) {
  if (typeof message?.content === 'string')
    return message.content
  return message?.content?.filter(part => part.type === 'text').map(part => part.text).join('\n') || ''
}

export function userRequestImages(message?: ChatMessage) {
  if (!Array.isArray(message?.content))
    return []
  return message.content.flatMap(part => part.type === 'image_url' ? [part.image_url.url] : [])
}

export function skillCommandRequested(text: string, skillId: string) {
  return new RegExp(`(?:^|\\s)/${skillId}(?=\\s|$)`).test(text)
}
