<script setup lang="ts">
import type { GenerationJobPublic, GenerationJobsList } from '~~/shared/types/generation'
import type { GenerationProjectPublic } from '~~/shared/types/project'
import type { ConfirmationPayload } from '~/composables/useAgentLab'
import type { CanvasDeleteTarget } from '~/utils/infiniteCanvas'
import { ArrowLeft, Check, Pencil, X } from 'lucide-vue-next'
import { FetchError } from 'ofetch'
import { toast } from 'vue-sonner'
import { isGenerationActive } from '~~/shared/types/generation'
import { PROJECT_NAME_MAX } from '~~/shared/types/project'
import { PUBLIC_AGENT_SKILLS } from '~~/shared/utils/agentSkills'
import { readErrorMessage } from '~~/shared/utils/apiError'
import ProjectMoveJobDialog from '@/components/projects/ProjectMoveJobDialog.vue'
import { canvasMediaNavigationKey } from '~/composables/useCanvasMediaNavigation'

const canvas = ref<{
  focusMedia: (url: string) => Promise<boolean>
} | null>(null)
provide(canvasMediaNavigationKey, async (url) => {
  if (!await canvas.value?.focusMedia(url))
    toast.error('This file is no longer available on the canvas.')
})
definePageMeta({
  layout: 'studio',
})
const PAGE_SIZE = 50
const POLL_MS = 3000
const { public: publicConfig } = useRuntimeConfig()
const { t } = useI18n()
const localePath = useLocalePath()
const { projects, selectedProjectId, loaded, loadFailed, loadProjects, isRemovedProject, markProjectRemoved, leaveRemovedProject } = useProjects()
const route = useRoute()
const router = useRouter()
const nuxtApp = useNuxtApp()
const projectId = computed(() => String(route.params.id || ''))
const agentChat = ref<{ mentionSkill: (skillId: string) => Promise<void> } | null>(null)
const { sessionId: agentSessionId, messages, images, allImages, status, waitingForUserConfirm, waitingForUserChoice, pending: agentPending, draft, attachments, attaching, error: agentError, sendMessage, stopAgent, stopping, attachFiles, uploadAnnotationImage, attachUrls, removeAttachment, removeCanvasImages, removeCanvasResult, sessionIdsForImages, resolveConfirmation, resolveChoice, qualityPreference, confirmPolicy, agents, activeAgentId, canCreateAgent, canSwitchAgent, createAgent, selectAgent, deleteAgent, deletingAgentId, deleteError, queueNotice, applyCanvasJobs, ensureHydrated } = useAgentLab({
  projectId,
  onJobs(jobs) {
    for (const job of jobs)
      onJobCreated(job)
  },
})
const project = ref<GenerationProjectPublic | null>(null)
const items = ref<GenerationJobPublic[]>([])
const total = ref(0)
const loading = ref(false)
const deletingResultKey = ref<string | null>(null)
const deleteConfirmOpen = ref(false)
const pendingDeleteTarget = ref<CanvasDeleteTarget | null>(null)
const moveOpen = ref(false)
const movingTaskId = ref<string | null>(null)
const pendingMoveTaskId = ref('')
const otherProjects = computed(() => projects.value.filter(item => item.id && item.id !== projectId.value))
let loadToken = 0
let jobsController: AbortController | undefined
let jobsInFlight = false
const title = computed(() => project.value?.name || t('projects.title'))
const description = computed(() => project.value?.description || '')
const canRename = computed(() => Boolean(project.value && !project.value.isDefault))
const renaming = ref(false)
const renameDraft = ref('')
const renamingSaving = ref(false)
const renameInputRef = ref<{
  $el?: HTMLInputElement
} | null>(null)
useSeoMeta({
  title: computed(() => `${title.value} · ${publicConfig.brandName}`),
  description: computed(() => t('seo.projectsDescription')),
})
async function loadProject() {
  const id = projectId.value
  if (!id || isRemovedProject(id))
    return
  await loadProjects()
  if (projectId.value !== id)
    return
  if (isRemovedProject(id) || (loaded.value && !loadFailed.value && !projects.value.some(item => item.id === id))) {
    await leaveRemovedProject(id)
    return
  }
  try {
    project.value = await $fetch<GenerationProjectPublic>(`/api/projects/${id}`)
    selectedProjectId.value = project.value.id
  }
  catch (error) {
    const status = Number((error as { statusCode?: unknown, status?: unknown })?.statusCode
      || (error as { status?: unknown })?.status
      || 0)
    if (status === 404) {
      markProjectRemoved(id)
      await leaveRemovedProject(id)
      return
    }
    toast.error(readErrorMessage(error, t('projects.loadFailedTitle')))
    await nuxtApp.runWithContext(() => navigateTo(localePath('/projects')))
  }
}
async function loadJobs(silent = false) {
  if (silent && jobsInFlight)
    return
  if (!projectId.value) {
    jobsController?.abort()
    loadToken++
    items.value = []
    total.value = 0
    return
  }
  jobsController?.abort()
  const controller = new AbortController()
  jobsController = controller
  jobsInFlight = true
  const token = ++loadToken
  if (!silent)
    loading.value = true
  try {
    const loaded = new Map<string, GenerationJobPublic>()
    const initialIds = new Set(items.value.map(job => job.taskId))
    const requestedProjectId = projectId.value
    let batch = 1
    let expected = 0
    do {
      const data = await $fetch<GenerationJobsList>('/api/ai/jobs', {
        signal: controller.signal,
        timeout: 20000,
        query: { page: batch, limit: PAGE_SIZE, projectId: requestedProjectId },
      })
      if (token !== loadToken || requestedProjectId !== projectId.value)
        return
      expected = data.total
      for (const job of data.items.filter(job => jobBelongsToCurrentProject(job)))
        loaded.set(job.taskId, job)
      // Show each batch immediately, preserving older assets until the scan finishes.
      const current = new Map(items.value.map(job => [job.taskId, job]))
      for (const [id, job] of loaded)
        current.set(id, job)
      items.value = [...current.values()]
      total.value = expected
      if (!data.items.length)
        break
      batch++
    } while ((batch - 1) * PAGE_SIZE < expected)
    if (token === loadToken) {
      // Keep new local results created while this scan was in flight.
      for (const job of items.value) {
        if (!initialIds.has(job.taskId) && !loaded.has(job.taskId))
          loaded.set(job.taskId, job)
      }
      items.value = [...loaded.values()]
    }
  }
  catch (error) {
    if (!silent && !controller.signal.aborted)
      toast.error(error instanceof Error ? error.message : 'Could not load generations')
  }
  finally {
    if (token === loadToken) {
      jobsInFlight = false
      loading.value = false
    }
  }
}
function jobBelongsToCurrentProject(job: GenerationJobPublic) {
  const id = String(job.projectId || '')
  if (id === projectId.value)
    return true
  if (id)
    return false
  return !project.value || Boolean(project.value.isDefault)
}
function onJobCreated(job: GenerationJobPublic) {
  if (!jobBelongsToCurrentProject(job))
    return
  const exists = items.value.some(item => item.taskId === job.taskId)
  items.value = [job, ...items.value.filter(item => item.taskId !== job.taskId)]
  if (!exists)
    total.value += 1
}
const bulkAction = ref<'move' | 'delete' | null>(null)
const bulkTaskIds = ref<string[]>([])
const bulkDeleteTargets = ref<CanvasDeleteTarget[]>([])
const bulkPending = ref(false)
const bulkCount = computed(() => bulkAction.value === 'delete' ? bulkDeleteTargets.value.length : bulkTaskIds.value.length)
function deleteTargetKey(target: CanvasDeleteTarget) {
  return target.taskId || (target.imageId ? `image:${target.imageId}` : '')
}
function requestBulkMove(ids: string[]) {
  if (bulkPending.value)
    return
  bulkTaskIds.value = [...new Set(ids)]
  bulkAction.value = 'move'
}
function requestBulkDelete(targets: CanvasDeleteTarget[]) {
  if (bulkPending.value)
    return
  bulkDeleteTargets.value = [...new Map(targets.map(target => [deleteTargetKey(target), target])).values()]
    .filter(target => deleteTargetKey(target))
  if (bulkDeleteTargets.value.length)
    bulkAction.value = 'delete'
}
function imageIdsForTarget(target: CanvasDeleteTarget) {
  const urls = new Set(target.taskId
    ? items.value.find(job => job.taskId === target.taskId)?.resultUrls || []
    : [])
  const seen = new Set<string>()
  const ids: string[] = []
  for (const image of [...images.value, ...allImages.value]) {
    const id = String(image.id || '').trim()
    if (!id || seen.has(id))
      continue
    if (image.id === target.imageId
      || (target.taskId && `agent_${image.id}`.slice(0, 120) === target.taskId)
      || (target.taskId && image.providerTaskId === target.taskId)
      || (image.url && urls.has(image.url))) {
      seen.add(id)
      ids.push(id)
    }
  }
  if (target.imageId && !seen.has(target.imageId))
    ids.push(target.imageId)
  return ids
}
async function deleteSessionImages(imageIds: string[]) {
  const sessions = new Set([
    ...sessionIdsForImages(imageIds),
    ...(agentSessionId.value ? [agentSessionId.value] : []),
  ])
  for (const imageId of imageIds) {
    for (const sessionId of sessions) {
      try {
        await $fetch(`/api/agent/v1/sessions/${encodeURIComponent(sessionId)}/images/${encodeURIComponent(imageId)}`, {
          method: 'DELETE',
          query: { allowGenerating: '1' },
        })
      }
      catch (error) {
        if (!(error instanceof FetchError) || (error.statusCode !== 404 && error.statusCode !== 409))
          throw error
      }
    }
  }
}
async function deleteCanvasResult(target: CanvasDeleteTarget) {
  if (target.taskId) {
    try {
      await $fetch(`/api/ai/jobs/${encodeURIComponent(target.taskId)}`, { method: 'DELETE' })
    }
    catch (error) {
      if (!(error instanceof FetchError) || error.statusCode !== 404)
        throw error
    }
  }
  const imageIds = imageIdsForTarget(target)
  if (imageIds.length)
    await deleteSessionImages(imageIds)
  if (imageIds.length)
    await removeCanvasImages(imageIds)
  else if (target.taskId)
    await removeCanvasResult(target.taskId)
  if (target.taskId) {
    items.value = items.value.filter(job => job.taskId !== target.taskId)
    total.value = Math.max(0, total.value - 1)
  }
}
async function confirmBulk(targetProjectId?: string) {
  if (bulkPending.value || !bulkAction.value)
    return
  const action = bulkAction.value
  if (action === 'move' && !targetProjectId)
    return
  bulkPending.value = true
  if (action === 'move') {
    const failed: string[] = []
    for (const taskId of bulkTaskIds.value) {
      try {
        await $fetch(`/api/ai/jobs/${taskId}`, { method: 'PATCH', body: { projectId: targetProjectId } })
        await removeCanvasResult(taskId, items.value.find(job => job.taskId === taskId)?.resultUrls || [])
        items.value = items.value.filter(job => job.taskId !== taskId)
        total.value = Math.max(0, total.value - 1)
      }
      catch {
        failed.push(taskId)
      }
    }
    bulkTaskIds.value = failed
  }
  else {
    const failed: CanvasDeleteTarget[] = []
    for (const target of bulkDeleteTargets.value) {
      try {
        await deleteCanvasResult(target)
      }
      catch {
        failed.push(target)
      }
    }
    bulkDeleteTargets.value = failed
  }
  bulkPending.value = false
  const failedCount = action === 'move' ? bulkTaskIds.value.length : bulkDeleteTargets.value.length
  if (failedCount)
    toast.error(`${failedCount} results could not be ${action === 'move' ? 'moved' : 'deleted'}. Retry to process only these results.`)
  else
    bulkAction.value = null
  const refreshed = await Promise.allSettled([loadJobs(true), loadProjects()])
  if (refreshed.some(result => result.status === 'rejected'))
    toast.error('Could not refresh the project. Reload to see the latest results.')
}
function requestDelete(target: CanvasDeleteTarget) {
  const job = target.taskId ? items.value.find(item => item.taskId === target.taskId) : undefined
  if (job && isGenerationActive(job.state))
    return
  pendingDeleteTarget.value = target
  deleteConfirmOpen.value = true
}
function requestMove(taskId: string) {
  if (!otherProjects.value.length)
    return
  pendingMoveTaskId.value = taskId
  moveOpen.value = true
}
async function confirmMove(targetProjectId: string) {
  const taskId = pendingMoveTaskId.value
  if (!taskId || movingTaskId.value || !targetProjectId)
    return
  movingTaskId.value = taskId
  try {
    await $fetch(`/api/ai/jobs/${taskId}`, {
      method: 'PATCH',
      body: { projectId: targetProjectId },
    })
    await removeCanvasResult(taskId, items.value.find(job => job.taskId === taskId)?.resultUrls || [])
    items.value = items.value.filter(job => job.taskId !== taskId)
    total.value = Math.max(0, total.value - 1)
    moveOpen.value = false
    pendingMoveTaskId.value = ''
    await Promise.all([loadJobs(true), loadProjects()])
  }
  catch (error) {
    toast.error(error instanceof Error ? error.message : 'Could not move this result')
  }
  finally {
    movingTaskId.value = null
  }
}
async function confirmDelete() {
  const target = pendingDeleteTarget.value
  const key = target ? deleteTargetKey(target) : ''
  if (!target || !key || deletingResultKey.value)
    return
  deletingResultKey.value = key
  try {
    await deleteCanvasResult(target)
    deleteConfirmOpen.value = false
    pendingDeleteTarget.value = null
    if (items.value.length === 0)
      await loadJobs()
  }
  catch (error) {
    toast.error(readErrorMessage(error, 'Could not delete this result'))
  }
  finally {
    deletingResultKey.value = null
  }
}
function focusRenameInput() {
  nextTick(() => {
    const input = renameInputRef.value?.$el
    input?.focus()
    input?.select()
  })
}
function startRename() {
  if (!canRename.value || !project.value || renamingSaving.value)
    return
  renameDraft.value = project.value.name
  renaming.value = true
  focusRenameInput()
}
function cancelRename() {
  if (renamingSaving.value)
    return
  renaming.value = false
  renameDraft.value = ''
}
function onRenameInputFocus(event: FocusEvent) {
  const target = event.target
  if (target instanceof HTMLInputElement)
    target.select()
}
async function saveRename() {
  if (!project.value || renamingSaving.value || !canRename.value)
    return
  const name = renameDraft.value.trim()
  if (!name) {
    toast.error(t('projects.titleRequired'))
    focusRenameInput()
    return
  }
  if (name === project.value.name) {
    renaming.value = false
    return
  }
  renamingSaving.value = true
  try {
    const updated = await $fetch<GenerationProjectPublic>(`/api/projects/${project.value.id}`, {
      method: 'PATCH',
      body: {
        name,
        description: project.value.description,
      },
    })
    project.value = { ...project.value, ...updated }
    projects.value = projects.value.map(item => item.id === updated.id ? { ...item, ...updated } : item)
    renaming.value = false
  }
  catch (error) {
    toast.error(readErrorMessage(error, 'Could not rename the project'))
    focusRenameInput()
  }
  finally {
    renamingSaving.value = false
  }
}
onMounted(() => {
  void loadProject()
  void loadJobs()
  void consumeAgentSkill()
})
onBeforeUnmount(() => {
  loadToken++
  jobsController?.abort()
})
watch(projectId, () => {
  items.value = []
  renaming.value = false
  renameDraft.value = ''
  void loadProject()
  void loadJobs()
})
let consumedAgentSkill = ''
let consumingAgentSkill = false
async function consumeAgentSkill() {
  const skillId = typeof route.query.agentSkill === 'string' ? route.query.agentSkill : ''
  if (consumingAgentSkill || !skillId || consumedAgentSkill === skillId || !PUBLIC_AGENT_SKILLS.some(skill => skill.id === skillId) || !agentChat.value)
    return
  consumingAgentSkill = true
  try {
    await ensureHydrated()
    if (!canCreateAgent.value || typeof route.query.agentSkill !== 'string')
      return
    consumedAgentSkill = skillId
    createAgent()
    await nextTick()
    await agentChat.value.mentionSkill(skillId)
    const query = { ...route.query }
    delete query.agentSkill
    await router.replace({ query })
  }
  finally {
    consumingAgentSkill = false
  }
}
watch([canCreateAgent, () => route.query.agentSkill, agentChat], () => {
  void consumeAgentSkill()
}, { flush: 'post' })
watch(() => isRemovedProject(projectId.value), (removed) => {
  if (removed)
    void leaveRemovedProject(projectId.value)
})
useIntervalFn(() => {
  if (import.meta.server)
    return
  if (document.visibilityState !== 'visible') {
    return
  }
  void loadJobs(true)
}, POLL_MS)
watch(items, (jobs) => {
  applyCanvasJobs(jobs)
}, { immediate: true, deep: true })
async function onConfirm(params: ConfirmationPayload['params']) {
  await resolveConfirmation('confirm', params)
}
function onAttachCanvas(payload: {
  urls: string[]
  prompt: string
}) {
  attachUrls(payload.urls.map(url => ({
    url,
    name: payload.prompt.trim() || 'Canvas still',
  })))
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
    <header class="flex h-[54px] shrink-0 items-center justify-between border-b border-border px-4">
      <div class="flex min-w-0 items-center gap-3">
        <Button as-child variant="ghost" size="sm" class="rounded-lg">
          <NuxtLink :to="localePath('/projects')">
            <ArrowLeft data-icon="inline-start" />
            {{ t('projects.back') }}
          </NuxtLink>
        </Button>
        <Separator orientation="vertical" class="h-5" />
        <form
          v-if="renaming"
          class="flex min-w-0 flex-1 items-center gap-1"
          @submit.prevent="saveRename"
        >
          <Input
            ref="renameInputRef"
            v-model="renameDraft"
            :maxlength="PROJECT_NAME_MAX"
            :disabled="renamingSaving"
            required
            :aria-label="t('projects.projectName')"
            class="h-8 min-w-0 max-w-64 flex-1 rounded-lg bg-input/30 shadow-none"
            @focus="onRenameInputFocus"
            @keydown.esc.prevent="cancelRename"
          />
          <Button
            type="submit"
            size="icon-sm"
            class="size-7 shrink-0 rounded-lg shadow-none"
            :disabled="renamingSaving || !renameDraft.trim()"
            :aria-label="t('projects.saveName')"
          >
            <Check class="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            class="size-7 shrink-0 rounded-lg"
            :disabled="renamingSaving"
            :aria-label="t('projects.cancelRename')"
            @click="cancelRename"
          >
            <X class="size-3.5" />
          </Button>
        </form>
        <div
          v-else
          class="flex min-w-0 items-center gap-1"
        >
          <div class="min-w-0">
            <h1 class="truncate text-sm font-medium tracking-tight">
              {{ title }}
            </h1>
            <p
              v-if="description"
              class="truncate text-[11px] text-muted-foreground"
            >
              {{ description }}
            </p>
          </div>
          <Button
            v-if="canRename"
            type="button"
            variant="ghost"
            size="icon-sm"
            class="size-7 shrink-0 rounded-lg text-muted-foreground"
            :title="t('projects.rename')"
            :aria-label="t('projects.rename')"
            @click="startRename"
          >
            <Pencil class="size-3.5" />
          </Button>
        </div>
      </div>
      <ServiceConnection />
    </header>

    <StudioSplit :key="projectId" :storage-key="`miao-studio-split:${projectId}`">
      <template #left>
        <section
          class="relative isolate flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background"
          :aria-label="t('canvas.label')"
        >
          <AgentLabInfiniteCanvas
            ref="canvas"
            :key="projectId"
            :project-id="projectId"
            :jobs="items"
            :images="allImages"
            :loading="loading"
            :deleting-result-key="deletingResultKey"
            :show-move="otherProjects.length > 0"
            show-attach
            @delete="requestDelete"
            @delete-many="requestBulkDelete"
            @move-many="requestBulkMove"
            @move="requestMove"
            @attach="onAttachCanvas"
          />
        </section>
      </template>

      <template #right>
        <AgentLabChat
          ref="agentChat"
          v-model:draft="draft"
          v-model:quality-preference="qualityPreference"
          v-model:confirm-policy="confirmPolicy"
          class="h-full"
          :messages="messages"
          :session-id="agentSessionId"
          :images="allImages"
          :project-jobs="items"
          :attachments="attachments"
          :status="status"
          :pending="agentPending"
          :attaching="attaching"
          :stopping="stopping"
          :error="agentError"
          :confirmation-open="waitingForUserConfirm"
          :choice-open="waitingForUserChoice"
          :queue-notice="queueNotice"
          :agents="agents"
          :active-agent-id="activeAgentId"
          :can-create-agent="canCreateAgent"
          :can-switch-agent="canSwitchAgent"
          :deleting-agent-id="deletingAgentId"
          :delete-pending="Boolean(deletingAgentId)"
          :delete-error="deleteError"
          :upload-annotation-image="uploadAnnotationImage"
          @send="sendMessage"
          @stop="stopAgent"
          @attach="attachFiles"
          @attach-asset="attachUrls"
          @remove-attachment="removeAttachment"
          @confirm="onConfirm"
          @cancel="resolveConfirmation('cancel')"
          @submit-choice="resolveChoice('submit', $event)"
          @skip-choice="resolveChoice('skip')"
          @create-agent="createAgent"
          @select-agent="selectAgent"
          @delete-agent="deleteAgent"
        />
      </template>
    </StudioSplit>

    <AiGeneratorDeleteDialog :open="bulkAction === 'delete'" :count="bulkCount" :pending="bulkPending" @update:open="!$event && (bulkAction = null)" @confirm="confirmBulk()" />
    <ProjectMoveJobDialog :open="bulkAction === 'move'" :count="bulkTaskIds.length" :pending="bulkPending" :projects="otherProjects" @update:open="!$event && (bulkAction = null)" @confirm="confirmBulk" />
    <AiGeneratorDeleteDialog
      :open="deleteConfirmOpen"
      :pending="Boolean(deletingResultKey)"
      @update:open="deleteConfirmOpen = $event"
      @confirm="confirmDelete"
    />

    <ProjectMoveJobDialog
      :open="moveOpen"
      :pending="Boolean(movingTaskId)"
      :projects="otherProjects"
      @update:open="moveOpen = $event"
      @confirm="confirmMove"
    />
  </div>
</template>
