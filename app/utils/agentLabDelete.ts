export interface DeletableAgent {
  id: string
  sessionId?: string
  title?: string
  messages?: unknown[]
  images?: unknown[]
  draft?: string
  confirmation?: unknown
  choice?: unknown
  attachments?: unknown[]
  busy?: boolean
  pending?: boolean
  status?: string
  updatedAt?: number
}

export function isEmptyDeletableAgent(agent: DeletableAgent) {
  return !String(agent.sessionId || '').trim()
    && !(agent.messages || []).length
    && !(agent.images || []).length
    && !(agent.draft || '').trim()
    && !(agent.attachments || []).length
    && !agent.confirmation
    && !agent.choice
}

export function isAgentBusy(agent: DeletableAgent) {
  return Boolean(agent.busy || agent.pending)
    || agent.status === 'thinking'
    || agent.status === 'calling_tool'
    || agent.status === 'generating'
    || agent.status === 'queued'
}

export function canDeleteAgent(agents: DeletableAgent[], agentId: string, options?: {
  attaching?: boolean
  deletingId?: string
}) {
  const agent = agents.find(item => item.id === agentId)
  if (!agent || options?.deletingId)
    return false
  if (options?.attaching && agents.length === 1)
    return false
  if (isAgentBusy(agent))
    return false
  if (agents.length === 1 && isEmptyDeletableAgent(agent))
    return false
  return true
}

export function nextAgentAfterDelete<T extends DeletableAgent>(agents: T[], deletedId: string) {
  const remaining = agents.filter(agent => agent.id !== deletedId)
  remaining.sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0))
  return remaining[0] || null
}

export function mergeRetainedCanvasImages<T extends { id: string }>(current: T[], incoming: T[]) {
  const byId = new Map(current.map(item => [item.id, item]))
  for (const item of incoming) {
    if (item?.id)
      byId.set(item.id, item)
  }
  return [...byId.values()]
}

export function applyRemovedSessionIds<T extends { id: string, sessionId?: string }>(
  agents: T[],
  removedSessionIds: Iterable<string>,
  activeAgentId: string,
) {
  const removed = new Set([...removedSessionIds].map(id => String(id || '').trim()).filter(Boolean))
  const remaining = agents.filter(agent => !removed.has(String(agent.sessionId || '')))
  const activeRemoved = removed.has(String(agents.find(agent => agent.id === activeAgentId)?.sessionId || ''))
    || remaining.every(agent => agent.id !== activeAgentId)
  return {
    agents: remaining,
    nextActiveId: activeRemoved ? nextAgentAfterDelete(remaining, '')?.id || remaining[0]?.id || '' : activeAgentId,
  }
}

export function applySuccessfulAgentDelete<T extends DeletableAgent>(
  agents: T[],
  deletedId: string,
  activeAgentId: string,
  createEmpty: () => T,
) {
  const fallback = nextAgentAfterDelete(agents, deletedId) || createEmpty()
  const remaining = agents.filter(agent => agent.id !== deletedId)
  return {
    fallback,
    switchActive: deletedId === activeAgentId,
    agents: remaining.some(agent => agent.id === fallback.id)
      ? remaining
      : [...remaining, fallback],
  }
}

export function labStorageKey(projectId: string) {
  return `miao-agent-lab-v2:${projectId || 'home'}`
}
