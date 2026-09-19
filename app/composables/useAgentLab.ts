import type { AgentConfirmPolicy, AgentQuality } from '~~/shared/types/agentPreferences'
import type { GenerationJobPublic } from '~~/shared/types/generation'
import type { ImageAnnotationEdit } from '~~/shared/utils/imageAnnotations'
import { isGenerationFailureRetryable, isNonRetryableGenerationFailure, publicGenerationFailMessage } from '~~/shared/types/generation'
import { isInternalAgentChatText, publicAgentChatText } from '~~/shared/utils/agentChatVisibility'
import { isAgentTransientMessage } from '~~/shared/utils/agentHistoryVisibility'
import { agentRecoveryNotice, isAgentDisconnectError as isDisconnectError, recoverAgentTranscript } from '~~/shared/utils/agentRecovery'
import { agentStopNote, dropStaleStopNotesForPendingChoice, isAgentStopNote } from '~~/shared/utils/agentStopNote'
import { isMediaUrl, isMediaVideoUrl } from '~~/shared/utils/mediaUrl'
import { confirmationMedia, reconcileConfirmationStates } from '~/utils/agentConfirmationState'
import { buildOptimisticGenerationImages } from '~/utils/agentOptimisticGeneration'
import { applyRemovedSessionIds, applySuccessfulAgentDelete, canDeleteAgent, isEmptyDeletableAgent, labStorageKey, mergeRetainedCanvasImages } from '~/utils/agentLabDelete'
import { collectProjectCanvasImages, dropRemovedCanvasImages, dropRemovedImageIdsFromMessages, sessionIdsOwningImages, stripRemovedImagesFromAgent } from '~/utils/canvasImageDelete'
import { useServiceConnection } from './useServiceConnection'

export type { AgentConfirmPolicy, AgentQuality }
export type AgentStatus = 'idle' | 'thinking' | 'calling_tool' | 'generating' | 'queued'
export type VideoFamily = 'seedance-2'
export type UncertainField = 'prompt' | 'aspect_ratio' | 'resolution' | 'duration'
export type AgentImageKind = 'still' | 'upload' | 'video'
export type ConfirmationKind = 'image' | 'video' | 'mixed'
export interface AgentImage {
  optimistic?: boolean
  modelId?: string
  modelInput?: Record<string, unknown>
  name?: string
  id: string
  kind?: AgentImageKind
  status: 'generating' | 'success' | 'fail'
  prompt: string
  aspectRatio: string
  resolution: string
  url: string
  error: string
  failCode?: string
  retryable?: boolean
  sourceUrl?: string
  inputUrls?: string[]
  referenceVideoUrls?: string[]
  duration?: number
  videoMode?: 'text' | 'image' | 'reference' | 'concat'
  videoFamily?: VideoFamily
  providerTaskId?: string
}
export interface PendingAttachment {
  id: string
  name: string
  previewUrl: string
  url: string
  status: 'uploading' | 'ready' | 'fail'
  error: string
  imageId?: string
}
export interface ConfirmationPayload {
  jobs?: Array<{
    id: string
    name: string
    modelName: string
    task: string
    inputUrls: string[]
    params: ConfirmationPayload['params']
  }>
  id: string
  kind?: ConfirmationKind
  reason: string
  uncertainFields: string[]
  count?: number

