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

export function clearSessionTombstones() {
  removedSessionIds.clear()
}

const deletingSessionIds = new Set<string>()

function chatError(statusCode: number, statusMessage: string): never {
  throw Object.assign(new Error(statusMessage), { statusCode, statusMessage })
}

export function isChatDeleted(doc?: { deletedAt?: Date | string | null } | null) {
  return Boolean(doc?.deletedAt)
}

export function isSessionDeletionInFlight(sessionId?: string) {
  return deletingSessionIds.has(String(sessionId || '').trim())
}

export function beginSessionDeletion(sessionId: string) {
  const id = String(sessionId || '').trim()
  if (!id)
    return
  if (deletingSessionIds.has(id))
    chatError(409, 'This conversation is already being deleted')
  deletingSessionIds.add(id)
}

export function endSessionDeletion(sessionId: string) {
  deletingSessionIds.delete(String(sessionId || '').trim())
}

export function assertSessionWritable(sessionId?: string) {
  const id = String(sessionId || '').trim()
  if (!id)
    return
  if (isSessionRemoved(id) || isSessionDeletionInFlight(id))
    chatError(409, 'This conversation was deleted')
}

export function aliveChatFilter(extra: Record<string, unknown> = {}) {
  return {
    $and: [
      extra,
      {
        $or: [
          { deletedAt: { $exists: false } },
          { deletedAt: null },
        ],
      },
    ],
  }
}
