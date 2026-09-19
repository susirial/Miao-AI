<script setup lang="ts">
import type { AiModelConfig } from '~~/shared/types/aiModel'
import type { GenerationJobPublic } from '~~/shared/types/generation'
import type { ImageAnnotationEdit, ImageAnnotationPoint, ImageAnnotationReference } from '~~/shared/utils/imageAnnotations'
import type { SketchElement } from '~~/shared/utils/sketchToImage'
import type { AgentChatMessage, AgentConfirmPolicy, AgentImage, AgentListItem, AgentQuality, AgentStatus, ChoiceAnswer, ConfirmationPayload, PendingAttachment } from '~/composables/useAgentLab'
import { ArrowUp, ChevronDown, Paperclip, Plus, Square, Trash2, X } from 'lucide-vue-next'
import { normalizeComposerSelection } from '~~/shared/utils/agentComposerSelection'
import { AGENT_MODELS, agentModelLogo, modelMention, readModelMentions, stripModelMentions } from '~~/shared/utils/agentModels'
import { composerPlaceholderForSkills, findComposerCommand, PUBLIC_AGENT_SKILLS, readSkillCommands, searchAgentSkills, stripSkillCommands } from '~~/shared/utils/agentSkills'
import { annotationSourcesForChoice } from '~~/shared/utils/annotationSources'
import { isMediaVideoUrl } from '~~/shared/utils/mediaUrl'
import { confirmationWorking } from '~/utils/agentConfirmationState'
import { messageMedia } from '~/utils/agentMessageMedia'
import { presentAgentResults } from '~/utils/agentResultPresentation'

const props = withDefaults(defineProps<{
  messages: AgentChatMessage[]
  sessionId?: string
  images: AgentImage[]
  projectJobs?: GenerationJobPublic[]
  projectAssetsLoading?: boolean
  projectAssetsError?: string
  attachments: PendingAttachment[]
  status: AgentStatus
  pending: boolean
  attaching: boolean
  stopping?: boolean
  error: string
  confirmationOpen: boolean
  choiceOpen?: boolean
  queueNotice?: string
  agents?: AgentListItem[]
  activeAgentId?: string
  canCreateAgent?: boolean
  canSwitchAgent?: boolean
  composerOnly?: boolean
  hideTranscript?: boolean
  deletePending?: boolean
  deleteError?: string
  deletingAgentId?: string
  uploadAnnotationImage?: (file: File) => Promise<ImageAnnotationReference>
}>(), {
  projectJobs: () => [],
  queueNotice: '',
  agents: () => [],
  activeAgentId: '',
  canCreateAgent: true,
  canSwitchAgent: true,
  composerOnly: false,
  hideTranscript: false,
  stopping: false,
  choiceOpen: false,
  deletePending: false,
  deleteError: '',
  deletingAgentId: '',
})
const emit = defineEmits<{
  send: [
        options?: { sketchFile?: File, sketchName?: string, annotationEdit?: ImageAnnotationEdit },
  ]
  stop: [
  ]
  browseAssets: [
  ]
  attach: [
        files: File[],
  ]
  attachAsset: [
        items: Array<{
          url: string
          name: string
        }>,
  ]
  removeAttachment: [
        id: string,
  ]
  confirm: [
        params: ConfirmationPayload['params'],
  ]
  cancel: [
  ]
  submitChoice: [
        answers: ChoiceAnswer[],
  ]
  skipChoice: [
  ]
  createAgent: [
  ]
  selectAgent: [
        id: string,
  ]
  deleteAgent: [
        id: string,
  ]
}>()
const draft = defineModel<string>('draft', { default: '' })
const qualityPreference = defineModel<AgentQuality>('qualityPreference', { default: 'hobby' })
const confirmPolicy = defineModel<AgentConfirmPolicy>('confirmPolicy', { default: 'always' })
const { t } = useI18n()
const selectedModels = computed(() => readModelMentions(draft.value).map(id => AGENT_MODELS.find(model => model.id === id)!))
const selectedSkills = computed(() => readSkillCommands(draft.value))
const sketchSelected = computed(() => selectedSkills.value.some(skill => skill.id === 'sketch-to-image'))
const annotationSelected = computed(() => selectedSkills.value.some(skill => skill.id === 'image-annotation-edit'))
const annotationSource = computed(() => props.attachments.find(item => item.status === 'ready' && item.url && !isMediaVideoUrl(item.url)))
const annotationPoints = ref<ImageAnnotationPoint[]>([])
watch(() => annotationSource.value?.url, () => {
  annotationPoints.value = []
})
const sketchElements = ref<SketchElement[]>([])
const sketchCanvas = ref<{ exportFile: () => Promise<File> } | null>(null)
const sketchExporting = ref(false)
const sketchError = ref('')
const sketchDrawn = computed(() => sketchElements.value.some(element => element.kind === 'stroke' || element.text.trim()))
const composerText = computed({
  get: () => stripSkillCommands(stripModelMentions(draft.value)),
  set: (text: string) => {
    draft.value = normalizeComposerSelection([
      ...selectedModels.value.map(modelMention),
      ...selectedSkills.value.map(skill => `/${skill.id}`),
      text,
    ].join(' '))
  },
})
const mention = ref<{
  start: number
  end: number
  query: string
  trigger: '@' | '/'
} | null>(null)
watch(() => Boolean(mention.value), (open) => {
  if (open && mention.value?.trigger === '@')
    emit('browseAssets')
})
const mentionIndex = ref(0)
const mentionColumn = ref<'models' | 'assets'>('models')
const mentionStyle = ref<Record<string, string>>({})
const modelListId = `model-list-${useId()}`
let composerElement: HTMLTextAreaElement | null = null
const composerInput = useTemplateRef('composerInput')
const modelMatches = computed(() => {
  const query = (mention.value?.query || '').toLowerCase().trim()
  const taskQuery = ['image-to-image', 'reference-to-video'].includes(query) ? query.replaceAll('-', ' ') : null
  const terms = query.split(/\s+/).filter(Boolean)
  return AGENT_MODELS.filter(model => !selectedModels.value.some(selected => selected.id === model.id)
    && (taskQuery
      ? model.task.toLowerCase() === taskQuery
      : terms.every(term => `${model.name} ${model.task} ${model.id}`.toLowerCase().includes(term))))
})
const skillMatches = computed(() => searchAgentSkills(mention.value?.trigger === '/' ? mention.value.query : ''))
const projectAssets = computed(() => {
  const result = new Map<string, {
    id: string
    name: string
    url: string
    video: boolean
  }>()
  for (const job of props.projectJobs) {
    for (const [index, url] of job.resultUrls.entries()) {
      if (url)
        result.set(url, { id: `${job.taskId}:${index}`, url, name: String(job.input.asset_name || job.prompt || job.model).slice(0, 100), video: job.category === 'Video' || isMediaVideoUrl(url) })
    }
  }
  for (const image of props.images) {
    if (image.url && !result.has(image.url))
      result.set(image.url, { id: image.id, url: image.url, name: image.name || image.prompt.slice(0, 100) || 'Untitled asset', video: image.kind === 'video' || isMediaVideoUrl(image.url) })
  }
  return [...result.values()]
})
const annotationReferenceImages = computed<ImageAnnotationReference[]>(() => projectAssets.value
  .filter(asset => !asset.video)
  .map(asset => ({ url: asset.url, name: asset.name })))
