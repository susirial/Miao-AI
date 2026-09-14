const removedSessionIds = new Set<string>()

export function markSessionsRemoved(sessionIds: Iterable<string>) {
  for (const id of sessionIds) {
    const sessionId = String(id || '').trim()
    if (sessionId)
      removedSessionIds.add(sessionId)
  }
}

export function isSessionRemoved(sessionId: string) {
  return removedSessionIds.has(String(sessionId || '').trim())
}
