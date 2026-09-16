interface SourceMessage {
  id: string
  role: 'user' | 'assistant'
  imageIds?: string[]
}

interface SourceMedia {
  id: string
  url: string
  kind?: string
}

export function annotationSourcesForChoice<T extends SourceMessage>(
  messages: T[],
  choiceMessageId: string,
  mediaFor: (message: T) => SourceMedia[],
) {
  const choiceIndex = messages.findIndex(message => message.id === choiceMessageId)
  if (choiceIndex < 0)
    return []
  let requestIndex = choiceIndex - 1
  while (requestIndex >= 0 && messages[requestIndex]?.role !== 'user')
    requestIndex--
  const request = messages[requestIndex]
  if (!request)
    return []
  const current = mediaFor(request).filter(item => item.kind !== 'video' && item.url)
  if (current.length || request.imageIds?.length)
    return current.map(item => ({ id: item.id, url: item.url }))
  for (let index = requestIndex - 1; index >= 0; index--) {
    const prior = messages[index]
    if (!prior)
      continue
    const media = mediaFor(prior).filter(item => item.kind !== 'video' && item.url)
    if (media.length)
      return media.map(item => ({ id: item.id, url: item.url }))
  }
  return []
}