function annotationSourceImages(message: AgentChatMessage) {
  return annotationSourcesForChoice(props.messages, message.id, item => messageMedia(item, props.images))
}
const assetMatches = computed(() => {
  const terms = (mention.value?.query || '').toLowerCase().trim().split(/\s+/).filter(Boolean)
  return projectAssets.value.filter(asset => terms.every(term => asset.name.toLowerCase().includes(term)))
})
const mentionCount = computed(() => mention.value?.trigger === '/'
  ? skillMatches.value.length
  : mentionColumn.value === 'models' ? modelMatches.value.length : assetMatches.value.length)
const activeMentionId = computed(() => mention.value && mentionCount.value
  ? `${modelListId}-${mention.value.trigger === '/' ? 'skills' : mentionColumn.value}-${mentionIndex.value}`
  : undefined)
watch(mentionCount, (count) => { mentionIndex.value = Math.max(0, Math.min(mentionIndex.value, count - 1)) })
function updateMention(event: Event) {
  const input = event.target as HTMLTextAreaElement
  composerElement = input
  const bounds = input.closest('[data-slot=input-group]')!.getBoundingClientRect()
  const above = bounds.top >= 220
  mentionStyle.value = {
    left: `${Math.max(8, bounds.left)}px`,
    width: `${Math.min(Math.max(bounds.width, 640), window.innerWidth - Math.max(8, bounds.left) - 8)}px`,
    maxHeight: `${Math.min(288, above ? bounds.top - 16 : window.innerHeight - bounds.bottom - 16)}px`,
    ...(above ? { bottom: `${window.innerHeight - bounds.top + 8}px` } : { top: `${bounds.bottom + 8}px` }),
  }
  const end = input.selectionStart || 0
  mention.value = findComposerCommand(input.value, end)
  mentionIndex.value = 0
}
function removeModel(id: string) {
  draft.value = [...selectedModels.value.filter(model => model.id !== id).map(modelMention), composerText.value].join(' ')
}
function removeSkill(id: string) {
  draft.value = [...selectedSkills.value.filter(skill => skill.id !== id).map(skill => `/${skill.id}`), composerText.value].join(' ')
}
watch(() => props.activeAgentId, () => { mention.value = null })
watch(draft, (text) => {
  const normalized = normalizeComposerSelection(text)
  if (normalized !== text) {
    draft.value = normalized
    return
  }
  if (!text)
    mention.value = null
})
const pinnedToBottom = ref(true)
const historyPanel = ref<{
  load: () => Promise<void>
} | null>(null)
const visibleMessageCount = ref(40)
const presentedMessages = computed(() => presentAgentResults(props.messages, message => messageMedia(message, props.images)))
const visibleMessages = computed(() => presentedMessages.value.slice(-visibleMessageCount.value))
const activeStopMessageId = computed(() =>
  props.images.some(image => image.status === 'generating')
    ? visibleMessages.value.at(-1)?.id
    : undefined,
)
let loadingCachedHistory = false
watch(() => props.sessionId, () => { visibleMessageCount.value = 40 })
const STICKY_THRESHOLD = 96
const scroller = ref<HTMLElement | null>(null)
const transcript = ref<HTMLElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const dragDepth = ref(0)
const draggingFiles = computed(() => dragDepth.value > 0)
let programmaticScroll = false
let lastScrollTop = 0
async function openHistory() {
  if (loadingCachedHistory)
    return
  pinnedToBottom.value = false
  const node = scroller.value
  if (visibleMessageCount.value < presentedMessages.value.length) {
    loadingCachedHistory = true
    const height = node?.scrollHeight || 0
    const top = node?.scrollTop || 0
    visibleMessageCount.value += 40
    await nextTick()
    if (node) {
      node.scrollTop = top + node.scrollHeight - height
      lastScrollTop = node.scrollTop
    }
    loadingCachedHistory = false
    return
  }
  if (props.sessionId)
    await historyPanel.value?.load()
}
function isNearBottom(node: HTMLElement) {
  return node.scrollHeight - node.scrollTop - node.clientHeight <= STICKY_THRESHOLD
}
function onScrollerScroll() {
  const node = scroller.value
  if (!node)
    return
  if (programmaticScroll) {
    lastScrollTop = node.scrollTop
    return
  }
  if (node.scrollTop + 1 < lastScrollTop) {
    pinnedToBottom.value = false
  }
  else {
    pinnedToBottom.value = isNearBottom(node)
  }
  lastScrollTop = node.scrollTop
  if (!pinnedToBottom.value && node.scrollTop <= 120)
    openHistory()
}
function onUserScrollUp() {
  pinnedToBottom.value = false
}
function onScrollerWheel(event: WheelEvent) {
  if (event.deltaY < 0) {
    onUserScrollUp()
    if (scroller.value && scroller.value.scrollTop <= 120)
      openHistory()
  }
}
let touchY = 0
function onScrollerTouchStart(event: TouchEvent) {
  touchY = event.touches[0]?.clientY || 0
}
function onScrollerTouchMove(event: TouchEvent) {
  const nextY = event.touches[0]?.clientY || 0
  if (nextY > touchY) {
    onUserScrollUp()
    if (scroller.value && scroller.value.scrollTop <= 120)
      openHistory()
  }
  touchY = nextY
}
function scrollToBottom() {
  const node = scroller.value
  if (!node)
    return
  programmaticScroll = true
  node.scrollTop = node.scrollHeight
  lastScrollTop = node.scrollTop
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      programmaticScroll = false
    })
  })
}
async function scrollToBottomSoon(force = false) {
  if (!force && !pinnedToBottom.value)
    return
  await nextTick()
  if (!force && !pinnedToBottom.value)
    return
  scrollToBottom()
}
watch(() => [
  props.messages.length,
  props.messages.at(-1)?.role,
  props.messages.at(-1)?.content,
  props.messages.at(-1)?.imageIds?.join(),
  props.messages.at(-1)?.confirmation?.id,
  props.messages.at(-1)?.choice?.id,
  props.images.map(item => `${item.id}:${item.status}:${item.url}`).join(),
  props.status,
  props.error,
  false,
], (next, prev) => {
  const lengthGrew = Array.isArray(next) && Array.isArray(prev) && Number(next[0]) > Number(prev[0] || 0)
  const userSent = lengthGrew && next[1] === 'user'
  if (userSent) {
    pinnedToBottom.value = true
  }
  void scrollToBottomSoon(userSent)
}, { flush: 'post' })
useResizeObserver(transcript, () => {
  if (pinnedToBottom.value)
    scrollToBottom()
})
onMounted(() => {
  pinnedToBottom.value = true
  void scrollToBottomSoon(true)
})
watch(() => props.activeAgentId, (id, previous) => {
  if (!previous || id === previous)
    return
  pinnedToBottom.value = true
  void scrollToBottomSoon(true)
})
const hasReadyAttachment = computed(() => props.attachments.some(item => item.status === 'ready' && item.url))
const hasFailedAttachment = computed(() => props.attachments.some(item => item.status === 'fail'))
const hasGeneratingMedia = computed(() => props.images.some(item => item.status === 'generating'))
const composerLocked = computed(() => props.pending
  || props.status === 'generating'
  || props.status === 'queued'
  || (props.confirmationOpen)
  || props.choiceOpen
  || Boolean(props.deletingAgentId && props.deletingAgentId === props.activeAgentId))
