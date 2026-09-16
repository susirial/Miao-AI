export function dropRemovedCanvasImages<T extends { id: string }>(items: T[], removedIds: Set<string>): T[] {
  if (!removedIds.size)
    return items
  return items.filter(item => !removedIds.has(item.id))
}

export function dropRemovedImageIdsFromMessages<T extends { imageIds?: string[] }>(messages: T[], removedIds: Set<string>): T[] {
  if (!removedIds.size)
    return messages
  return messages.map((message) => {
    if (!message.imageIds?.some(id => removedIds.has(id)))
      return message
    return { ...message, imageIds: message.imageIds.filter(id => !removedIds.has(id)) }
  })
}

export function stripRemovedImagesFromAgent<T extends { images?: Array<{ id: string }>, messages?: Array<{ imageIds?: string[] }> }>(agent: T, removedIds: Set<string>): T {
  if (!removedIds.size)
    return agent
  return {
    ...agent,
    images: (agent.images || []).filter(image => !removedIds.has(image.id)),
    messages: dropRemovedImageIdsFromMessages(agent.messages || [], removedIds),
  }
}

export function collectProjectCanvasImages<T extends { id: string, url?: string }>(
  agents: Array<{ images?: T[] }>,
  current: T[],
  removedIds: Set<string>,
): T[] {
  const byId = new Map<string, T>()
  for (const agent of agents) {
    for (const image of agent.images || []) {
      if (!image.url || removedIds.has(image.id) || byId.has(image.id))
        continue
      byId.set(image.id, image)
    }
  }
  for (const image of current) {
    if (!image.url || removedIds.has(image.id))
      continue
    byId.set(image.id, image)
  }
  return [...byId.values()]
}

export function sessionIdsOwningImages(
  records: Array<{ sessionId?: string, images?: Array<{ id: string }> }>,
  imageIds: Iterable<string>,
): string[] {
  const ids = new Set([...imageIds].map(id => String(id || '').trim()).filter(Boolean))
  const sessions = new Set<string>()
  if (!ids.size)
    return []
  for (const record of records) {
    const sessionId = String(record.sessionId || '').trim()
    if (!sessionId || !record.images?.some(image => ids.has(image.id)))
      continue
    sessions.add(sessionId)
  }
  return [...sessions]
}