  modelName?: string
  task?: string
  inputUrls?: string[]
  approvedBy?: 'agent' | 'user'
  params: {
    modelId?: string
    modelInput?: Record<string, unknown>
    prompt: string
    aspectRatio: string
    resolution: string
    duration?: number
    videoMode?: 'text' | 'image' | 'reference'
    videoFamily?: VideoFamily
  }
}
export interface ChoiceOption {
  id: string
  label: string
  description?: string
  custom?: boolean
}
export interface ChoiceQuestion {
  id: string
  title?: string
  prompt: string
  options: ChoiceOption[]
  recommendedId?: string
}
export interface ChoicePayload {
  id: string
  prompt: string
  recommendation?: string
  questions: ChoiceQuestion[]
}
export interface ChoiceAnswer {
  questionId: string
  optionId?: string
  label?: string
  text?: string
  skipped?: boolean
  annotationEdit?: ImageAnnotationEdit
  referenceImages?: Array<{ url: string, name: string }>
}
export interface AgentChatMessage {
  id: string
  role: 'user' | 'assistant'
  kind?: 'error'
  content: string
  streaming?: boolean
  imageIds?: string[]
  confirmation?: ConfirmationPayload
  confirmationState?: 'pending' | 'confirmed' | 'cancelled' | 'blocked'
  resolvedParams?: ConfirmationPayload['params']
  choice?: ChoicePayload
  choiceState?: 'pending' | 'answered' | 'skipped'
  choiceAnswers?: ChoiceAnswer[]
}
interface AgentEvent {
  remaining?: number
  required?: number
  type: string
  sessionId?: string
  delta?: string
  status?: AgentStatus
  title?: string
  confirmation?: ConfirmationPayload
  choice?: ChoicePayload
  image?: AgentImage
  replay?: boolean
  message?: string
  limit?: number
  active?: number
}
export interface AgentListItem {
  id: string
  title: string
  busy: boolean
  canDelete?: boolean
}
type AgentTitleSource = 'default' | 'auto' | 'manual'
interface StoredAgent {
  id: string
  title: string
  titleSource?: AgentTitleSource
  sessionId?: string
  messages?: AgentChatMessage[]
  images?: AgentImage[]
  confirmation?: ConfirmationPayload | null
  choice?: ChoicePayload | null
  draft?: string
  status?: AgentStatus
  pending?: boolean
  busy?: boolean
  queueNotice?: string
  updatedAt?: number
}
interface StoredLab {
  activeAgentId?: string
  agents?: StoredAgent[]
  sessionId?: string
  messages?: AgentChatMessage[]
  images?: AgentImage[]
  confirmation?: ConfirmationPayload | null
  choice?: ChoicePayload | null
  retainedCanvasImages?: AgentImage[]
  removedSessionIds?: string[]
}
const STORAGE_PREFIX = 'miao-agent-lab-v2:'
const LEGACY_STORAGE_PREFIX = 'polox-agent-lab-v2:'
const COMPOSER_DRAFT_KEY = 'miao-agent-composer-draft'
const LEGACY_COMPOSER_DRAFT_KEYS = ['polox-agent-composer-draft', 'polox-agent-guest-draft']
let composerDraftMemory = ''
const MAX_CHAT_MESSAGES = 60
const MAX_CHAT_IMAGES = 48
const MAX_MESSAGE_CHARS = 8000
const MAX_AGENTS = 20
const MAX_AGENT_TITLE = 48
const DEFAULT_AGENT_TITLE = 'New agent'
function clipMessageContent(value: string) {
  if (value.length <= MAX_MESSAGE_CHARS)
    return value
  return value.slice(value.length - MAX_MESSAGE_CHARS)
}
function titleFromMessage(value: string) {
  const compact = value.replace(/\s+/g, ' ').trim()
  if (!compact)
    return ''
  if (compact.length <= MAX_AGENT_TITLE)
    return compact
  return `${compact.slice(0, MAX_AGENT_TITLE).trim()}…`
}
function sanitizeChatMessages(items: AgentChatMessage[]) {
  const out: AgentChatMessage[] = []
  for (const item of items) {
    if (item.kind === 'error') {
      if (isAgentTransientMessage(item))
        continue
      out.push(item)
      continue
    }
    const raw = item.content || ''
    if (item.role === 'user' && isInternalAgentChatText(raw))
      continue
    if (item.role === 'user') {
      const content = publicAgentChatText(raw)
      // Keep attachment-only user turns (thumbs via imageIds) even if text strips empty.
      if (!content && !(item.imageIds?.length || item.confirmation))
        continue
      out.push(content === raw ? item : { ...item, content })
      continue
    }
    out.push(item)
  }
  return out
}
function trimChatMessages(items: AgentChatMessage[]) {
  const clipped = sanitizeChatMessages(items).map(item => (item.content.length > MAX_MESSAGE_CHARS
    ? { ...item, content: clipMessageContent(item.content) }
    : item))
  if (clipped.length <= MAX_CHAT_MESSAGES)
    return clipped
  const pending = clipped.filter(item => item.confirmationState === 'pending' || item.choiceState === 'pending')
  const kept = clipped.slice(-MAX_CHAT_MESSAGES)
  for (const item of pending) {
    if (!kept.some(row => row.id === item.id))
      kept.push(item)
  }
  return kept
}
function agentJobTaskId(imageId: string) {
  return `agent_${imageId}`.slice(0, 120)
}
function isRetryableJobFail(item: AgentImage) {
  if (isNonRetryableGenerationFailure(item))
    return false
  return !/blocked|cancelled|not retried to avoid duplicate/i.test(item.error || '')
}
function isSessionLockError(message: string) {
  return /this session is already running|this agent lab session is already running/i.test(message)
}
function isEmptyStoredAgent(agent: StoredAgent) {
  // An unsent draft (a picked skill, a typed prompt) is real work: keep that agent.
  return !agent.sessionId
    && !(agent.messages || []).length
    && !(agent.images || []).length
    && !(agent.draft || '').trim()
}
function mergeSessionImages(local: AgentImage[], remote: AgentImage[]) {
  const byId = new Map(local.map(item => [item.id, item]))
  return remote.map((item) => {
    const current = byId.get(item.id)
    if (!current)
      return item
    if (item.status === 'fail' || item.status === 'success')
      return item
    if (current.status === 'success' && current.url && item.status === 'generating')
      return current
    if (current.status === 'fail' && item.status === 'generating' && !item.url)
      return current
    return item
  })
}
function unionSessionImages(left: AgentImage[], right: AgentImage[]) {
  if (!left.length)
    return right
  if (!right.length)
    return left
  const ids = [...new Set([...left, ...right].map(item => item.id))]
  const byLeft = new Map(left.map(item => [item.id, item]))
  const byRight = new Map(right.map(item => [item.id, item]))
  return ids.map((id) => {
    const a = byLeft.get(id)
    const b = byRight.get(id)
    if (!a)
      return b!
    if (!b)
      return a
    return mergeSessionImages([a], [b])[0] || b
  })
}
function readStore(key: string): StoredLab | null {
  if (!import.meta.client || !key)
    return null
  try {
    const raw = localStorage.getItem(key)
    if (!raw)
      return null
    return JSON.parse(raw) as StoredLab
  }
  catch {
    return null
  }
}
function parseSseBlock(block: string) {
  let eventName = ''
  const dataLines: string[] = []
  for (const line of block.split('\n')) {
    if (line.startsWith('event:'))
      eventName = line.slice(6).trim()
    else if (line.startsWith('data:'))
      dataLines.push(line.slice(5).trim())
  }
  if (!dataLines.length)
    return null
  try {
    const parsed = JSON.parse(dataLines.join('\n')) as AgentEvent
    if (!parsed.type && eventName)
      parsed.type = eventName
    return parsed
  }
  catch {
    return null
  }
}
function readComposerDraft() {
  if (!import.meta.client)
    return composerDraftMemory
  try {
    if (sessionStorage.getItem(COMPOSER_DRAFT_KEY) === null) {
      const legacy = LEGACY_COMPOSER_DRAFT_KEYS
        .map(key => sessionStorage.getItem(key))
        .find(value => value !== null)
      if (legacy !== undefined)
        sessionStorage.setItem(COMPOSER_DRAFT_KEY, legacy || '')
    }
    for (const key of LEGACY_COMPOSER_DRAFT_KEYS)
      sessionStorage.removeItem(key)
    return String(sessionStorage.getItem(COMPOSER_DRAFT_KEY) || composerDraftMemory || '')
  }
  catch {
    return composerDraftMemory
  }
}
function writeComposerDraft(value: string) {
  composerDraftMemory = value
  if (!import.meta.client)
    return
  try {
    if (value)
      sessionStorage.setItem(COMPOSER_DRAFT_KEY, value)
    else
      sessionStorage.removeItem(COMPOSER_DRAFT_KEY)
  }
  catch {
    // Ignore quota / private mode.
  }
}
function clearComposerDraft() {
  writeComposerDraft('')
}
const agentLabs = new Map<string, ReturnType<typeof createAgentLab>>()
/** Interface language, so the agent answers in it even on an attachment-only turn. */
const uiLocale = ref('')
function agentLabCacheKey(projectId: string) {
  const pid = String(projectId || '').trim()
  if (!pid)
    return ''
  return pid
}
export function useAgentLab(options?: {
  projectId?: MaybeRefOrGetter<string>
  onJobs?: (jobs: GenerationJobPublic[]) => void
}) {
  const connection = useServiceConnection()
  const { locale } = useI18n()
  watchEffect(() => {
    uiLocale.value = String(locale.value || '')
  })
  function resolveLab() {
    const projectId = String(toValue(options?.projectId) || '').trim()
    const key = agentLabCacheKey(projectId)
    const existing = key ? agentLabs.get(key) : undefined
    if (existing) {
      existing.bindOptions({ onJobs: options?.onJobs })
      return existing
    }
    // Keep a runtime bound to its original project, including pending async work.
    const lab = effectScope(true).run(() => createAgentLab({
      projectId,
      onJobs: options?.onJobs,
    }))!
    if (key)
      agentLabs.set(key, lab)
    return lab
  }
  const currentLab = shallowRef(resolveLab())
  watch(() => agentLabCacheKey(String(toValue(options?.projectId) || '')), () => {
    currentLab.value.flush()
    currentLab.value = resolveLab()
    void currentLab.value.ensureHydrated()
  }, { flush: 'sync' })
  onMounted(() => { void currentLab.value.ensureHydrated() })
  onUnmounted(() => { currentLab.value.flush() })
  // Consumers destructure refs and actions, so both must follow the active runtime.
  return Object.fromEntries(Object.entries(currentLab.value).map(([key, value]) => {
    const read = () => Reflect.get(currentLab.value, key)
    return [key, isRef(value)
      ? computed({
          get: () => read().value,
          set: (next) => { read().value = next },
        })
      : key === 'sendMessage'
        ? async (...args: unknown[]) => {
          if (!await connection.ensureConnected())
            return false
          return Reflect.apply(read(), currentLab.value, args)
        }
        : (...args: unknown[]) => Reflect.apply(read(), currentLab.value, args)]
  })) as unknown as ReturnType<typeof createAgentLab>
}
function createAgentLab(options?: {
  projectId?: MaybeRefOrGetter<string>
  onJobs?: (jobs: GenerationJobPublic[]) => void
}) {
  let bootstrapped = false
  const baseUrl = '/api/agent'
  const onJobs = ref(options?.onJobs)
  const projectScope = ref(String(toValue(options?.projectId) || '').trim())
  const persistedCanvasIds = new Set<string>()
  const persistingCanvasIds = new Set<string>()
  const patchedInputIds = new Set<string>()
  const removedCanvasImageIds = new Set<string>()
  const removedCanvasImageVersion = ref(0)
  function rememberRemovedImageIds(ids: Iterable<string>) {
    let changed = false
    for (const raw of ids) {
      const id = String(raw || '').trim()
      if (!id || removedCanvasImageIds.has(id))
        continue
      removedCanvasImageIds.add(id)
      changed = true
    }
    if (changed)
      removedCanvasImageVersion.value += 1
  }
  function withoutRemovedImages(items: AgentImage[]) {
    void removedCanvasImageVersion.value
    return dropRemovedCanvasImages(items, removedCanvasImageIds)
  }
  const storageKey = computed(() => `${STORAGE_PREFIX}${projectScope.value || 'home'}`)
  const sessionId = ref('')
  const messages = ref<AgentChatMessage[]>([])
  const images = ref<AgentImage[]>([])
  const status = ref<AgentStatus>('idle')
  const confirmation = ref<ConfirmationPayload | null>(null)
  const choice = ref<ChoicePayload | null>(null)
  const online = ref<boolean | null>(null)
  const error = ref('')
  let agentWriteRetryAt = 0
  const pending = ref(false)
  const stopping = ref(false)
  const draft = ref('')
  const attachments = ref<PendingAttachment[]>([])
  const { qualityPreference, confirmPolicy } = useAgentPreferences()
  const storedAgents = ref<StoredAgent[]>([])
  const activeAgentId = ref('')
  const agentTitle = ref(DEFAULT_AGENT_TITLE)
  const titleSource = ref<AgentTitleSource>('default')
  const queueNotice = ref('')
  const retainedCanvasImages = ref<AgentImage[]>([])
  const removedSessionIds = ref<string[]>([])
  const deletingAgentId = ref('')
  const deleteError = ref('')
  let disposed = false
  let scopeEpoch = 0
  let streamEpoch = 0
  let activeTurns = 0
  let hydrating = false
  const busy = computed(() => pending.value || status.value !== 'idle')
  const waitingForUserConfirm = computed(() => Boolean(confirmation.value) && confirmation.value?.approvedBy !== 'agent')
  const waitingForUserChoice = computed(() => Boolean(choice.value))
  const waitingForUser = computed(() => waitingForUserConfirm.value || waitingForUserChoice.value)
  const attaching = computed(() => attachments.value.some(item => item.status === 'uploading'))
  const readyAttachments = computed(() => attachments.value.filter(item => item.status === 'ready' && item.url))
  const canSwitchAgent = computed(() => {
    if (deletingAgentId.value || attaching.value)
      return false
    if (status.value === 'thinking' || status.value === 'calling_tool')
      return false
    return true
  })
  function isDeletingActive() {
    return Boolean(deletingAgentId.value && deletingAgentId.value === activeAgentId.value)
  }
  const canCreateAgent = computed(() => canSwitchAgent.value && storedAgents.value.length < MAX_AGENTS)
  const agents = computed<AgentListItem[]>(() => storedAgents.value.map((agent) => {
    const active = agent.id === activeAgentId.value
    const title = active ? agentTitle.value : (agent.title || DEFAULT_AGENT_TITLE)
    const busy = active
      ? pending.value || (status.value !== 'idle')
      : Boolean(agent.busy || agent.pending || (agent.status && agent.status !== 'idle'))
    return {
      id: agent.id,
      title,
      busy,
      canDelete: canDeleteAgent(storedAgents.value.map((item) => {
        const current = item.id === activeAgentId.value
        return {
          ...item,
          attachments: current ? attachments.value : [],
          confirmation: current ? confirmation.value : item.confirmation,
          choice: current ? choice.value : item.choice,
          draft: current ? draft.value : item.draft,
          busy: current ? pending.value || status.value !== 'idle' : item.busy,
          pending: current ? pending.value : item.pending,
          status: current ? status.value : item.status,
        }
      }), agent.id, { attaching: attaching.value, deletingId: deletingAgentId.value }),
    }
  }))
  const allImages = computed<AgentImage[]>(() => {
    void removedCanvasImageVersion.value
    return collectProjectCanvasImages(storedAgents.value, images.value, removedCanvasImageIds, retainedCanvasImages.value)
  })
  function sessionIdsForImages(imageIds: string[]) {
    return sessionIdsOwningImages([
      { sessionId: sessionId.value, images: images.value },
      ...storedAgents.value,
      { images: retainedCanvasImages.value },
    ], imageIds)
  }
  function bumpStream() {
    streamEpoch += 1
    return streamEpoch
  }
  function cloneMessages(items: AgentChatMessage[]): AgentChatMessage[] {
    return items.map(item => ({
      ...item,
      streaming: false,
      imageIds: item.imageIds ? [...item.imageIds] : undefined,
      confirmation: item.confirmation
        ? { ...item.confirmation, params: { ...item.confirmation.params } }
        : undefined,
      resolvedParams: item.resolvedParams ? { ...item.resolvedParams } : undefined,
      choice: item.choice
        ? {
            ...item.choice,
            questions: item.choice.questions.map(question => ({
              ...question,
              options: question.options.map(option => ({ ...option })),
            })),
          }
        : undefined,
      choiceAnswers: item.choiceAnswers?.map(answer => ({ ...answer })),
    }))
  }
  function snapshotCurrent(): StoredAgent {
    if (!activeAgentId.value)
      activeAgentId.value = crypto.randomUUID()
    return {
      id: activeAgentId.value,
      title: agentTitle.value || DEFAULT_AGENT_TITLE,
      titleSource: titleSource.value,
      sessionId: sessionId.value,
      messages: cloneMessages(messages.value),
      images: images.value.map(item => ({ ...item })),
      confirmation: confirmation.value,
      choice: choice.value,
      draft: draft.value,
      status: status.value,
      pending: pending.value,
      busy: pending.value || status.value !== 'idle',
      queueNotice: queueNotice.value,
      updatedAt: Date.now(),
    }
  }
  function commitCurrentAgent() {
    if (deletingAgentId.value && deletingAgentId.value === activeAgentId.value)
      return snapshotCurrent()
    if (sessionId.value && removedSessionIds.value.includes(sessionId.value))
      return snapshotCurrent()
    const current = snapshotCurrent()
    const list = storedAgents.value.slice()
    const idx = list.findIndex(agent => agent.id === current.id)
    if (idx >= 0)
      list[idx] = current
    else
      list.push(current)
    storedAgents.value = list
    return current
  }
  function nextDefaultTitle() {
    const used = new Set(storedAgents.value
      .map(agent => agent.title)
      .filter(title => /^New agent(?: \d+)?$/.test(title)))
    if (!used.has(DEFAULT_AGENT_TITLE))
      return DEFAULT_AGENT_TITLE
    let n = 2
    while (used.has(`New agent ${n}`))
      n += 1
    return `New agent ${n}`
  }
  function emptyStoredAgent(title: string): StoredAgent {
    return {
      id: crypto.randomUUID(),
      title,
      titleSource: 'default',
      sessionId: '',
      messages: [],
      images: [],
      confirmation: null,
      choice: null,
      draft: '',
      status: 'idle',
      pending: false,
      busy: false,
      queueNotice: '',
      updatedAt: Date.now(),
    }
  }
  function applyAgent(agent: StoredAgent) {
    activeAgentId.value = agent.id
    agentTitle.value = agent.title || DEFAULT_AGENT_TITLE
    titleSource.value = agent.titleSource || 'default'
    sessionId.value = agent.sessionId || ''
    const stripped = stripRemovedImagesFromAgent({
      images: agent.images || [],
      messages: (agent.messages || []).map(item => ({
        ...item,
        streaming: false,
      })),
    }, removedCanvasImageIds)
    messages.value = sanitizeChatMessages(stripped.messages)
    images.value = [...stripped.images]
    reconcileConfirmationStates(messages.value, images.value)
    const pendingCard = messages.value.find(item => item.confirmationState === 'pending' && item.confirmation)
    const pendingChoiceCard = messages.value.find(item => item.choiceState === 'pending' && item.choice)
    confirmation.value = pendingCard?.confirmation || agent.confirmation || null
    choice.value = pendingChoiceCard?.choice || agent.choice || null
    draft.value = agent.draft || ''
    queueNotice.value = agent.queueNotice || ''
    const generatingMedia = images.value.some(item => item.status === 'generating')
    if (generatingMedia) {
      status.value = 'generating'
      pending.value = true
    }
    else if (pendingCard || pendingChoiceCard) {
      status.value = 'idle'
      pending.value = true
    }
    else {
      status.value = 'idle'
      pending.value = false
    }
    if (!pending.value && status.value === 'idle')
      stopping.value = false
    attachments.value.forEach(revokePreview)
    attachments.value = []
    if (!pending.value && status.value === 'idle')
      clearLabError()
    trimLab()
  }
  function maybeAutoTitle() {
    if (titleSource.value !== 'default')
      return
    const first = messages.value.find(item => item.role === 'user' && item.content.trim())
    if (!first)
      return
    const next = titleFromMessage(first.content)
    if (!next)
      return
    agentTitle.value = next
    titleSource.value = 'auto'
  }
  function seedDefaultAgent() {
    const agent = emptyStoredAgent(DEFAULT_AGENT_TITLE)
    storedAgents.value = [agent]
    applyAgent(agent)
  }
  function clearLabError() {
    error.value = ''
  }
  function appendErrorMessage(message: string) {
    const content = message.trim()
    if (!content || isAgentTransientMessage({ kind: 'error', content }))
      return
    const last = messages.value[messages.value.length - 1]
    if (last?.kind === 'error' && last.content === content)
      return
    messages.value.push({
      id: crypto.randomUUID(),
      role: 'assistant',
      kind: 'error',
      content,
    })
  }
  function setLabError(message: string, persist = false) {
    message = agentRecoveryNotice(message)
    if (persist && !isAgentTransientMessage({ kind: 'error', content: message })) {
      error.value = ''
      appendErrorMessage(message)
      return
    }
    error.value = message
  }
  function readErrorText(payload: Record<string, unknown>, fallback: string) {
    const nested = payload.data && typeof payload.data === 'object'
      ? (payload.data as {
          message?: unknown
        }).message
      : undefined
    for (const value of [payload.statusMessage, payload.message, payload.error, nested]) {
      if (typeof value === 'string' && value.trim() && value.trim() !== 'true')
        return value.trim()
    }
    return fallback
  }
  async function parseError(response: Response) {
    if (response.status === 429) {
      const seconds = Number(response.headers.get('retry-after')) || 60
      agentWriteRetryAt = Date.now() + Math.max(1, seconds) * 1000
    }
    const payload = await response.json().catch(() => ({})) as Record<string, unknown> & {
      data?: {
        message?: string
        remaining?: number
        required?: number
      }
    }
    if (response.status === 499)
      return 'The agent request was cancelled'
    return readErrorText(payload, `Agent service error (${response.status})`)
  }
  function labHeaders(json = false, idempotencyKey?: string) {
    const headers: Record<string, string> = {}
    if (json)
      headers['Content-Type'] = 'application/json'
    if (idempotencyKey)
      headers['Idempotency-Key'] = idempotencyKey
    if (projectScope.value)
      headers['x-agent-project-id'] = projectScope.value
    return headers
  }
  function agentContextSnapshot() {
    const history = messages.value
      .filter(item => item.kind !== 'error')
      .slice(-36)
      .map(item => ({
        role: item.role,
        kind: item.kind,
        content: clipMessageContent(item.content || ''),
        confirmation: item.confirmation
          ? {
              reason: item.confirmation.reason,

              inputUrls: item.confirmation.inputUrls,
              params: item.confirmation.params,
            }
          : undefined,
      }))
    const imagesOut = images.value.slice(0, MAX_CHAT_IMAGES).map(item => ({
      id: item.id,
      kind: item.kind,
      status: item.status,
      name: item.name,
      prompt: item.prompt,
      url: item.url,
      sourceUrl: item.sourceUrl,
      error: item.error,
      failCode: item.failCode,
      retryable: item.retryable,
      aspectRatio: item.aspectRatio,
      resolution: item.resolution,
      duration: item.duration,
      videoMode: item.videoMode,
      videoFamily: item.videoFamily,
      modelId: item.modelId,
      modelInput: item.modelInput,
      inputUrls: item.inputUrls,
      referenceVideoUrls: item.referenceVideoUrls,
    }))
    const seenUrls = new Set(imagesOut.map(item => item.url).filter(Boolean))
    for (const message of messages.value) {
      for (const url of message.confirmation?.inputUrls || []) {
        if (!url || seenUrls.has(url) || imagesOut.length >= MAX_CHAT_IMAGES)
          continue
        seenUrls.add(url)
        imagesOut.push({
          id: `ref:${url.slice(-96)}`,
          kind: 'upload',
          status: 'success',
          name: undefined,
          prompt: 'Session reference',
          url,
          sourceUrl: url,
          error: '',
          failCode: '',
          retryable: undefined,
          aspectRatio: '',
          resolution: '',
          duration: undefined,
          videoMode: undefined,
          videoFamily: undefined,
          modelId: undefined,
          modelInput: undefined,
          inputUrls: undefined,
          referenceVideoUrls: undefined,
        })
      }
    }
    return { history, images: imagesOut, locale: uiLocale.value }
  }
  function trimLab() {
    messages.value = trimChatMessages(messages.value)
    const referenced = new Set(messages.value.flatMap(item => item.imageIds || []))
    const essential: AgentImage[] = []
    const seen = new Set<string>()
    for (const image of images.value) {
      const needed = image.status === 'generating'
        || image.status === 'fail'
        || image.kind === 'upload'
        || image.kind === 'video'
        || image.kind === 'still'
        || referenced.has(image.id)
        || (image.status === 'success' && image.kind !== 'upload' && !persistedCanvasIds.has(image.id))
      if (!needed)
        continue
      if (seen.has(image.id))
        continue
      essential.push(image)
      seen.add(image.id)
      if (essential.length >= MAX_CHAT_IMAGES)
        break
    }
    if (essential.length < MAX_CHAT_IMAGES) {
      for (const image of images.value) {
        if (seen.has(image.id))
          continue
        essential.push(image)
        seen.add(image.id)
        if (essential.length >= MAX_CHAT_IMAGES)
          break
      }
    }
    images.value = essential
  }
  function labSnapshot() {
    commitCurrentAgent()
    return {
      activeAgentId: activeAgentId.value,
      agents: storedAgents.value,
      retainedCanvasImages: retainedCanvasImages.value,
      removedSessionIds: removedSessionIds.value,
      sessionId: sessionId.value,
      messages: messages.value.map(item => ({
        ...item,
        streaming: false,
      })),
      images: images.value,
      confirmation: confirmation.value,
      choice: choice.value,
    } satisfies StoredLab
  }
  function writeStore() {
    if (disposed || !import.meta.client || !storageKey.value)
      return
    trimLab()
    try {
      localStorage.setItem(storageKey.value, JSON.stringify(labSnapshot()))
    }
    catch {
      messages.value = trimChatMessages(messages.value.slice(-24))
      images.value = images.value.slice(0, 12)
      storedAgents.value = storedAgents.value.map((agent) => {
        if (agent.id !== activeAgentId.value)
          return agent
        return {
          ...agent,
          messages: trimChatMessages((agent.messages || []).slice(-24)),
          images: (agent.images || []).slice(0, 12),
        }
      })
      try {
        localStorage.setItem(storageKey.value, JSON.stringify(labSnapshot()))
      }
      catch {
        // Drop the snapshot rather than crashing the tab.
      }
    }
  }
  async function persistChat(allowEmpty = false) {
    if (disposed || !import.meta.client || !sessionId.value)
      return
    if (removedSessionIds.value.includes(sessionId.value) || isDeletingActive())
      return
    if (!allowEmpty && !messages.value.length && !images.value.length)
      return
    try {
      await $fetch('/api/ai/agent-chat', {
        method: 'POST',
        body: {
          sessionId: sessionId.value,
          projectId: projectScope.value,
          messages: messages.value
            .filter(item => !(item.kind === 'error' && isDisconnectError(item.content)))
            .map(item => ({
              id: item.id,
              role: item.role,
              kind: item.kind,
              content: item.content,
              imageIds: item.imageIds,
              confirmationState: item.confirmationState,
              confirmation: item.confirmation,
              resolvedParams: item.resolvedParams,
              choiceState: item.choiceState,
              choice: item.choice,
              choiceAnswers: item.choiceAnswers,
            })),
          images: images.value,
        },
      })
    }
    catch {
      // Local chat still remains if archive fails.
    }
  }
  async function removeCanvasImages(imageIds: string[]) {
    const ids = new Set(imageIds.map(id => String(id || '').trim()).filter(Boolean))
    if (!ids.size)
      return
    rememberRemovedImageIds(ids)
    images.value = images.value.filter(image => !ids.has(image.id))
    messages.value = dropRemovedImageIdsFromMessages(messages.value, ids)
    storedAgents.value = storedAgents.value.map(agent => stripRemovedImagesFromAgent(agent, ids))
    retainedCanvasImages.value = retainedCanvasImages.value.filter(image => !ids.has(image.id))
    writeStore()
    if (projectScope.value && ids.size) {
      try {
        await $fetch(`/api/projects/${encodeURIComponent(projectScope.value)}/canvas-images`, {
          method: 'DELETE',
          body: { imageIds: [...ids] },
        })
      }
      catch {
        // Local canvas hide still stands if the retained cleanup request fails.
      }
    }
    await persistChat(true)
  }
  async function removeCanvasResult(taskId: string, extraUrls: string[] = []) {
    const id = String(taskId || '').trim()
    if (!id)
      return
    const urls = new Set(extraUrls.map(url => String(url || '').trim()).filter(Boolean))
    const imageId = id.startsWith('agent_') ? id.slice('agent_'.length) : ''
    const pool = [
      ...images.value,
      ...retainedCanvasImages.value,
      ...storedAgents.value.flatMap(agent => agent.images || []),
    ]
    await removeCanvasImages(pool
      .filter(image => image.id === id
        || image.id === imageId
        || `agent_${image.id}`.slice(0, 120) === id
        || image.providerTaskId === id
        || (image.url && urls.has(image.url)))
      .map(image => image.id))
  }
  function hydrateLocal() {
    const saved = readStore(storageKey.value)
      || readStore(`${LEGACY_STORAGE_PREFIX}${projectScope.value || 'home'}`)
      || readStore(projectScope.value
        ? `${LEGACY_STORAGE_PREFIX}local:${projectScope.value}`
        : `${LEGACY_STORAGE_PREFIX}local`)
    if (!saved) {
      seedDefaultAgent()
      return
    }
    if (saved.agents?.length) {
      storedAgents.value = saved.agents.map(agent => ({
        ...agent,
        messages: (agent.messages || []).map(item => ({
          ...item,
          streaming: false,
        })),
        images: [...(agent.images || [])],
      }))
      retainedCanvasImages.value = saved.retainedCanvasImages || []
      removedSessionIds.value = saved.removedSessionIds || []
      const applied = applyRemovedSessionIds(storedAgents.value, removedSessionIds.value, saved.activeAgentId || '')
      storedAgents.value = applied.agents
      const active = storedAgents.value.find(agent => agent.id === applied.nextActiveId)
        || storedAgents.value[0]
      if (active)
        applyAgent(active)
      else
        seedDefaultAgent()
      maybeAutoTitle()
      return
    }
    const migrated = emptyStoredAgent(DEFAULT_AGENT_TITLE)
    migrated.sessionId = saved.sessionId || ''
    migrated.messages = (saved.messages || []).map(item => ({
      ...item,
      streaming: false,
    }))
    migrated.images = [...(saved.images || [])]
    migrated.confirmation = saved.confirmation || null
    storedAgents.value = [migrated]
    applyAgent(migrated)
    maybeAutoTitle()
  }
  function canvasItems(source: AgentImage[]) {
    return source.filter(item => item.status === 'success'
      && item.kind !== 'upload'
      && isMediaUrl(item.url))
  }
  function batchReferenceUrls() {
    const fromOpen = confirmation.value?.inputUrls || []
    if (fromOpen.length)
      return fromOpen
    for (let index = messages.value.length - 1; index >= 0; index--) {
      const urls = messages.value[index]?.confirmation?.inputUrls
      if (urls?.length)
        return urls
    }
    return []
  }
  function confirmationUrlsFor(item: AgentImage) {
    const owner = messages.value.find(message => message.imageIds?.includes(item.id) && Boolean(message.confirmation?.inputUrls?.length))
    if (owner?.confirmation?.inputUrls?.length)
      return owner.confirmation.inputUrls
    return batchReferenceUrls()
  }
  function stillRefsFor(item: AgentImage) {
    if (item.inputUrls?.length)
      return item.inputUrls.filter(url => isMediaUrl(url) && !isMediaVideoUrl(url))
    if (item.videoMode === 'reference') {
      const batch = confirmationUrlsFor(item).filter(url => isMediaUrl(url) && !isMediaVideoUrl(url))
      if (batch.length)
        return batch
    }
    if (item.sourceUrl && isMediaUrl(item.sourceUrl) && !isMediaVideoUrl(item.sourceUrl))
      return [item.sourceUrl]
    return []
  }
  function videoRefsFor(item: AgentImage) {
    if (item.referenceVideoUrls?.length)
      return item.referenceVideoUrls.filter(isMediaUrl)
    if (item.videoMode === 'reference')
      return confirmationUrlsFor(item).filter(url => isMediaUrl(url) && isMediaVideoUrl(url))
    return []
  }
  async function persistCanvasResults(source?: AgentImage[]) {
    const pid = projectScope.value
    if (!pid)
      return
    const pendingItems = canvasItems(source || images.value)
      .filter((item) => {
        if (persistingCanvasIds.has(item.id))
          return false
        if (item.url && stillRefsFor(item).includes(item.url))
          return false
        if (item.url && /_\d+$/.test(item.id) && (source || images.value).some(other => other.id !== item.id && other.url === item.url && other.status === 'success'))
          return false
        if (!persistedCanvasIds.has(item.id))
          return true
        return !patchedInputIds.has(item.id) && stillRefsFor(item).length > 1
      })
      .map(item => ({
        id: item.id,
        kind: item.kind,
        name: item.name,
        prompt: item.prompt,
        url: item.url,
        sourceUrl: item.sourceUrl,
        inputUrls: stillRefsFor(item),
        referenceVideoUrls: videoRefsFor(item),
        aspectRatio: item.aspectRatio,
        resolution: item.resolution,
        duration: item.duration,
        videoMode: item.videoMode,
        videoFamily: item.videoFamily,
        modelId: item.modelId,
        modelInput: item.modelInput,
      }))
    if (!pendingItems.length)
      return
    for (let offset = 0; offset < pendingItems.length; offset += 8) {
      const chunk = pendingItems.slice(offset, offset + 8)
      const chunkIds = chunk.map(item => item.id)
      for (const id of chunkIds)
        persistingCanvasIds.add(id)
      try {
        const data = await $fetch<{
          jobs?: GenerationJobPublic[]
          importedIds?: string[]
        }>('/api/ai/agent-results', {
          method: 'POST',
          body: {
            projectId: pid,
            items: chunk,
          },
        })
        if (projectScope.value !== pid)
          return
        for (const id of data.importedIds || []) {
          persistedCanvasIds.add(id)
          patchedInputIds.add(id)
        }
        if (data.jobs?.length)
          onJobs.value?.(data.jobs)
      }
      catch (error) {
        console.warn('[canvas import]', error)
      }
      finally {
        for (const id of chunkIds)
          persistingCanvasIds.delete(id)
      }
    }
  }
  function storedAgentFromChat(chat: {
    sessionId: string
    preview?: string
    updatedAt?: number
    messages?: Array<{
      id?: string
      role?: 'user' | 'assistant'
      kind?: string
      content?: string
      imageIds?: string[]
      confirmationState?: AgentChatMessage['confirmationState']
      confirmation?: AgentChatMessage['confirmation']
      resolvedParams?: AgentChatMessage['resolvedParams']
      choice?: AgentChatMessage['choice']
      choiceState?: AgentChatMessage['choiceState']
      choiceAnswers?: AgentChatMessage['choiceAnswers']
    }>
    images?: Array<{
      id?: string
      kind?: string
      status?: AgentImage['status']
      name?: string
      prompt?: string
      url?: string
      error?: string
      failCode?: string
      retryable?: boolean
      sourceUrl?: string
      aspectRatio?: string
      resolution?: string
      duration?: number
    }>
  }): StoredAgent {
    const messages = sanitizeChatMessages((chat.messages || [])
      .filter(item => !(item.kind === 'error' && isDisconnectError(item.content || '')))
      .map(item => ({
        id: item.id || crypto.randomUUID(),
        role: item.role === 'user' ? 'user' as const : 'assistant' as const,
        kind: item.kind === 'error' ? 'error' as const : undefined,
        content: item.content || '',
        imageIds: item.imageIds,
        confirmationState: item.confirmationState,
        confirmation: item.confirmation || undefined,
        resolvedParams: item.resolvedParams || undefined,
        choice: item.choice || undefined,
        choiceState: item.choiceState || undefined,
        choiceAnswers: item.choiceAnswers,
      })))
    const images = (chat.images || [])
      .filter(item => item.id)
      .map(item => ({
        id: item.id || '',
        kind: (item.kind as AgentImage['kind']) || 'still',
        status: item.status || 'success',
        name: item.name,
        prompt: item.prompt || '',
        aspectRatio: item.aspectRatio || '',
        resolution: item.resolution || '',
        url: item.url || '',
        error: item.error || '',
        failCode: item.failCode || '',
        retryable: item.retryable,
        sourceUrl: item.sourceUrl || '',
        duration: item.duration || undefined,
      }))
    const title = titleFromMessage(chat.preview || '') || DEFAULT_AGENT_TITLE
    return {
      id: chat.sessionId,
      title,
      titleSource: title === DEFAULT_AGENT_TITLE ? 'default' : 'auto',
      sessionId: chat.sessionId,
      messages,
      images,
      confirmation: null,
      choice: null,
      draft: '',
      status: images.some(item => item.status === 'generating') ? 'generating' : 'idle',
      pending: false,
      busy: false,
      queueNotice: '',
      updatedAt: chat.updatedAt || Date.now(),
    }
  }
  function mergeStoredAgents(current: StoredAgent, incoming: StoredAgent): StoredAgent {
    const currentMessages = current.messages || []
    const incomingMessages = incoming.messages || []
    return {
      ...current,
      title: current.titleSource === 'manual' ? current.title : (incoming.title || current.title),
      titleSource: current.titleSource === 'manual' ? 'manual' : (incoming.titleSource || current.titleSource),
      sessionId: current.sessionId || incoming.sessionId,
      messages: dropRemovedImageIdsFromMessages(recoverAgentTranscript(currentMessages, incomingMessages, row => ({
        ...row,
        id: row.id || crypto.randomUUID(),
      })), removedCanvasImageIds),
      images: withoutRemovedImages(unionSessionImages(current.images || [], incoming.images || [])),
      confirmation: current.confirmation || incoming.confirmation || null,
      choice: current.choice || incoming.choice || null,
      draft: current.draft || incoming.draft || '',
      updatedAt: Math.max(current.updatedAt || 0, incoming.updatedAt || 0),
    }
  }
  function adoptRemoteAgents(incoming: StoredAgent[]) {
    // A read started before send can finish after the turn has begun. Applying
    // that archive would replace the active agent ID and orphan its SSE events.
    if (!incoming.length || activeTurns > 0)
      return
    const byKey = new Map<string, StoredAgent>()
    for (const agent of [...incoming, ...storedAgents.value]) {
      const key = agent.sessionId || agent.id
      const previous = byKey.get(key)
      byKey.set(key, previous ? mergeStoredAgents(previous, agent) : agent)
    }
    const merged = [...byKey.values()]
    const nonempty = merged.filter(agent => !isEmptyStoredAgent(agent))
    storedAgents.value = (nonempty.length ? nonempty : merged).slice(0, MAX_AGENTS)
    const active = storedAgents.value.find(agent => agent.id === activeAgentId.value && !isEmptyStoredAgent(agent))
      || storedAgents.value.find(agent => agent.sessionId === sessionId.value)
      || storedAgents.value[0]
    if (active)
      applyAgent(active)
  }
  async function hydrateRemoteChats() {
    if (!projectScope.value)
      return
    try {
      const known = storedAgents.value.map(agent => agent.sessionId).filter(Boolean)
      const data = await $fetch<{
        items: Array<Parameters<typeof storedAgentFromChat>[0]>
        retainedCanvasImages?: AgentImage[]
        removedSessionIds?: string[]
      }>('/api/ai/agent-chats', {
        query: {
          projectId: projectScope.value,
          knownSessionIds: known.join(','),
        },
      })
      const removed = new Set([
        ...removedSessionIds.value,
        ...(data.removedSessionIds || []),
      ].filter(Boolean))
      if (removed.size) {
        removedSessionIds.value = [...removed]
        const applied = applyRemovedSessionIds(storedAgents.value, removed, activeAgentId.value)
        storedAgents.value = applied.agents
        if (applied.nextActiveId !== activeAgentId.value) {
          const next = storedAgents.value.find(agent => agent.id === applied.nextActiveId) || emptyStoredAgent(DEFAULT_AGENT_TITLE)
          if (!storedAgents.value.length)
            storedAgents.value = [next]
          applyAgent(next)
        }
      }
      if (Array.isArray(data.retainedCanvasImages))
        retainedCanvasImages.value = data.retainedCanvasImages
      adoptRemoteAgents((data.items || []).map(storedAgentFromChat).filter(agent => !removed.has(agent.sessionId || '')))
    }
    catch {
      // Keep the local snapshot if archive is unavailable.
    }
  }
  async function hydrateRemoteSessions() {
    if (!projectScope.value)
      return
    try {
      const response = await fetch(`${baseUrl}/v1/sessions?projectId=${encodeURIComponent(projectScope.value)}&knownSessionIds=${encodeURIComponent(storedAgents.value.map(agent => agent.sessionId).filter(Boolean).join(','))}`, {
        credentials: 'omit',
      })
      if (!response.ok)
        return
      const data = await response.json() as {
        excludedSessionIds?: string[]
        items?: Array<{
          sessionId?: string
          title?: string
          images?: AgentImage[]
          messages?: Array<{
            role?: string
            content?: string
            imageIds?: string[]
          }>
          updatedAt?: number
        }>
      }
      const excluded = new Set([
        ...(data.excludedSessionIds || []),
        ...removedSessionIds.value,
      ].filter(Boolean))
      if (excluded.size && activeTurns === 0) {
        const applied = applyRemovedSessionIds(storedAgents.value, excluded, activeAgentId.value)
        storedAgents.value = applied.agents
        if (applied.nextActiveId !== activeAgentId.value) {
          const next = storedAgents.value.find(agent => agent.id === applied.nextActiveId) || emptyStoredAgent(DEFAULT_AGENT_TITLE)
          if (!storedAgents.value.length)
            storedAgents.value = [next]
          applyAgent(next)
        }
        writeStore()
      }
      const incoming = (data.items || [])
        .filter(item => item.sessionId && !excluded.has(item.sessionId))
        .map((item) => {
          const messages = sanitizeChatMessages((item.messages || [])
            .filter(row => row.role === 'user' || row.role === 'assistant')
            .map(row => ({
              id: crypto.randomUUID(),
              role: row.role as 'user' | 'assistant',
              content: row.content || '',
              imageIds: row.imageIds,
            })))
          return {
            id: item.sessionId!,
            title: item.title?.trim() || titleFromMessage(messages.find(row => row.role === 'user')?.content || '') || DEFAULT_AGENT_TITLE,
            titleSource: 'auto' as const,
            sessionId: item.sessionId,
            messages,
            images: item.images || [],
            confirmation: null,
            choice: null,
            draft: '',
            status: (item.images || []).some(image => image.status === 'generating') ? 'generating' as const : 'idle' as const,
            pending: false,
            busy: false,
            queueNotice: '',
            updatedAt: item.updatedAt || Date.now(),
          } satisfies StoredAgent
        })
      adoptRemoteAgents(incoming)
    }
    catch {
      // Keep the local snapshot if the agent runtime is unavailable.
    }
  }
  function syncLabBusyFromImages() {
    const generatingMedia = images.value.some(item => item.status === 'generating')
    if (generatingMedia) {
      if (status.value === 'idle' || status.value === 'generating' || status.value === 'queued') {
        status.value = 'generating'
        pending.value = true
      }
      return
    }
    void maybeSettleMedia()
  }
  async function hydrateServer() {
    if (!sessionId.value)
      return { busy: false, hasPendingConfirm: false }
    const requestedSessionId = sessionId.value
    const requestedAgentId = activeAgentId.value
    const requestedEpoch = streamEpoch
    try {
      const response = await fetch(`${baseUrl}/v1/sessions/${encodeURIComponent(requestedSessionId)}`, {
        credentials: 'omit',
      })
      if (!response.ok)
        return { busy: false, hasPendingConfirm: false }
      const data = await response.json() as {
        title?: string
        images?: AgentImage[]
        pendingConfirmation?: ConfirmationPayload | null
        pendingChoice?: ChoicePayload | null
        messages?: Array<{
          id?: string
          role: 'user' | 'assistant'
          content: string
          imageIds?: string[]
        }>
        busy?: boolean
      }
      if (requestedSessionId !== sessionId.value || requestedAgentId !== activeAgentId.value || requestedEpoch !== streamEpoch)
        return { busy: false, hasPendingConfirm: false }
      if (Date.now() >= agentWriteRetryAt && isAgentTransientMessage({ kind: 'error', content: error.value }))
        error.value = ''
      // SSE and polling must not both append the same assistant turn.
      if (activeTurns === 0 && Array.isArray(data.messages)) {
        messages.value = dropRemovedImageIdsFromMessages(recoverAgentTranscript(messages.value, data.messages, row => ({
          ...row,
          id: row.id || crypto.randomUUID(),
          streaming: false,
        })), removedCanvasImageIds)
      }
      if (typeof data.title === 'string' && data.title.trim() && titleSource.value !== 'manual') {
        agentTitle.value = data.title.trim()
        titleSource.value = 'auto'
      }
      if (Array.isArray(data.images) && data.images.length)
        images.value = withoutRemovedImages(unionSessionImages(images.value, data.images))
      syncLabBusyFromImages()
      let hasPendingConfirm = false
      if (data.pendingConfirmation) {
        const pendingCard = data.pendingConfirmation
        const message = messages.value.find(item => item.confirmation?.id === pendingCard.id)
        const auto = shouldAutoApprove(pendingCard)
        const payload = auto
          ? { ...pendingCard, approvedBy: 'agent' as const }
          : pendingCard
        if (message) {
          message.confirmation = { ...payload, approvedBy: payload.approvedBy || message.confirmation?.approvedBy }
          if (auto) {
            message.confirmationState = 'confirmed'
            message.resolvedParams = payload.params
          }
          else if (!message.confirmationState || message.confirmationState === 'pending') {
            message.confirmationState = 'pending'
          }
        }
        else if (auto || !messages.value.some(item => item.confirmation?.id === pendingCard.id)) {
          messages.value.push({
            id: crypto.randomUUID(),
            role: 'assistant',
            content: '',
            confirmation: payload,
            confirmationState: auto ? 'confirmed' : 'pending',
            resolvedParams: auto ? payload.params : undefined,
          })
        }
        confirmation.value = payload
        hasPendingConfirm = true
        if (!auto) {
          status.value = 'idle'
          queueNotice.value = ''
          pending.value = true
        }
        if (auto) {
          status.value = status.value === 'idle' ? 'generating' : status.value
          pending.value = true
        }
      }
      if (data.pendingChoice) {
        messages.value = dropStaleStopNotesForPendingChoice(messages.value)
        const pendingCard = data.pendingChoice
        const message = messages.value.find(item => item.choice?.id === pendingCard.id)
        if (message) {
          message.choice = pendingCard
          if ((!data.busy && activeTurns === 0) || (message.choiceState !== 'answered' && message.choiceState !== 'skipped'))
            message.choiceState = 'pending'
        }
        else if (!messages.value.some(item => item.choice?.id === pendingCard.id)) {
          const last = [...messages.value].reverse().find(item =>
            item.role === 'assistant' && item.kind !== 'error' && !item.confirmation && !item.choice,
          )
          const thinkOnly = Boolean(last && (!last.content || /^<think(?:ing)?>/i.test(last.content.trim())))
          if (last && thinkOnly) {
            last.choice = pendingCard
            last.choiceState = 'pending'
          }
          else {
            messages.value.push({
              id: crypto.randomUUID(),
              role: 'assistant',
              content: '',
              choice: pendingCard,
              choiceState: 'pending',
            })
          }
        }
        choice.value = pendingCard
        status.value = 'idle'
        queueNotice.value = ''
        pending.value = true
      }
      const busy = Boolean(data.busy)
      if (busy && !data.pendingChoice && !(data.pendingConfirmation && !shouldAutoApprove(data.pendingConfirmation))) {
        if (status.value === 'idle' || status.value === 'generating' || status.value === 'queued')
          status.value = images.value.some(item => item.status === 'generating') ? 'generating' : 'thinking'
        pending.value = true
      }
      if (activeTurns === 0) {
        if (data.pendingConfirmation === null) {
          confirmation.value = null
          for (const message of messages.value) {
            if (message.confirmationState === 'pending')
              message.confirmationState = message.imageIds?.length || message.confirmation?.approvedBy === 'agent' ? 'confirmed' : 'cancelled'
          }
        }
        if (data.pendingChoice === null) {
          choice.value = null
          for (const message of messages.value) {
            if (message.choiceState === 'pending')
              message.choiceState = message.choiceAnswers?.length ? 'answered' : 'skipped'
          }
        }
      }
      reconcileConfirmationStates(messages.value, images.value)
      if (activeTurns === 0 && data.busy === false) {
        const generating = images.value.some(item => item.status === 'generating')
          || Boolean(confirmation.value && shouldAutoApprove(confirmation.value))
        status.value = generating ? 'generating' : 'idle'
        pending.value = generating || waitingForUser.value
        queueNotice.value = ''
        if (!pending.value)
          stopping.value = false
        if (isDisconnectError(error.value))
          error.value = ''
      }
      return { busy, hasPendingConfirm }
    }
    catch {
      // Keep the local snapshot if the agent runtime is unavailable.
      return { busy: false, hasPendingConfirm: false }
    }
  }
  function patchStoredAgent(id: string, patch: (agent: StoredAgent) => StoredAgent) {
    storedAgents.value = storedAgents.value.map((agent) => {
      if (agent.id !== id)
        return agent
      return patch({
        ...agent,
        messages: (agent.messages || []).map(item => ({ ...item })),
        images: (agent.images || []).map(item => ({ ...item })),
      })
    })
  }
  function applyEventToState(event: AgentEvent, state: {
    sessionId: string
    messages: AgentChatMessage[]
    images: AgentImage[]
    confirmation: ConfirmationPayload | null
    choice: ChoicePayload | null
    status: AgentStatus
    title: string
    titleSource: AgentTitleSource
    queueNotice: string
    pending: boolean
  }) {
    if (event.type === 'session' && event.sessionId)
      state.sessionId = event.sessionId
    if (event.type === 'status' && event.status) {
      const generatingMedia = state.images.some(item => item.status === 'generating')
      const holdForAutoConfirm = state.confirmation?.approvedBy === 'agent'
      if (event.status === 'idle' && (generatingMedia || holdForAutoConfirm)) {
        state.status = generatingMedia ? 'generating' : (state.status === 'idle' ? 'generating' : state.status)
        state.pending = true
      }
      else {
        state.status = event.status
        if (event.status === 'idle') {
          state.pending = Boolean(state.confirmation && state.confirmation.approvedBy !== 'agent')
            || Boolean(state.choice)
        }
        else {
          state.pending = true
        }
        if (event.status !== 'queued')
          state.queueNotice = ''
      }
    }
    if (event.type === 'title' && event.title) {
      state.title = event.title
      state.titleSource = 'auto'
    }
    if (event.type === 'queue' && event.message) {
      state.status = 'queued'
      state.pending = true
      state.queueNotice = event.message
    }
    if (event.type === 'text_replace' && event.delta) {
      const last = state.messages[state.messages.length - 1]
      if (last?.role === 'assistant' && last.streaming) {
        last.content = event.delta
      }
      else {
        state.messages.push({ id: crypto.randomUUID(), role: 'assistant', content: event.delta, streaming: true })
      }
    }
    if (event.type === 'text' && event.delta) {
      const last = state.messages[state.messages.length - 1]
      const duplicateStop = isAgentStopNote(event.delta)
        && last?.role === 'assistant'
        && isAgentStopNote(last.content)
      if (!duplicateStop) {
        if (last?.role === 'assistant' && last.kind !== 'error' && last.streaming) {
          last.content += event.delta
          last.content = clipMessageContent(last.content)
        }
        else if (last?.role === 'assistant' && last.kind !== 'error' && !last.content && last.imageIds?.length) {
          last.content = event.delta
          last.streaming = true
        }
        else {
          state.messages.push({
            id: crypto.randomUUID(),
            role: 'assistant',
            content: event.delta,
            streaming: true,
          })
        }
      }
    }
    if (event.type === 'confirmation' && event.confirmation) {
      const auto = shouldAutoApprove(event.confirmation)
      const payload = auto
        ? { ...event.confirmation, approvedBy: 'agent' as const }
        : event.confirmation
      state.confirmation = payload
      state.status = auto ? 'generating' : 'idle'
      state.queueNotice = ''
      state.pending = true
      const existing = state.messages.find(message => message.confirmation?.id === payload.id)
      const last = existing || state.messages[state.messages.length - 1]
      if (last?.role === 'assistant' && last.kind !== 'error' && (existing || (!last.confirmation && !last.choice && !last.imageIds?.length))) {
        last.streaming = false
        last.confirmation = { ...payload, approvedBy: payload.approvedBy || last.confirmation?.approvedBy }
        last.confirmationState = auto ? 'confirmed' : (last.confirmationState || 'pending')
        if (auto) {
          last.resolvedParams = payload.params
          state.status = 'generating'
          state.pending = true
        }
      }
      else {
        state.messages.push({
          id: crypto.randomUUID(),
          role: 'assistant',
          content: '',
          confirmation: payload,
          confirmationState: auto ? 'confirmed' : 'pending',
          resolvedParams: auto ? payload.params : undefined,
        })
        if (auto) {
          state.status = 'generating'
          state.pending = true
        }
      }
    }
    if (event.type === 'choice' && event.choice) {
      state.choice = event.choice
      state.status = 'idle'
      state.queueNotice = ''
      state.pending = true
      const last = state.messages[state.messages.length - 1]
      if (last?.role === 'assistant' && last.kind !== 'error') {
        last.streaming = false
        const sameChoice = last.choice?.id === event.choice.id
        last.choice = event.choice
        last.choiceState = sameChoice && (last.choiceState === 'answered' || last.choiceState === 'skipped')
          ? last.choiceState
          : 'pending'
      }
      else {
        state.messages.push({
          id: crypto.randomUUID(),
          role: 'assistant',
          content: '',
          choice: event.choice,
          choiceState: 'pending',
        })
      }
    }
    if (event.type === 'image' && event.image && !removedCanvasImageIds.has(event.image.id)) {
      const index = state.images.findIndex(item => item.id === event.image!.id)
      const known = index >= 0
      if (index >= 0)
        state.images[index] = event.image
      else
        state.images.unshift(event.image)
      if (!known && !event.replay && event.image.kind !== 'upload') {
        const owner = state.messages.find(message => message.confirmation && confirmationMedia(message, [event.image!]).length)
        const last = owner || state.messages[state.messages.length - 1]
        if (last?.role === 'assistant' && last.kind !== 'error') {
          const ids = last.imageIds || []
          if (!ids.includes(event.image.id))
            last.imageIds = [...ids, event.image.id]
        }
        else {
          state.messages.push({
            id: crypto.randomUUID(),
            role: 'assistant',
            content: '',
            imageIds: [event.image.id],
          })
        }
      }
      reconcileConfirmationStates(state.messages, state.images)
      if (event.image.status === 'generating') {
        state.status = 'generating'
        state.pending = true
      }
      if (event.image.status === 'success')
        void persistCanvasResults([event.image])
    }
    if (event.type === 'error' && event.message) {
      const content = event.message.trim()
      if (content && /pending generation first/i.test(content) && state.confirmation) {
        // Confirmation was re-attached in the same stream; auto-approve / the card will continue.
      }
      else if (content && /pending questions first/i.test(content) && state.choice) {
        // Choice card was re-attached in the same stream.
      }
      else if (content && !isAgentTransientMessage({ kind: 'error', content })) {
        const last = state.messages[state.messages.length - 1]
        if (!(last?.kind === 'error' && last.content === content)) {
          state.messages.push({
            id: crypto.randomUUID(),
            role: 'assistant',
            kind: 'error',
            content,
          })
        }
      }
    }
    if (event.type === 'done') {
      const last = state.messages[state.messages.length - 1]
      if (last?.streaming)
        last.streaming = false
      const generatingMedia = state.images.some(item => item.status === 'generating')
      const holdForAutoConfirm = state.confirmation?.approvedBy === 'agent'
      if (state.status !== 'idle' && !generatingMedia && !holdForAutoConfirm)
        state.status = 'idle'
      else if (generatingMedia || holdForAutoConfirm)
        state.status = 'generating'
      state.pending = Boolean(state.confirmation && state.confirmation.approvedBy !== 'agent')
        || Boolean(state.choice)
        || generatingMedia
        || holdForAutoConfirm
        || state.status === 'generating'
        || state.status === 'queued'
      if (state.status === 'idle')
        state.queueNotice = ''
    }
    return state
  }
  function applyEvent(event: AgentEvent, agentId = activeAgentId.value) {
    if (agentId && agentId !== activeAgentId.value) {
      patchStoredAgent(agentId, (agent) => {
        const next = applyEventToState(event, {
          sessionId: agent.sessionId || '',
          messages: agent.messages || [],
          images: agent.images || [],
          confirmation: agent.confirmation || null,
          choice: agent.choice || null,
          status: agent.status || 'idle',
          title: agent.title || DEFAULT_AGENT_TITLE,
          titleSource: agent.titleSource || 'default',
          queueNotice: agent.queueNotice || '',
          pending: Boolean(agent.pending),
        })
        return {
          ...agent,
          sessionId: next.sessionId,
          messages: next.messages,
          images: next.images,
          confirmation: next.confirmation,
          choice: next.choice,
          status: next.status,
          title: next.title,
          titleSource: next.titleSource,
          queueNotice: next.queueNotice,
          pending: next.pending,
          busy: next.pending || next.status !== 'idle',
          updatedAt: Date.now(),
        }
      })
      return
    }
    const next = applyEventToState(event, {
      sessionId: sessionId.value,
      messages: messages.value,
      images: images.value,
      confirmation: confirmation.value,
      choice: choice.value,
      status: status.value,
      title: agentTitle.value,
      titleSource: titleSource.value,
      queueNotice: queueNotice.value,
      pending: pending.value,
    })
    sessionId.value = next.sessionId
    messages.value = next.messages
    images.value = next.images
    confirmation.value = next.confirmation
    choice.value = next.choice
    status.value = next.status
    agentTitle.value = next.title
    titleSource.value = next.titleSource
    queueNotice.value = next.queueNotice
    pending.value = next.pending
    if (event.type === 'error' && event.message)
      error.value = ''
    if (event.type === 'done')
      trimLab()
  }
  async function consumeSse(response: Response, epoch = streamEpoch, agentId = activeAgentId.value) {
    if (!response.ok)
      throw new Error(await parseError(response))
    if (!response.body)
      throw new Error('Agent service returned an empty stream')
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let locked = false
    while (true) {
      const { done, value } = await reader.read()
      if (done)
        break
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
      let idx = buffer.indexOf('\n\n')
      while (idx >= 0) {
        const event = parseSseBlock(buffer.slice(0, idx))
        buffer = buffer.slice(idx + 2)
        idx = buffer.indexOf('\n\n')
        if (!event)
          continue
        if (event.type === 'error' && isSessionLockError(String(event.message || ''))) {
          locked = true
          continue
        }
        if (epoch === streamEpoch || agentId !== activeAgentId.value)
          applyEvent(event, agentId)
      }
    }
    return locked
  }
  async function ping() {
    try {
      const response = await fetch(`${baseUrl}/health`, { credentials: 'omit' })
      online.value = response.ok
    }
    catch {
      online.value = false
    }
  }
  async function ensureSession() {
    if (sessionId.value)
      return sessionId.value
    const response = await fetch(`${baseUrl}/v1/sessions`, {
      method: 'POST',
      credentials: 'omit',
      headers: labHeaders(false, crypto.randomUUID()),
    })
    const data = await response.json().catch(() => ({})) as {
      sessionId?: string
      error?: string
    }
    if (!response.ok || !data.sessionId)
      throw new Error(data.error || 'Could not start an agent session')
    sessionId.value = data.sessionId
    return sessionId.value
  }
  function revokePreview(item: PendingAttachment) {
    if (item.previewUrl.startsWith('blob:'))
      URL.revokeObjectURL(item.previewUrl)
  }
  function removeAttachment(id: string) {
    const item = attachments.value.find(entry => entry.id === id)
    if (item)
      revokePreview(item)
    attachments.value = attachments.value.filter(entry => entry.id !== id)
  }
  function attachUrls(items: Array<{
    url: string
    name?: string
  }>) {
    const next = items.filter((item) => {
      const url = String(item.url || '').trim()
      return isMediaUrl(url)
    })
    if (!next.length) {
      setLabError('Only generated stills can be attached')
      return
    }
    const unique = next.filter(item => !attachments.value.some(existing => existing.url === item.url))
    if (!unique.length)
      return
    if (attachments.value.length + unique.length > 9) {
      setLabError('Up to 9 images per message')
      return
    }
    clearLabError()
    for (const item of unique) {
      // Canvas stills and freshly uploaded images already live in the canvas; a
      // second entry for the same URL would render a duplicate card.
      const existing = images.value.find(image => image.url === item.url)
      const imageId = existing?.id || crypto.randomUUID()
      if (!existing) {
        images.value.unshift({
          id: imageId,
          kind: 'upload',
          status: 'success',
          prompt: item.name || 'Canvas still',
          aspectRatio: 'auto',
          resolution: '',
          url: item.url,
          error: '',
        })
      }
      attachments.value = [...attachments.value, {
        id: crypto.randomUUID(),
        name: item.name || existing?.name || 'Canvas still',
        previewUrl: item.url,
        url: item.url,
        status: 'ready',
        error: '',
        imageId,
      }]
    }
  }
  async function uploadAnnotationImage(file: File, label?: string) {
    if (isDeletingActive())
      throw new Error('This conversation is being deleted.')
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type) || file.size > 10 * 1024 * 1024)
      throw new Error('Upload a JPEG, PNG, WEBP, or GIF up to 10MB.')
    const id = await ensureSession()
    const body = new FormData()
    body.append('file', file)
    const query = new URLSearchParams({ sessionId: id, ...(label ? { name: label } : {}) })
    const response = await fetch(`${baseUrl}/v1/uploads?${query}`, {
      method: 'POST',
      credentials: 'omit',
      headers: labHeaders(false, crypto.randomUUID()),
      body,
    })
    const payload = await response.json().catch(() => ({})) as {
      sessionId?: string
      image?: AgentImage
      error?: string
    }
    if (!response.ok || !payload.image?.url)
      throw new Error(readErrorMessage(payload, 'Upload failed'))
    if (payload.sessionId)
      sessionId.value = payload.sessionId
    const image = payload.image
    images.value = [image, ...images.value.filter(item => item.id !== image.id)]
    await persistChat()
    return { url: image.url, name: label || image.name || file.name.slice(0, 100) }
  }

  async function attachFiles(fileList: File[]) {
    if (isDeletingActive())
      return
    const accepted = fileList.filter((file) => {
      const type = file.type.toLowerCase()
      return type === 'image/jpeg' || type === 'image/png' || type === 'image/webp' || type === 'image/gif'
    })
    if (!accepted.length) {
      setLabError('Upload JPEG, PNG, WEBP, or GIF')
      return
    }
    if (attachments.value.length + accepted.length > 9) {
      setLabError('Up to 9 images per message')
      return
    }
    clearLabError()
    const id = await ensureSession()
    for (const file of accepted) {
      if (file.size > 10 * 1024 * 1024) {
        setLabError('Each image must be 10MB or smaller')
        continue
      }
      const local: PendingAttachment = {
        id: crypto.randomUUID(),
        name: file.name,
        previewUrl: URL.createObjectURL(file),
        url: '',
        status: 'uploading',
        error: '',
      }
      attachments.value = [...attachments.value, local]
      try {
        const body = new FormData()
        body.append('file', file)
        const response = await fetch(`${baseUrl}/v1/uploads?sessionId=${encodeURIComponent(id)}`, {
          method: 'POST',
          credentials: 'omit',
          headers: labHeaders(false, crypto.randomUUID()),
          body,
        })
        const payload = await response.json().catch(() => ({})) as {
          sessionId?: string
          image?: AgentImage
          error?: string
        }
        if (!response.ok || !payload.image?.url)
          throw new Error(payload.error || 'Upload failed')
        if (payload.sessionId)
          sessionId.value = payload.sessionId
        const current = attachments.value.find(item => item.id === local.id)
        if (current) {
          current.status = 'ready'
          current.url = payload.image.url
          current.imageId = payload.image.id
        }
        const index = images.value.findIndex(item => item.id === payload.image!.id)
        if (index >= 0)
          images.value[index] = payload.image
        else
          images.value.unshift(payload.image)
      }
      catch (err) {
        const current = attachments.value.find(item => item.id === local.id)
        if (current) {
          current.status = 'fail'
          current.error = err instanceof Error ? err.message : 'Upload failed'
        }
        setLabError(err instanceof Error ? err.message : 'Upload failed')
      }
    }
  }
  async function sendMessage(options?: {
    newAgent?: boolean
    sketchFile?: File
    sketchName?: string
    annotationEdit?: ImageAnnotationEdit
  }): Promise<boolean> {
    if (isDeletingActive())
      return false
    if (options?.sketchFile) {
      if (pending.value || waitingForUser.value || attaching.value || status.value === 'generating' || status.value === 'queued')
        return false
      if (attachments.value.length >= 9)
        throw new Error('Remove an attachment to make room for the sketch.')
      const originAgent = activeAgentId.value
      let sketchAttachmentId = ''
      try {
        const image = await uploadAnnotationImage(options.sketchFile, options.sketchName)
        if (originAgent !== activeAgentId.value)
          throw new Error('The active agent changed. Send the sketch again.')
        attachUrls([image])
        const sketch = attachments.value.find(item => item.url === image.url)
        if (!sketch)
          throw new Error('Could not attach the sketch.')
        sketchAttachmentId = sketch.id
        attachments.value = [sketch, ...attachments.value.filter(item => item.id !== sketch.id)]
        const sent: boolean = await sendMessage({ ...options, sketchFile: undefined })
        if (!sent)
          removeAttachment(sketchAttachmentId)
        return sent
      }
      catch (cause) {
        if (sketchAttachmentId)
          removeAttachment(sketchAttachmentId)
        throw cause
      }
    }
    const text = draft.value.trim()
    const ready = readyAttachments.value
    if (options?.newAgent) {
      if ((!text && !ready.length) || attaching.value || attachments.value.some(item => item.status === 'fail')) {
        return false
      }
      if (!canCreateAgent.value) {
        setLabError('Cannot create a new agent right now. Wait for the current turn to finish or check the agent limit.')
        return false
      }
      // Move the submitted input into a fresh agent without carrying its history.
      const inputImages = images.value.filter(item => ready.some(attachment => attachment.imageId === item.id))
      const inputAttachments = attachments.value
      attachments.value = []
      createAgent()
      draft.value = text
      attachments.value = inputAttachments
      images.value = inputImages
    }
    if (!confirmation.value && sessionId.value)
      await hydrateServer()
    if (confirmation.value && shouldAutoApprove(confirmation.value)) {
      clearLabError()
      draft.value = ''
      clearComposerDraft()
      await maybeAutoApprove()
      if (confirmation.value || pending.value || status.value === 'generating' || status.value === 'queued')
        return false
    }
    if (waitingForUserChoice.value) {
      setLabError('Answer or skip the pending questions first')
      return false
    }
    if (waitingForUserConfirm.value) {
      setLabError('Confirm or cancel the pending generation first')
      return false
    }
    if ((!text && !ready.length) || pending.value || waitingForUser.value || attaching.value || status.value === 'generating' || status.value === 'queued') {
      return false
    }
    if (attachments.value.some(item => item.status === 'fail'))
      return false
    clearLabError()
    draft.value = ''
    clearComposerDraft()
    const imageIds = ready.map(item => item.imageId).filter((id): id is string => Boolean(id))
    const urls = ready.map(item => item.url)
    attachments.value.forEach(revokePreview)
    attachments.value = []
    messages.value.push({
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      imageIds,
    })
    pending.value = true
    status.value = 'thinking'
    stopping.value = false
    const epoch = streamEpoch
    const runAgentId = activeAgentId.value
    writeStore()
    void runAgentTurn(epoch, runAgentId, text, urls, options?.annotationEdit)
    return true
  }
  async function stopAgent() {
    if (!sessionId.value || stopping.value)
      return false
    if (!pending.value && status.value === 'idle')
      return false
    stopping.value = true
    try {
      const response = await fetch(`${baseUrl}/v1/sessions/${encodeURIComponent(sessionId.value)}/stop`, {
        method: 'POST',
        credentials: 'omit',
        headers: labHeaders(true, crypto.randomUUID()),
        body: '{}',
      })
      if (!response.ok) {
        const text = await parseError(response).catch(() => `Stop failed (${response.status})`)
        throw new Error(text || `Stop failed (${response.status})`)
      }
      const result = await response.json().catch(() => ({})) as {
        inFlightGenerations?: number
      }
      const inFlightGenerations = Math.max(0, Math.floor(Number(result.inFlightGenerations) || 0))
      const stopNote = agentStopNote(inFlightGenerations)
      const lastMessage = messages.value[messages.value.length - 1]
      const alreadyNoted = lastMessage?.role === 'assistant' && isAgentStopNote(lastMessage.content)
      if (!alreadyNoted) {
        if (lastMessage?.role === 'assistant' && lastMessage.streaming)
          lastMessage.streaming = false
        messages.value.push({
          id: crypto.randomUUID(),
          role: 'assistant',
          content: stopNote,
        })
      }
      if (confirmation.value?.approvedBy !== 'agent') {
        const open = confirmation.value
        if (open) {
          const message = messages.value.find(item => item.confirmation?.id === open.id)
          if (message && message.confirmationState === 'pending')
            message.confirmationState = 'cancelled'
        }
        confirmation.value = null
      }
      if (choice.value) {
        const open = choice.value
        const message = messages.value.find(item => item.choice?.id === open.id)
        if (message && message.choiceState === 'pending')
          message.choiceState = 'skipped'
        choice.value = null
      }
      await hydrateServer().catch(() => { })
      status.value = inFlightGenerations > 0 ? 'generating' : 'idle'
      pending.value = inFlightGenerations > 0
      queueNotice.value = ''
      stopping.value = false
      return true
    }
    catch (err) {
      stopping.value = false
      setLabError(err instanceof Error ? err.message : 'Could not stop the agent')
      return false
    }
  }
  async function runAgentTurn(epoch: number, runAgentId: string, text: string, urls: string[], annotationEdit?: ImageAnnotationEdit) {
    activeTurns += 1
    try {
      let locked = false
      let started = false
      for (let attempt = 0; attempt < 8; attempt++) {
        const response = await fetch(`${baseUrl}/v1/chat`, {
          method: 'POST',
          credentials: 'omit',
          headers: labHeaders(true, crypto.randomUUID()),
          body: JSON.stringify({
            sessionId: sessionId.value || undefined,
            message: text,
            attachments: urls,
            confirmPolicy: confirmPolicy.value,
            ...(annotationEdit ? { annotationEdit } : {}),
            ...agentContextSnapshot(),
          }),
        })
        if (response.status === 409) {
          locked = true
          await new Promise(resolve => setTimeout(resolve, 80 * (attempt + 1)))
          continue
        }
        started = true
        locked = await consumeSse(response, epoch, runAgentId)
        if (!locked)
          break
        await new Promise(resolve => setTimeout(resolve, 80 * (attempt + 1)))
      }
      if (epoch !== streamEpoch)
        return
      if (!started || locked)
        throw new Error('This session is already running')
      if (activeAgentId.value === runAgentId)
        await maybeAutoApprove()
    }
    catch (err) {
      if (epoch !== streamEpoch)
        return
      if (isDisconnectError(err) || (err instanceof Error && (err.name === 'AbortError' || err.message === 'This operation was aborted'))) {
        setLabError(agentRecoveryNotice(err instanceof Error ? err.message : String(err)))
        // Browser can drop mid-SSE; recover pending confirm and start generation server-side.
        await hydrateServer().catch(() => { })
        await maybeAutoApprove().catch(() => { })
        scheduleAutoApproveRetry(800)
        scheduleAutoApproveRetry(2500)
        return
      }
      const text = err instanceof Error ? err.message : 'Failed to reach the agent runtime'
      if (/pending generation first/i.test(text)) {
        await hydrateServer()
        await maybeAutoApprove()
        if (!waitingForUser.value) {
          clearLabError()
          return
        }
      }
      if (/pending questions first/i.test(text)) {
        await hydrateServer()
        if (waitingForUserChoice.value) {
          clearLabError()
          return
        }
      }
      setLabError(text, !isSessionLockError(text))
      if (!isSessionLockError(text))
        online.value = false
    }
    finally {
      activeTurns = Math.max(0, activeTurns - 1)
      if (epoch === streamEpoch) {
        if (activeAgentId.value !== runAgentId) {
          patchStoredAgent(runAgentId, (agent) => {
            const busy = agent.status === 'generating' || agent.status === 'queued' || Boolean(agent.pending)
            return { ...agent, pending: busy, busy, updatedAt: Date.now() }
          })
        }
        else {
          await hydrateServer()
          await maybeAutoApprove()
          await finishTurnBusy()
          const last = messages.value[messages.value.length - 1]
          if (last?.streaming)
            last.streaming = false
          void persistCanvasResults().then(() => {
            if (epoch !== streamEpoch)
              return
            trimLab()
            void persistChat()
          })
        }
      }
    }
  }
  function shouldAutoApprove(payload: ConfirmationPayload | null) {
    if (!payload)
      return false
    if (confirmPolicy.value === 'auto')
      return true
    if (confirmPolicy.value === 'always')
      return false
    return !(payload.uncertainFields?.length)
  }
  const autoApprovingIds = new Set<string>()
  async function maybeAutoApprove() {
    if (stopping.value || Date.now() < agentWriteRetryAt)
      return
    const open = confirmation.value
    if (!open || !sessionId.value || !shouldAutoApprove(open) || autoApprovingIds.has(open.id))
      return
    autoApprovingIds.add(open.id)
    try {
      await resolveConfirmation('confirm', open.params, 'agent')
    }
    finally {
      autoApprovingIds.delete(open.id)
    }
  }
  function scheduleAutoApproveRetry(delayMs = 1200) {
    if (!import.meta.client)
      return
    window.setTimeout(() => {
      void (async () => {
        await hydrateServer().catch(() => { })
        await maybeAutoApprove()
      })()
    }, delayMs)
  }
  watch(confirmPolicy, () => {
    void maybeAutoApprove()
  })
  const AUTO_RETRY_LIMIT = 2
  const autoRetries = new Map<string, number>()
  let syncingJobs = false
  let settlingMedia = false
  let jobSyncTimer: ReturnType<typeof setInterval> | undefined
  function stopJobSync() {
    if (!jobSyncTimer)
      return
    clearInterval(jobSyncTimer)
    jobSyncTimer = undefined
  }
  async function retryFailedMedia(items: AgentImage[]) {
    const retryable = items.filter((item) => {
      if (!isRetryableJobFail(item))
        return false
      return (autoRetries.get(item.id) || 0) < AUTO_RETRY_LIMIT
    })
    if (!retryable.length)
      return false
    for (const item of retryable)
      autoRetries.set(item.id, (autoRetries.get(item.id) || 0) + 1)
    const note = retryable.length === 1
      ? '有一条镜头生成失败，正在自动重试。'
      : `有 ${retryable.length} 条镜头生成失败，正在自动重试。`
    messages.value.push({
      id: crypto.randomUUID(),
      role: 'assistant',
      content: note,
    })
    const instruction = retryable.length === 1
      ? `刚才有镜头失败了（原因：${publicGenerationFailMessage(retryable[0]?.error)}）。请只重试失败的那一镜，使用相同的参考图、时长、比例和提示词，不要重拍整部片子。失败镜头：${retryable[0]?.prompt || ''}`
      : `刚才有镜头失败了。请只重试失败的镜头，使用相同的参考图、时长、比例和提示词，不要重拍整部片子。\n${retryable.map(item => `- ${item.prompt}（${publicGenerationFailMessage(item.error)}）`).join('\n')}`
    pending.value = true
    status.value = 'thinking'
    stopping.value = false
    const epoch = bumpStream()
    const runAgentId = activeAgentId.value
    writeStore()
    void runAgentTurn(epoch, runAgentId, instruction, [])
    return true
  }
  function notifyFailedMedia(items: AgentImage[]) {
    if (!items.length)
      return
    const nonRetryable = items.every(item => !isRetryableJobFail(item))
    const content = nonRetryable
      ? (items.length === 1
          ? '这条生成的提交状态未知。为避免重复扣费，我没有自动重试；如果需要，请明确告诉我再生成一次。'
          : `有 ${items.length} 条生成的提交状态未知。为避免重复扣费，我没有自动重试；如果需要，请明确告诉我再生成一次。`)
      : (items.length === 1
          ? '有一条镜头生成失败。需要我再试这一镜吗？'
          : `有 ${items.length} 条镜头生成失败。需要我再试吗？`)
    const last = messages.value[messages.value.length - 1]
    if (last?.role === 'assistant' && last.content === content)
      return
    messages.value.push({
      id: crypto.randomUUID(),
      role: 'assistant',
      content,
    })
  }
  const notifiedFails = new Set<string>()
  function unnotifiedFails(items: AgentImage[]) {
    return items.filter((item) => {
      if (item.status !== 'fail' || notifiedFails.has(item.id))
        return false
      notifiedFails.add(item.id)
      return true
    })
  }
  function applyJobToImage(job: GenerationJobPublic) {
    const taskId = String(job.taskId || '')
    if (!taskId.startsWith('agent_'))
      return null
    const imageId = taskId.slice('agent_'.length)
    const index = images.value.findIndex(item => item.id === imageId || agentJobTaskId(item.id) === taskId)
    if (index < 0)
      return null
    const current = images.value[index]
    if (!current)
      return null
    if (current.status !== 'generating')
      return current.status === 'fail' ? current : null
    const previewUrl = job.resultUrls[0]
    const ready = Boolean(previewUrl) && (job.state === 'success'
      || job.state === 'archiving'
      || job.state === 'moderating')
    if (ready || job.state === 'fail') {
      if (ready && previewUrl) {
        const next = {
          ...current,
          status: 'success' as const,
          url: previewUrl,
          error: '',
          failCode: '',
          retryable: undefined,
        }
        images.value[index] = next
        autoRetries.delete(current.id)
        void persistCanvasResults([next])
        return null
      }
    }
    if (job.state === 'fail') {
      const next = {
        ...current,
        status: 'fail' as const,
        error: job.failMsg || 'Generation failed',
        failCode: job.failCode || '',
        retryable: isGenerationFailureRetryable(job.failCode),
      }
      images.value[index] = next
      return next
    }
    return null
  }
  let latestCanvasJobs: GenerationJobPublic[] = []
  function applyCanvasJobs(jobs: GenerationJobPublic[]) {
    latestCanvasJobs = jobs
    if (hydrating)
      return
    const newlyFailed = jobs.map(job => applyJobToImage(job)).filter((item): item is AgentImage => Boolean(item))
    void maybeSettleMedia(newlyFailed)
  }
  async function maybeSettleMedia(newlyFailed: AgentImage[] = []) {
    if (activeTurns > 0)
      return
    if (images.value.some(item => item.status === 'generating'))
      return
    if (status.value === 'thinking' || status.value === 'calling_tool')
      return
    if (waitingForUser.value)
      return
    if (!(status.value === 'generating' || status.value === 'queued' || pending.value))
      return
    const failed = unnotifiedFails([
      ...newlyFailed,
      ...images.value.filter(item => item.status === 'fail'),
    ])
    await settleFinishedMedia(failed)
  }
  async function finishTurnBusy() {
    await hydrateServer().catch(() => { })
    await maybeAutoApprove()
    await maybeSettleMedia()
    if (status.value === 'thinking' || status.value === 'calling_tool') {
      pending.value = true
      return
    }
    if (confirmation.value && shouldAutoApprove(confirmation.value)) {
      status.value = 'generating'
      pending.value = true
      return
    }
    const generatingMedia = images.value.some(item => item.status === 'generating')
    if (generatingMedia) {
      status.value = 'generating'
      pending.value = true
      return
    }
    pending.value = waitingForUser.value
    if (status.value === 'generating' || status.value === 'queued' || !pending.value)
      status.value = 'idle'
    if (!pending.value && status.value === 'idle')
      stopping.value = false
  }
  async function settleFinishedMedia(failed: AgentImage[]) {
    if (settlingMedia)
      return
    settlingMedia = true
    try {
      // Detached confirm turns lose SSE; pick up the next confirmation / busy loop here.
      const remote = await hydrateServer().catch(() => ({ busy: false, hasPendingConfirm: false }))
      await maybeAutoApprove()
      if (waitingForUser.value) {
        pending.value = true
        return
      }
      if (confirmation.value && shouldAutoApprove(confirmation.value)) {
        pending.value = true
        status.value = 'generating'
        return
      }
      if (remote?.busy || images.value.some(item => item.status === 'generating')) {
        pending.value = true
        status.value = images.value.some(item => item.status === 'generating') ? 'generating' : 'thinking'
        return
      }
      pending.value = false
      status.value = 'idle'
      if (!failed.length)
        return
      if (stopping.value) {
        notifyFailedMedia(failed)
        return
      }
      const nonRetryable = failed.filter(item => !isRetryableJobFail(item))
      notifyFailedMedia(nonRetryable)
      const retried = await retryFailedMedia(failed)
      if (!retried)
        notifyFailedMedia(failed.filter(isRetryableJobFail))
    }
    finally {
      settlingMedia = false
      void persistChat()
    }
  }
  async function syncGeneratingJobs() {
    if (syncingJobs || hydrating)
      return
    const generating = images.value.filter(item => item.status === 'generating' && item.kind !== 'upload')
    const holdBusy = status.value === 'generating'
      || status.value === 'queued'
      || status.value === 'thinking'
      || status.value === 'calling_tool'
      || (pending.value && !waitingForUser.value)
      || Boolean(confirmation.value && shouldAutoApprove(confirmation.value))
    if (!generating.length && !holdBusy)
      return
    syncingJobs = true
    const newlyFailed: AgentImage[] = []
    try {
      if (sessionId.value) {
        await hydrateServer()
        await maybeAutoApprove()
      }
      {
        const stillGenerating = images.value.filter(item => item.status === 'generating' && item.kind !== 'upload')
        await Promise.all(stillGenerating.map(async (item) => {
          try {
            const job = await $fetch<GenerationJobPublic>(`/api/ai/jobs/${encodeURIComponent(agentJobTaskId(item.id))}`)
            const failed = applyJobToImage(job)
            if (failed)
              newlyFailed.push(failed)
          }
          catch {
            // The canvas job may not exist yet.
          }
        }))
      }
      await maybeSettleMedia(newlyFailed)
    }
    finally {
      syncingJobs = false
    }
  }
  watch(() => images.value.some(item => item.status === 'generating')
    || status.value === 'generating'
    || status.value === 'queued'
    || status.value === 'thinking'
    || status.value === 'calling_tool'
    || (pending.value && !waitingForUser.value)
    || Boolean(confirmation.value && shouldAutoApprove(confirmation.value)), (busy) => {
    if (!import.meta.client)
      return
    if (busy) {
      if (!jobSyncTimer) {
        void syncGeneratingJobs()
        jobSyncTimer = setInterval(() => {
          void syncGeneratingJobs()
        }, 3000)
      }
      return
    }
    stopJobSync()
  }, { immediate: true })
  function stageOptimisticGeneration(payload: ConfirmationPayload, owner?: AgentChatMessage) {
    const staged = buildOptimisticGenerationImages(payload, images.value.map(item => item.id))
    if (!staged.length)
      return
    images.value = [...staged, ...images.value]
    if (owner) {
      const ids = new Set(owner.imageIds || [])
      for (const item of staged)
        ids.add(item.id)
      owner.imageIds = [...ids]
    }
  }
  async function resolveConfirmation(action: 'confirm' | 'cancel', params?: ConfirmationPayload['params'], approvedBy: 'agent' | 'user' = 'user') {
    if (isDeletingActive() || !confirmation.value || !sessionId.value)
      return
    const openConfirmation = confirmation.value
    const confirmationId = openConfirmation.id
    const message = messages.value.find(item => item.confirmation?.id === confirmationId)
    if (message) {
      message.confirmationState = action === 'confirm' ? 'confirmed' : 'cancelled'
      if (action === 'confirm' && params)
        message.resolvedParams = params
      if (action === 'confirm' && message.confirmation) {
        message.confirmation = {
          ...message.confirmation,
          approvedBy: message.confirmation.approvedBy || approvedBy,
        }
      }
    }
    if (action === 'confirm')
      stageOptimisticGeneration(openConfirmation, message)
    pending.value = true
    confirmation.value = null
    clearLabError()
    status.value = action === 'confirm' ? 'generating' : 'thinking'
    const epoch = streamEpoch
    const runAgentId = activeAgentId.value
    const confirmSessionId = sessionId.value
    activeTurns += 1
    try {
      let locked = false
      let started = false
      let busyMessage = ''
      for (let attempt = 0; attempt < 8; attempt++) {
        const response = await fetch(`${baseUrl}/v1/sessions/${encodeURIComponent(confirmSessionId)}/confirm`, {
          method: 'POST',
          credentials: 'omit',
          headers: labHeaders(true, crypto.randomUUID()),
          body: JSON.stringify({
            confirmationId,
            action,
            params,
          }),
        })
        if (response.status === 409) {
          busyMessage = await parseError(response)
          // Confirm was already accepted server-side (browser may have closed mid-flight).
          if (/already processed|already in progress|no matching confirmation/i.test(busyMessage)) {
            await hydrateServer()
            const stillOpen = (confirmation.value as ConfirmationPayload | null)?.id === confirmationId
            if (!stillOpen) {
              started = true
              locked = false
              if (action === 'confirm' && activeAgentId.value === runAgentId)
                status.value = 'generating'
              break
            }
          }
          locked = true
          await new Promise(resolve => setTimeout(resolve, 80 * (attempt + 1)))
          continue
        }
        if (epoch !== streamEpoch)
          return
        started = true
        const contentType = response.headers.get('content-type') || ''
        // Detached confirm: BFF returns JSON after kicking off server-side generation.
        if (contentType.includes('application/json')) {
          if (!response.ok)
            throw new Error(await parseError(response))
          const payload = await response.json().catch(() => ({})) as {
            ok?: boolean
            status?: string
            error?: string
          }
          if (payload.error)
            throw new Error(payload.error)
          if (action === 'confirm' && activeAgentId.value === runAgentId)
            status.value = payload.status === 'idle' ? 'idle' : 'generating'
          locked = false
          break
        }
        locked = await consumeSse(response, epoch, runAgentId)
        if (!locked)
          break
        busyMessage = 'This session is already running'
        await new Promise(resolve => setTimeout(resolve, 80 * (attempt + 1)))
      }
      if (epoch !== streamEpoch)
        return
      if (!started || locked)
        throw new Error(busyMessage || 'This session is already running')
    }
    catch (err) {
      if (epoch !== streamEpoch)
        return
      if (activeAgentId.value === runAgentId) {
        const text = err instanceof Error ? err.message : 'Failed to resolve confirmation'
        setLabError(text, !isSessionLockError(text))
        if (message?.confirmation) {
          confirmation.value = {
            ...message.confirmation,
            approvedBy: message.confirmation.approvedBy || approvedBy,
          }
          if (message.confirmation.approvedBy === 'agent' || approvedBy === 'agent') {
            message.confirmationState = 'confirmed'
            scheduleAutoApproveRetry(1000)
            scheduleAutoApproveRetry(3000)
          }
          else if (message.confirmationState === 'confirmed') {
            message.confirmationState = 'pending'
          }
        }
      }
    }
    finally {
      activeTurns = Math.max(0, activeTurns - 1)
      if (epoch === streamEpoch && activeAgentId.value === runAgentId) {
        await hydrateServer()
        await persistCanvasResults()
        trimLab()
        await persistChat()
        await maybeAutoApprove()
        // Detached confirm drops SSE; keep probing for the next auto card / busy turn.
        if (action === 'confirm' && (approvedBy === 'agent' || message?.confirmation?.approvedBy === 'agent' || shouldAutoApprove(confirmation.value))) {
          scheduleAutoApproveRetry(1200)
          scheduleAutoApproveRetry(3500)
          scheduleAutoApproveRetry(8000)
        }
        await finishTurnBusy()
        const last = messages.value[messages.value.length - 1]
        if (last?.streaming)
          last.streaming = false
      }
    }
  }
  async function resolveChoice(action: 'submit' | 'skip', answers?: ChoiceAnswer[]) {
    if (isDeletingActive() || !choice.value || !sessionId.value)
      return
    const choiceId = choice.value.id
    const message = messages.value.find(item => item.choice?.id === choiceId)
    if (message) {
      message.choiceState = action === 'skip' ? 'skipped' : 'answered'
      if (action === 'submit' && answers)
        message.choiceAnswers = answers
    }
    pending.value = true
    choice.value = null
    clearLabError()
    status.value = 'thinking'
    const epoch = streamEpoch
    const runAgentId = activeAgentId.value
    const choiceSessionId = sessionId.value
    activeTurns += 1
    try {
      let locked = false
      let started = false
      let busyMessage = ''
      for (let attempt = 0; attempt < 8; attempt++) {
        const response = await fetch(`${baseUrl}/v1/sessions/${encodeURIComponent(choiceSessionId)}/choice`, {
          method: 'POST',
          credentials: 'omit',
          headers: labHeaders(true, crypto.randomUUID()),
          body: JSON.stringify({
            choiceId,
            action,
            answers,
          }),
        })
        if (response.status === 409) {
          busyMessage = await parseError(response)
          if (/already processed|already in progress|no matching questions/i.test(busyMessage)) {
            await hydrateServer()
            const stillOpen = (choice.value as ChoicePayload | null)?.id === choiceId
            if (!stillOpen) {
              started = true
              locked = false
              break
            }
          }
          locked = true
          await new Promise(resolve => setTimeout(resolve, 80 * (attempt + 1)))
          continue
        }
        if (epoch !== streamEpoch)
          return
        started = true
        const contentType = response.headers.get('content-type') || ''
        if (contentType.includes('application/json')) {
          if (!response.ok)
            throw new Error(await parseError(response))
          const payload = await response.json().catch(() => ({})) as {
            ok?: boolean
            status?: string
            error?: string
          }
          if (payload.error)
            throw new Error(payload.error)
          if (activeAgentId.value === runAgentId)
            status.value = payload.status === 'idle' ? 'idle' : 'thinking'
          locked = false
          break
        }
        locked = await consumeSse(response, epoch, runAgentId)
        if (!locked)
          break
        busyMessage = 'This session is already running'
        await new Promise(resolve => setTimeout(resolve, 80 * (attempt + 1)))
      }
      if (epoch !== streamEpoch)
        return
      if (!started || locked)
        throw new Error(busyMessage || 'This session is already running')
    }
    catch (err) {
      if (epoch !== streamEpoch)
        return
      if (isDisconnectError(err)) {
        // The server may already have accepted the answer and continued. Do not
        // reopen the old choice or resend it; recover the authoritative snapshot.
        return
      }
      if (activeAgentId.value === runAgentId) {
        const text = err instanceof Error ? err.message : 'Failed to send your choices'
        setLabError(text, !isSessionLockError(text))
        if (message?.choice) {
          choice.value = message.choice
          if (message.choiceState === 'answered' || message.choiceState === 'skipped')
            message.choiceState = 'pending'
        }
      }
    }
    finally {
      activeTurns = Math.max(0, activeTurns - 1)
      if (epoch === streamEpoch && activeAgentId.value === runAgentId) {
        await hydrateServer()
        trimLab()
        await persistChat()
        await finishTurnBusy()
        const last = messages.value[messages.value.length - 1]
        if (last?.streaming)
          last.streaming = false
      }
    }
  }
  function resetLab() {
    bumpStream()
    stopJobSync()
    autoRetries.clear()
    persistedCanvasIds.clear()
    persistingCanvasIds.clear()
    patchedInputIds.clear()
    storedAgents.value = []
    activeAgentId.value = ''
    retainedCanvasImages.value = []
    removedSessionIds.value = []
    deletingAgentId.value = ''
    deleteError.value = ''
    scopeEpoch += 1
    agentTitle.value = DEFAULT_AGENT_TITLE
    titleSource.value = 'default'
    queueNotice.value = ''
    sessionId.value = ''
    messages.value = []
    images.value = []
    confirmation.value = null
    choice.value = null
    status.value = 'idle'
    pending.value = false
    clearLabError()
    draft.value = ''
    attachments.value.forEach(revokePreview)
    attachments.value = []
  }
  function createAgent() {
    if (deletingAgentId.value || !canCreateAgent.value)
      return
    commitCurrentAgent()
    void persistChat()
    const next = emptyStoredAgent(nextDefaultTitle())
    storedAgents.value = [...storedAgents.value, next]
    hydrating = true
    applyAgent(next)
    hydrating = false
    writeStore()
  }
  async function selectAgent(id: string) {
    if (deletingAgentId.value || !id || id === activeAgentId.value || !canSwitchAgent.value)
      return
    commitCurrentAgent()
    await persistChat()
    const found = storedAgents.value.find(agent => agent.id === id)
    if (!found)
      return
    hydrating = true
    try {
      applyAgent(found)
      await hydrateServer()
    }
    finally {
      hydrating = false
    }
    applyCanvasJobs(latestCanvasJobs)
    writeStore()
  }
  async function deleteAgent(id: string) {
    const target = storedAgents.value.find(agent => agent.id === id)
    if (!target || deletingAgentId.value)
      return false
    const current = snapshotCurrent()
    const liveTarget = target.id === current.id
      ? current
      : target
    if (!canDeleteAgent([
      ...storedAgents.value.filter(agent => agent.id !== current.id),
      current,
    ], id, { attaching: attaching.value })) {
      deleteError.value = 'chat.deleteBusy'
      return false
    }
    const epoch = scopeEpoch
    const projectId = projectScope.value
    deletingAgentId.value = id
    deleteError.value = ''
    try {
      if (liveTarget.sessionId) {
        const retained = (liveTarget.images || []).filter(image => image.url)
        const result = await $fetch<{
          ok?: boolean
          sessionId?: string
          retainedCanvasImages?: AgentImage[]
        }>(`/api/ai/agent-chats/${encodeURIComponent(liveTarget.sessionId)}`, {
          method: 'DELETE',
          query: { projectId },
          body: { projectId, retainImages: retained },
        })
        if (epoch !== scopeEpoch || disposed)
          return true
        if (liveTarget.sessionId)
          removedSessionIds.value = [...new Set([...removedSessionIds.value, liveTarget.sessionId])]
        retainedCanvasImages.value = mergeRetainedCanvasImages(retainedCanvasImages.value, result.retainedCanvasImages || retained)
      }
      else if (!isEmptyDeletableAgent(liveTarget) && ((liveTarget.messages || []).length || (liveTarget.images || []).length)) {
        deleteError.value = 'chat.deleteFailed'
        return false
      }
      if (epoch !== scopeEpoch || disposed)
        return true
      const next = applySuccessfulAgentDelete(storedAgents.value, id, activeAgentId.value, () => emptyStoredAgent(nextDefaultTitle()))
      if (next.switchActive) {
        bumpStream()
        hydrating = true
        try {
          applyAgent(next.fallback)
        }
        finally {
          hydrating = false
        }
      }
      storedAgents.value = next.agents
      writeStore()
      return true
    }
    catch (error) {
      const status = Number((error as { statusCode?: unknown, status?: unknown }).statusCode || (error as { status?: unknown }).status || 0)
      if (status === 409)
        deleteError.value = 'chat.deleteBusy'
      else if (!status)
        deleteError.value = 'chat.deleteUnknown'
      else
        deleteError.value = 'chat.deleteFailed'
      return false
    }
    finally {
      if (deletingAgentId.value === id)
        deletingAgentId.value = ''
    }
  }
  let healthTimer: ReturnType<typeof setInterval> | undefined
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  let persistTimer: ReturnType<typeof setTimeout> | undefined
  function restoreComposerDraft(consume: boolean) {
    const pendingDraft = draft.value || readComposerDraft()
    if (!pendingDraft)
      return
    draft.value = pendingDraft
    writeComposerDraft(pendingDraft)
    if (consume)
      clearComposerDraft()
  }
  function stashComposerDraft() {
    writeComposerDraft(draft.value || readComposerDraft())
  }
  async function hydrate() {
    if (hydrating)
      return
    const carry = draft.value || readComposerDraft()
    hydrating = true
    try {
      resetLab()
      if (!storageKey.value) {
        seedDefaultAgent()
        online.value = null
        if (healthTimer) {
          clearInterval(healthTimer)
          healthTimer = undefined
        }
        if (carry)
          draft.value = carry
        restoreComposerDraft(false)
        return
      }
      hydrateLocal()
      ping()
      await hydrateRemoteChats()
      await hydrateRemoteSessions()
      await hydrateServer()
      await persistCanvasResults()
      trimLab()
      await persistChat()
      if (!healthTimer)
        healthTimer = setInterval(ping, 10000)
      if (carry)
        draft.value = carry
      restoreComposerDraft(Boolean(projectScope.value))
      writeStore()
    }
    finally {
      hydrating = false
    }
    applyCanvasJobs(latestCanvasJobs)
  }
  const persistScope = effectScope(true)
  persistScope.run(() => {
    watch(draft, (value) => {
      if (hydrating)
        return
      writeComposerDraft(value)
    })
    watch(storageKey, (key, previous) => {
      if (key === previous)
        return
      bootstrapped = true
      void hydrate()
    })
    if (import.meta.client) {
      useEventListener(document, 'visibilitychange', () => {
        if (document.visibilityState !== 'hidden')
          return
        writeStore()
        void persistChat()
      })
    }
    watch([sessionId, messages, images, confirmation, choice, draft, agentTitle, status, pending, queueNotice], () => {
      if (hydrating)
        return
      if (saveTimer)
        clearTimeout(saveTimer)
      saveTimer = setTimeout(writeStore, 150)
      if (persistTimer)
        clearTimeout(persistTimer)
      persistTimer = setTimeout(() => {
        void persistChat()
      }, 800)
    }, { deep: true })
  })
  async function syncRemoteAgents() {
    // A page handoff must not replace a live turn with an archived snapshot.
    if (activeTurns > 0)
      return
    await hydrateRemoteChats()
    await hydrateRemoteSessions()
    await hydrateServer()
    writeStore()
  }
  let hydrationPromise: Promise<void> | null = null
  async function ensureHydrated() {
    // Project switches and tool submissions can request the same hydration together.
    if (hydrationPromise)
      return hydrationPromise
    if (hydrating)
      return
    hydrationPromise = (async () => {
      if (!bootstrapped) {
        bootstrapped = true
        await hydrate()
        return
      }
      await syncRemoteAgents()
    })()
    try {
      await hydrationPromise
    }
    finally {
      hydrationPromise = null
    }
  }
  function bindOptions(next?: {
    projectId?: MaybeRefOrGetter<string>
    onJobs?: (jobs: GenerationJobPublic[]) => void
  }) {
    onJobs.value = next?.onJobs
  }
  function flush() {
    if (disposed)
      return
    writeStore()
    void persistChat()
  }
  function dispose() {
    if (disposed)
      return
    disposed = true
    persistScope.stop()
    bumpStream()
    stopJobSync()
    if (healthTimer) {
      clearInterval(healthTimer)
      healthTimer = undefined
    }
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = undefined
    }
    if (persistTimer) {
      clearTimeout(persistTimer)
      persistTimer = undefined
    }
    scopeEpoch += 1
  }
  return {
    sessionId,
    messages,
    images,
    status,
    confirmation,
    waitingForUserConfirm,
    waitingForUserChoice,
    online,
    error,
    pending,
    draft,
    qualityPreference,
    confirmPolicy,
    attachments,
    attaching,
    busy,
    queueNotice,
    agents,
    allImages,
    sessionIdsForImages,
    activeAgentId,
    canCreateAgent,
    canSwitchAgent,
    createAgent,
    selectAgent,
    deleteAgent,
    deletingAgentId,
    deleteError,
    sendMessage,
    stopAgent,
    stopping,
    attachFiles,
    uploadAnnotationImage,
    attachUrls,
    removeAttachment,
    removeCanvasImages,
    removeCanvasResult,
    resolveConfirmation,
    resolveChoice,
    bindOptions,
    ensureHydrated,
    flush,
    dispose,
    stashComposerDraft,
    applyCanvasJobs,
  }
}
export function forgetAgentLab(projectId: string) {
  const key = agentLabCacheKey(projectId)
  const lab = key ? agentLabs.get(key) : undefined
  lab?.dispose()
  if (key)
    agentLabs.delete(key)
  if (!import.meta.client)
    return
  try {
    localStorage.removeItem(labStorageKey(projectId))
    localStorage.removeItem(`${LEGACY_STORAGE_PREFIX}${projectId || 'home'}`)
    if (projectId)
      localStorage.removeItem(`${LEGACY_STORAGE_PREFIX}local:${projectId}`)
  }
  catch {
    // Private mode or quota should not block project deletion.
  }
}
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    agentLabs.clear()
  })
}