const agentRunning = computed(() => props.pending
  || props.status === 'thinking'
  || props.status === 'calling_tool'
  || props.status === 'generating'
  || props.status === 'queued')
const canStop = computed(() => agentRunning.value && !props.confirmationOpen && !props.choiceOpen)
const canSend = computed(() => {
  // A bare /skill command is an intent, not a request: it needs words, an
  // attachment, or — for sketch to image — something actually drawn.
  const hasRequest = Boolean(composerText.value.trim())
    || hasReadyAttachment.value
    || (sketchSelected.value && sketchDrawn.value)
  return hasRequest
    && !composerLocked.value
    && !props.attaching
    && !hasFailedAttachment.value
})
async function mentionModel(modelId: string) {
  const model = AGENT_MODELS.find(item => item.id === modelId)
  if (!model || composerLocked.value)
    return
  if (!selectedModels.value.some(item => item.id === model.id))
    draft.value = [...selectedModels.value.map(modelMention), modelMention(model), composerText.value].join(' ')
  qualityPreference.value = 'custom'
  mention.value = null
  await nextTick()
  composerElement?.focus({ preventScroll: true })
}
async function mentionSkill(skillId: string) {
  const skill = PUBLIC_AGENT_SKILLS.find(item => item.id === skillId)
  if (!skill || composerLocked.value)
    return
  draft.value = normalizeComposerSelection(`/${skill.id} ${composerText.value}`.trimEnd())
  mention.value = null
  await nextTick()
  const input = composerInput.value?.$el as HTMLTextAreaElement | undefined
  input?.focus({ preventScroll: true })
}
async function mentionTask(task: string) {
  if (composerLocked.value)
    return
  const text = composerText.value.replace(/(?:^|\s)@[^@\n]*$/, '').trimEnd()
  composerText.value = `${text}${text ? ' ' : ''}@${task}`
  mentionColumn.value = 'models'
  await nextTick()
  const input = composerInput.value?.$el as HTMLTextAreaElement | undefined
  if (!input)
    return
  input.focus({ preventScroll: true })
  input.setSelectionRange(input.value.length, input.value.length)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}
defineExpose({ mentionModel, mentionSkill, mentionTask })
async function selectAsset(asset: typeof projectAssets.value[number]) {
  if (!mention.value || composerLocked.value)
    return
  const { start, end } = mention.value
  composerText.value = `${composerText.value.slice(0, start)}${composerText.value.slice(end)}`
  emit('attachAsset', [{ url: asset.url, name: asset.name }])
  mention.value = null
  await nextTick()
  composerElement?.focus()
  composerElement?.setSelectionRange(start, start)
}
async function selectModel(model: AiModelConfig) {
  if (!mention.value || composerLocked.value)
    return
  const { start, end } = mention.value
  const text = `${composerText.value.slice(0, start)}${composerText.value.slice(end)}`
  draft.value = [...selectedModels.value.map(modelMention), modelMention(model), text].join(' ')
  qualityPreference.value = 'custom'
  mention.value = null
  await nextTick()
  composerElement?.focus()
  composerElement?.setSelectionRange(start, start)
}
async function selectSkill(skill: typeof PUBLIC_AGENT_SKILLS[number]) {
  if (!mention.value || composerLocked.value)
    return
  const { start, end } = mention.value
  const text = `${composerText.value.slice(0, start)}${composerText.value.slice(end)}`.trim()
  draft.value = normalizeComposerSelection(`/${skill.id}${text ? ` ${text}` : ''}`)
  mention.value = null
  await nextTick()
  composerElement?.focus()
}
const { open: openMedia } = useMediaLightbox()
function openAttachment(item: PendingAttachment) {
  if (!item.previewUrl && !item.url)
    return
  openMedia({
    url: item.previewUrl || item.url,
    kind: 'image',
    alt: item.name || 'Attached still',
  })
}
const generatingCopy = computed(() => [
  t('chat.workingMedia'),
  t('chat.waitMinute'),
  t('chat.stillGenerating'),
  t('chat.notStuck'),
  t('chat.largeJobs'),
])
const generatingCopyIndex = ref(0)
const { pause: pauseGeneratingCopy, resume: resumeGeneratingCopy } = useIntervalFn(() => {
  generatingCopyIndex.value = (generatingCopyIndex.value + 1) % generatingCopy.value.length
}, 8000, { immediate: false })
watch(() => props.status, (status) => {
  generatingCopyIndex.value = 0
  if (status === 'generating' || status === 'queued' || hasGeneratingMedia.value)
    resumeGeneratingCopy()
  else
    pauseGeneratingCopy()
}, { immediate: true })
watch(hasGeneratingMedia, (busy) => {
  if (busy)
    resumeGeneratingCopy()
  else if (props.status !== 'generating' && props.status !== 'queued')
    pauseGeneratingCopy()
})
const statusLabel = computed(() => {
  const generating = props.status === 'generating' || hasGeneratingMedia.value
  if ((props.confirmationOpen || props.choiceOpen) && props.status !== 'queued' && !generating)
    return ''
  if (props.status === 'queued')
    return props.queueNotice || t('chat.queueWaiting')
  if (generating)
    return generatingCopy.value[generatingCopyIndex.value] || generatingCopy.value[0]
  if (props.status === 'calling_tool')
    return t('chat.callingTools')
  if (props.status === 'thinking' || props.pending)
    return t('chat.thinking')
  return ''
})
const mediaWorking = computed(() => props.status === 'generating' || props.status === 'queued' || hasGeneratingMedia.value)
const latestConfirmedId = computed(() => {
  for (let index = props.messages.length - 1; index >= 0; index--) {
    const message = props.messages[index]
    if (message?.confirmationState === 'confirmed')
      return message.id
  }
  return ''
})
const activeBusy = computed(() => props.pending || (props.status !== 'idle') || hasGeneratingMedia.value)
const prefsLocked = computed(() => activeBusy.value)
const compactComposer = computed(() => activeBusy.value)
const statusInlineVisible = computed(() => {
  if (!statusLabel.value || !latestConfirmedId.value)
    return false
  return mediaWorking.value || props.status === 'generating' || props.status === 'queued'
})
function workingFor(message: AgentChatMessage) {
  return confirmationWorking(message, props.images, mediaWorking.value && message.id === latestConfirmedId.value)
}
function statusInlineFor(message: AgentChatMessage) {
  return statusInlineVisible.value && workingFor(message)
}
function thumbsFor(message: AgentChatMessage & {
  media?: AgentImage[]
}) {
  return message.media || messageMedia(message, props.images)
}
function onPickFiles(event: Event) {
  const input = event.target as HTMLInputElement
  const files = [...(input.files || [])]
  input.value = ''
  if (files.length)
    emit('attach', files)
}
function onComposerPaste(event: ClipboardEvent) {
  const clipboard = event.clipboardData
  if (!clipboard)
    return
  const files = [...clipboard.files]
  if (!files.length) {
    for (const item of clipboard.items) {
      if (item.kind !== 'file')
        continue
      const file = item.getAsFile()
      if (file)
        files.push(file)
    }
  }
  if (!files.length)
    return
    // File pastes use the same validation, previews and upload flow as the picker.
  event.preventDefault()
  if (!composerLocked.value)
    emit('attach', files)
}
function onDragEnter(event: DragEvent) {
  if (event.dataTransfer?.types.includes('Files'))
    dragDepth.value += 1
}
function onDragLeave() {
  dragDepth.value = Math.max(0, dragDepth.value - 1)
}
function onDrop(event: DragEvent) {
  dragDepth.value = 0
  const files = [...(event.dataTransfer?.files || [])]
  if (files.length && !composerLocked.value)
    emit('attach', files)
}
function onDraftKeydown(event: KeyboardEvent) {
  if (mention.value && !event.isComposing) {
    if (event.key === 'Escape') {
      event.preventDefault()
      mention.value = null
      return
    }
    if (mention.value.trigger === '@' && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault()
      mentionColumn.value = event.key === 'ArrowLeft' ? 'models' : 'assets'
      mentionIndex.value = 0
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const count = mentionCount.value
      if (count)
        mentionIndex.value = (mentionIndex.value + (event.key === 'ArrowDown' ? 1 : -1) + count) % count
      nextTick(() => document.getElementById(`${modelListId}-${mention.value?.trigger === '/' ? 'skills' : mentionColumn.value}-${mentionIndex.value}`)?.scrollIntoView({ block: 'nearest' }))
      return
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      const skill = mention.value.trigger === '/' ? skillMatches.value[mentionIndex.value] : undefined
      if (skill) {
        event.preventDefault()
        void selectSkill(skill)
        return
      }
      const asset = mentionColumn.value === 'assets' ? assetMatches.value[mentionIndex.value] : undefined
      if (asset) {
        event.preventDefault()
        void selectAsset(asset)
        return
      }
      const model = mentionColumn.value === 'models' ? modelMatches.value[mentionIndex.value] : undefined
      if (model) {
        event.preventDefault()
        void selectModel(model)
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        return
      }
    }
  }
  if (event.key !== 'Enter' || event.shiftKey || event.repeat || event.isComposing)
    return
  event.preventDefault()
  if (canSend.value)
    void onComposerSubmit()
}
async function onComposerSubmit() {
  if (canStop.value) {
    emit('stop')
    return
  }
  if (!canSend.value)
    return
  if (sketchSelected.value) {
    if (!sketchCanvas.value || sketchExporting.value)
      return
    sketchExporting.value = true
    sketchError.value = ''
    try {
      const sketchFile = await sketchCanvas.value.exportFile()
      emit('send', { sketchFile, sketchName: t('sketch.attachmentName') })
    }
    catch (error) {
      sketchError.value = error instanceof Error ? error.message : t('sketch.exportError')
    }
    finally {
      sketchExporting.value = false
    }
    return
  }
  const points = annotationPoints.value
  const sourceUrl = annotationSource.value?.url
  const annotationEdit = annotationSelected.value
    && sourceUrl
    && points.length
    && points.every(point => point.text.trim())
    && new Set(points.flatMap(point => point.references || []).map(reference => reference.url)).size <= 8
    ? { imageUrl: sourceUrl, points: points.map(point => ({ ...point })) }
    : undefined
  emit('send', annotationEdit ? { annotationEdit } : undefined)
}
function setConfirmPolicy(value: unknown) {
  if (prefsLocked.value)
    return
  const next = Array.isArray(value) ? value[0] : value
  if (next === 'auto' || next === 'when_needed' || next === 'always')
    confirmPolicy.value = next
}
const confirmPolicyLabel = computed(() => {
  if (confirmPolicy.value === 'auto')
    return t('chat.automatic')
  if (confirmPolicy.value === 'when_needed')
    return t('chat.reviewWhenNeeded')
  return t('chat.alwaysReview')
})
const activeTitle = computed(() => props.agents.find(agent => agent.id === props.activeAgentId)?.title || t('chat.newAgent'))
const deleteTargetId = ref('')
const agentMenuOpen = ref(false)
const deleteOpen = computed({
  get: () => Boolean(deleteTargetId.value),
  set: (open: boolean) => {
    if (!open && !props.deletePending)
      deleteTargetId.value = ''
  },
})
const deleteTarget = computed(() => props.agents.find(agent => agent.id === deleteTargetId.value))
const deleteErrorText = computed(() => {
  const key = props.deleteError
  if (!key)
    return ''
  return key.startsWith('chat.') ? t(key) : key
})
function setActiveAgent(id: string) {
  if (id)
    emit('selectAgent', id)
}
function requestDeleteAgent(id: string) {
  if (!id || props.deletePending)
    return
  agentMenuOpen.value = false
  deleteTargetId.value = id
}
function confirmDeleteAgent() {
  if (!deleteTargetId.value || props.deletePending)
    return
  emit('deleteAgent', deleteTargetId.value)
}
watch(() => props.agents, (agents) => {
  if (deleteTargetId.value && !agents.some(agent => agent.id === deleteTargetId.value))
    deleteTargetId.value = ''
})
</script>

<template>
  <section
    class="relative flex min-h-0 flex-col bg-sidebar"
    :class="composerOnly ? undefined : 'h-full'"
    @dragenter.prevent="onDragEnter"
    @dragover.prevent
    @dragleave.prevent="onDragLeave"
    @drop.prevent="onDrop"
  >
    <div v-if="draggingFiles" class="pointer-events-none absolute inset-2 z-50 grid place-items-center rounded-2xl border border-dashed border-primary/50 bg-background/90 backdrop-blur-sm">
      <div class="text-center">
        <Icon name="lucide:image-plus" class="mx-auto size-6 text-primary" />
        <p class="mt-2 text-sm font-medium">
          {{ t('chat.dropImages') }}
        </p>
        <p class="mt-1 text-xs text-muted-foreground">
          {{ t('chat.dropImagesDescription') }}
        </p>
      </div>
    </div>
    <div
      v-if="!composerOnly"
      class="flex items-center justify-between gap-2 border-b border-border px-4 py-3"
    >
      <div class="flex min-w-0 flex-1 items-center gap-1">
        <h2 class="truncate text-sm font-medium tracking-tight">
          {{ activeTitle }}
        </h2>
        <Spinner
          v-if="activeBusy"
          class="size-3.5 shrink-0 text-muted-foreground"
        />
        <DropdownMenu v-model:open="agentMenuOpen" :modal="false">
          <DropdownMenuTrigger as-child>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              class="size-7 shrink-0 rounded-lg"
              :aria-label="t('chat.switchAgent')"
            >
              <ChevronDown class="size-3.5 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" class="min-w-48 max-w-72">
            <div
              v-for="agent in agents"
              :key="agent.id"
              class="group flex h-8 items-center gap-1 rounded-lg px-1 hover:bg-accent"
            >
              <button
                type="button"
                class="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                :disabled="!canSwitchAgent && agent.id !== activeAgentId"
                @click="setActiveAgent(agent.id)"
              >
                <span
                  class="size-1.5 shrink-0 rounded-full"
                  :class="agent.id === activeAgentId ? 'bg-foreground' : 'bg-transparent'"
                />
                <span class="min-w-0 truncate">{{ agent.title }}</span>
                <Spinner
                  v-if="agent.busy"
                  class="size-3.5 shrink-0 text-muted-foreground"
                />
              </button>
              <Button
                v-if="agent.canDelete"
                type="button"
                variant="ghost"
                size="icon-sm"
                class="size-7 shrink-0 rounded-lg text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 hover:text-destructive focus-visible:opacity-100"
                :disabled="!agent.canDelete || deletePending"
                :aria-label="t('chat.deleteAgent')"
                @click.stop="requestDeleteAgent(agent.id)"
                @keydown.enter.stop.prevent="requestDeleteAgent(agent.id)"
                @keydown.space.stop.prevent="requestDeleteAgent(agent.id)"
              >
                <Trash2 class="size-3.5" />
              </Button>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        class="h-8 shrink-0 gap-1 rounded-lg px-2 text-xs font-medium shadow-none"
        :disabled="!canCreateAgent"
        :aria-label="t('chat.newAgent')"
        @click="emit('createAgent')"
      >
        <Plus class="size-3.5" />
        {{ t('common.new') }}
      </Button>
    </div>

    <div
      v-if="!composerOnly && !hideTranscript"
      ref="scroller"
      class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-4 py-4 [overflow-anchor:none]"
      @scroll="onScrollerScroll"
      @wheel="onScrollerWheel"
      @touchstart.passive="onScrollerTouchStart"
      @touchmove.passive="onScrollerTouchMove"
    >
      <div ref="transcript" class="flex flex-col gap-6">
        <AgentLabHistoryPanel
          v-if="sessionId"
          :key="sessionId"
          ref="historyPanel"
          :endpoint="`/api/ai/agent-chats/${encodeURIComponent(sessionId)}/history`"
          :before-id="messages[0]?.id"
          :exclude-ids="messages.map(message => message.id)"
          :scroll-container="scroller"
          embedded
        />
        <AgentLabMessage
          v-for="message in visibleMessages"
          :key="message.id"
          :message="message"
          :images="thumbsFor(message)"
          :has-in-flight-generations="message.id === activeStopMessageId"
        >
          <template v-if="message.confirmation || message.choice || statusInlineFor(message)" #default>
            <AgentLabConfirmCard
              v-if="message.confirmation"
              :confirmation="message.confirmation"
              :state="message.confirmationState"
              :resolved-params="message.resolvedParams"
              :pending="workingFor(message) && pending"
              :working="workingFor(message)"
              @confirm="emit('confirm', $event)"
              @cancel="emit('cancel')"
            />

            <AgentLabChoiceCard
              v-if="message.choice"
              :choice="message.choice"
              :state="message.choiceState"
              :answers="message.choiceAnswers"
              :pending="pending && !choiceOpen"
              :source-images="annotationSourceImages(message)"
              :reference-images="annotationReferenceImages"
              :upload-image="uploadAnnotationImage"
              @submit="emit('submitChoice', $event)"
              @skip="emit('skipChoice')"
              @browse-assets="emit('browseAssets')"
            />

            <p
              v-if="statusInlineFor(message)"
              class="flex items-center gap-2 text-xs text-muted-foreground"
              aria-live="polite"
            >
              <Spinner />
              {{ statusLabel }}
            </p>
          </template>
        </AgentLabMessage>

        <p
          v-if="statusLabel && !statusInlineVisible"
          class="flex items-center gap-2 border-t border-border pt-2 text-xs text-muted-foreground"
          aria-live="polite"
        >
          <Spinner />
          {{ statusLabel }}
        </p>
        <p v-if="error" class="text-xs text-destructive">
          {{ error }}
        </p>
      </div>
    </div>

    <p
      v-if="(composerOnly || hideTranscript) && statusLabel"
      class="flex items-center gap-2 px-3 pt-3 text-xs text-muted-foreground"
      aria-live="polite"
    >
      <Spinner />
      {{ statusLabel }}
    </p>
    <p
      v-if="(composerOnly || hideTranscript) && error"
      class="px-3 pt-3 text-xs text-destructive"
    >
      {{ error }}
    </p>

    <form
      class="p-3"
      :class="composerOnly || hideTranscript ? undefined : 'border-t border-border'"
      @submit.prevent="onComposerSubmit"
      @paste="onComposerPaste"
    >
      <template v-if="sketchSelected">
        <ToolsSketchCanvas
          ref="sketchCanvas"
          v-model="sketchElements"
          class="mb-3"
          :disabled="composerLocked || sketchExporting"
        />
        <p v-if="sketchError" role="alert" class="mb-2 text-xs text-destructive">
          {{ sketchError }}
        </p>
      </template>
      <template v-else-if="annotationSelected">
        <ToolsImageAnnotationEditor
          v-if="annotationSource?.url"
          :key="annotationSource.url"
          v-model="annotationPoints"
          class="mb-3"
          :src="annotationSource.url"
          :disabled="composerLocked"
          :reference-images="annotationReferenceImages"
          :upload-image="uploadAnnotationImage"
          @browse-assets="emit('browseAssets')"
        />
        <p v-else role="status" class="mb-3 text-sm text-muted-foreground">
          {{ t('annotation.missingSource') }}
        </p>
      </template>
      <div v-if="attachments.length" class="mb-2 flex flex-wrap gap-2">
        <div
          v-for="item in attachments"
          :key="item.id"
          class="relative overflow-hidden rounded-xl border border-border"
        >
          <button
            type="button"
            class="block size-14 overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            :aria-label="t('chat.viewAttachment', { name: item.name })"
            @click="openAttachment(item)"
          >
            <img
              :src="item.previewUrl"
              :alt="item.name"
              class="size-14 object-cover"
            >
          </button>
          <div
            v-if="item.status !== 'ready'"
            class="absolute inset-0 flex items-center justify-center bg-background/70"
          >
            <Spinner v-if="item.status === 'uploading'" class="size-4" />
            <span v-else class="px-1 text-center text-[10px] text-destructive">
              {{ t('chat.failed') }}
            </span>
          </div>
          <button
            type="button"
            class="absolute top-1 right-1 flex size-5 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            :aria-label="t('chat.removeAttachment', { name: item.name })"
            @click="emit('removeAttachment', item.id)"
          >
            <X class="size-3" />
          </button>
        </div>
      </div>
      <InputGroup class="rounded-xl bg-input/30 shadow-none">
        <Teleport to="body">
          <div
            v-if="mention && !composerLocked"
            :id="modelListId"
            role="listbox"
            :aria-label="mention.trigger === '/' ? t('skills.choose') : t('chat.chooseModelAsset')"
            class="fixed z-[100] flex flex-col overflow-hidden rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-lg"
            :style="mentionStyle"
            @mousedown.prevent
          >
            <p class="hidden px-3 py-2 text-xs text-muted-foreground md:block">
              {{ mention.trigger === '/' ? t('skills.keyboardHelp') : t('chat.keyboardHelp') }}
            </p>
            <div v-if="mention.trigger === '/'" class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <p class="sticky top-0 z-10 bg-popover px-3 py-2 text-xs font-semibold">
                {{ t('skills.title') }}
              </p>
              <button
                v-for="(skill, index) in skillMatches"
                :id="`${modelListId}-skills-${index}`"
                :key="skill.id"
                type="button"
                role="option"
                :aria-selected="index === mentionIndex"
                class="flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                :class="index === mentionIndex ? 'bg-accent text-accent-foreground' : ''"
                @click="selectSkill(skill)"
              >
                <Icon :name="skill.icon" class="mt-0.5 size-5 shrink-0 text-primary" />
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm font-medium">{{ t(`skills.items.${skill.id}.name`) }}</span>
                  <span class="block text-xs text-muted-foreground">{{ t(`skills.items.${skill.id}.description`) }}</span>
                </span>
                <code class="shrink-0 text-[10px] text-muted-foreground">/{{ skill.id }}</code>
              </button>
              <p v-if="!skillMatches.length" class="px-3 py-4 text-sm text-muted-foreground" role="status">
                {{ t('skills.empty') }}
              </p>
            </div>
            <div v-else class="grid min-h-0 flex-1 grid-cols-2 divide-x divide-border">
              <div role="group" :aria-label="t('chat.models')" class="min-w-0 overflow-y-auto overscroll-contain">
                <p class="sticky top-0 z-10 bg-popover px-3 py-2 text-xs font-semibold">
                  {{ t('chat.models') }}
                </p>
                <button
                  v-for="(model, index) in modelMatches"
                  :id="`${modelListId}-models-${index}`"
                  :key="model.id"
                  type="button"
                  role="option"
                  :aria-selected="mentionColumn === 'models' && index === mentionIndex"
                  class="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                  :class="mentionColumn === 'models' && index === mentionIndex ? 'bg-accent text-accent-foreground' : ''"
                  @click="selectModel(model)"
                >
                  <img v-if="agentModelLogo(model)" :src="agentModelLogo(model)" alt="" class="h-6 w-auto max-w-14 shrink-0 object-contain">
                  <Icon v-else :name="model.icon || 'lucide:box'" class="size-6 shrink-0" />
                  <span class="min-w-0 flex-1"><span class="block truncate text-sm font-medium">{{ model.name }}</span><span class="block text-xs text-muted-foreground">{{ model.task }}</span></span>
                </button>
                <p v-if="!modelMatches.length" class="px-3 py-4 text-sm text-muted-foreground" role="status">
                  {{ t('chat.noMatchingModels') }}
                </p>
              </div>
              <div role="group" :aria-label="t('chat.projectAssets')" class="min-w-0 overflow-y-auto overscroll-contain">
                <p class="sticky top-0 z-10 bg-popover px-3 py-2 text-xs font-semibold">
                  {{ t('chat.projectAssets') }} · {{ projectAssets.length }}
                </p>
                <button
                  v-for="(asset, index) in assetMatches" :id="`${modelListId}-assets-${index}`" :key="asset.id"
                  type="button" role="option" :aria-selected="mentionColumn === 'assets' && index === mentionIndex"
                  class="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-accent"
                  :class="mentionColumn === 'assets' && index === mentionIndex ? 'bg-accent text-accent-foreground' : ''"
                  @click="selectAsset(asset)"
                >
                  <Icon v-if="asset.video" name="lucide:clapperboard" class="size-9 shrink-0" />
                  <img v-else :src="asset.url" alt="" loading="lazy" class="size-9 shrink-0 rounded object-contain">
                  <span class="min-w-0"><span class="block truncate text-sm font-medium" :title="asset.name">{{ asset.name }}</span><span class="block text-xs text-muted-foreground">{{ asset.video ? t('common.video') : t('common.image') }}</span></span>
                </button>
                <p v-if="projectAssetsLoading" class="px-3 py-2 text-xs text-muted-foreground" role="status">
                  {{ t('chat.loadingAssets') }}
                </p>
                <p v-else-if="projectAssetsError" class="px-3 py-2 text-xs text-destructive" role="status">
                  {{ projectAssetsError }}
                </p>
                <p v-else-if="!assetMatches.length" class="px-3 py-4 text-sm text-muted-foreground" role="status">
                  {{ projectAssets.length ? t('chat.noMatchingAssets') : t('chat.noProjectAssets') }}
                </p>
              </div>
            </div>
          </div>
        </Teleport>
        <div v-if="selectedModels.length || selectedSkills.length" class="flex w-full flex-wrap gap-1.5 px-3 pt-3">
          <AgentLabModelBadge v-for="model in selectedModels" :key="model.id" :model="model" removable :disabled="composerLocked" @remove="removeModel(model.id)" />
          <AgentLabSkillBadge v-for="skill in selectedSkills" :key="skill.id" :skill="skill" removable :disabled="composerLocked" @remove="removeSkill(skill.id)" />
        </div>
        <InputGroupTextarea
          ref="composerInput"
          v-model="composerText"
          :disabled="composerLocked"
          class="overflow-y-auto overscroll-contain rounded-xl [field-sizing:fixed] touch-pan-y"
          :class="compactComposer
            ? 'max-md:max-h-10 max-md:min-h-10 max-md:py-2 md:max-h-[min(40vh,20rem)] md:min-h-[88px]'
            : 'max-h-[min(40vh,20rem)] min-h-[88px]'"
          :placeholder="annotationSelected ? t('annotation.composerHint') : selectedSkills.length ? (composerPlaceholderForSkills(selectedSkills) || t('chat.composerNext')) : selectedModels.length ? t('chat.composerNext') : t('chat.composerPlaceholder', { mention: '@ /' })"
          :aria-label="t('chat.messageLabel')"
          :aria-expanded="Boolean(mention)"
          :aria-controls="mention ? modelListId : undefined"
          :aria-activedescendant="activeMentionId"
          @input="updateMention"
          @click="updateMention"
          @keyup.left="!mention && updateMention($event)"
          @keyup.right="!mention && updateMention($event)"
          @blur="mention = null"
          @keydown="onDraftKeydown"
        />
        <InputGroupAddon
          align="block-end"
          class="border-t border-border/80"
          :class="compactComposer && 'max-md:py-1'"
        >
          <input
            ref="fileInput"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            multiple
            class="sr-only"
            @change="onPickFiles"
          >
          <InputGroupButton
            type="button"
            variant="ghost"
            size="icon-sm"
            class="rounded-lg"
            :disabled="composerLocked"
            :aria-label="t('chat.attachImage')"
            @click="fileInput?.click()"
          >
            <Paperclip />
          </InputGroupButton>
          <div class="ms-auto flex min-w-0 items-center gap-2">
            <DropdownMenu :modal="false">
              <DropdownMenuTrigger as-child>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  class="h-8 max-w-full gap-1 rounded-lg px-2 text-xs font-medium shadow-none"
                  :disabled="prefsLocked"
                  :aria-label="t('chat.generationApproval')"
                >
                  <span class="truncate">{{ confirmPolicyLabel }}</span>
                  <ChevronDown class="size-3.5 shrink-0 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" class="min-w-72">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>
                    {{ t('chat.generationApproval') }}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuRadioGroup
                    :model-value="confirmPolicy"
                    @update:model-value="setConfirmPolicy"
                  >
                    <DropdownMenuRadioItem value="auto" class="items-start">
                      <span class="flex flex-col gap-0.5">
                        <span>{{ t('chat.automatic') }}</span>
                        <span class="text-xs font-normal text-muted-foreground">
                          {{ t('chat.automaticDescription') }}
                        </span>
                      </span>
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="when_needed" class="items-start">
                      <span class="flex flex-col gap-0.5">
                        <span>{{ t('chat.reviewWhenNeeded') }}</span>
                        <span class="text-xs font-normal text-muted-foreground">
                          {{ t('chat.reviewDescription') }}
                        </span>
                      </span>
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="always" class="items-start">
                      <span class="flex flex-col gap-0.5">
                        <span>{{ t('chat.alwaysReview') }}</span>
                        <span class="text-xs font-normal text-muted-foreground">
                          {{ t('chat.alwaysReviewDescription') }}
                        </span>
                      </span>
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <KbdGroup
              v-if="!canStop"
              class="hidden md:inline-flex"
              :aria-label="t('chat.enterSend')"
            >
              <Kbd>Enter</Kbd>
            </KbdGroup>
            <InputGroupButton
              v-if="canStop"
              type="submit"
              variant="default"
              size="sm"
              class="rounded-lg"
              :disabled="stopping"
              :aria-label="t('chat.stopAgent')"
            >
              <Square class="size-3.5 fill-current" data-icon="inline-start" />
              {{ t('chat.stop') }}
            </InputGroupButton>
            <InputGroupButton
              v-else
              type="submit"
              variant="default"
              size="sm"
              class="rounded-lg"
              :disabled="!canSend"
              aria-keyshortcuts="Enter"
            >
              <ArrowUp data-icon="inline-start" />
              {{ t('chat.send') }}
            </InputGroupButton>
          </div>
        </InputGroupAddon>
      </InputGroup>
    </form>
    <AgentLabDeleteDialog
      v-model:open="deleteOpen"
      :pending="deletePending"
      :error="deleteErrorText"
      :busy="Boolean(deleteTarget?.busy)"
      @confirm="confirmDeleteAgent"
    />
  </section>
</template>
