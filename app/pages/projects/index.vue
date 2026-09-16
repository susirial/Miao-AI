<script setup lang="ts">
import type { GenerationProjectPublic } from '~~/shared/types/project'
import { toast } from 'vue-sonner'
import { nextProjectTitle, PROJECT_DESCRIPTION_MAX, PROJECT_NAME_MAX } from '~~/shared/types/project'
import { PUBLIC_AGENT_SKILLS } from '~~/shared/utils/agentSkills'
import { readErrorMessage } from '~~/shared/utils/apiError'
import ProjectCard from '@/components/projects/ProjectCard.vue'
import ProjectDeleteDialog from '@/components/projects/ProjectDeleteDialog.vue'
import SkillWorkflowCard from '@/components/projects/SkillWorkflowCard.vue'

const POLL_MS = 3000
const { public: publicConfig } = useRuntimeConfig()
const { t } = useI18n()
const localePath = useLocalePath()

const { projects, selectedProjectId, loaded, loading, loadFailed, loadProjects, removeProject } = useProjects()
useSeoMeta({
  title: computed(() => `${t('projects.title')} · ${publicConfig.brandName}`),
  description: computed(() => t('seo.projectsDescription')),
})
const hasActiveJobs = computed(() => projects.value.some(project => project.activeJobCount > 0))
const sortedProjects = computed(() => [...projects.value].sort((a, b) =>
  Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
  || Date.parse(b.createdAt) - Date.parse(a.createdAt),
))
const createOpen = ref(false)
const creating = ref(false)
const createName = ref('')
const createDescription = ref('')
const pendingSkillId = ref('')
const createNameInputRef = ref<{
  $el?: HTMLInputElement
} | null>(null)
const editOpen = ref(false)
const editing = ref(false)
const editingProject = ref<GenerationProjectPublic | null>(null)
const editName = ref('')
const editDescription = ref('')
const deleteOpen = ref(false)
const deleting = ref(false)
const deletingProject = ref<GenerationProjectPublic | null>(null)
onMounted(() => {
  void loadProjects()
})
useIntervalFn(() => {
  if (import.meta.server)
    return
  if (document.visibilityState !== 'visible') {
    return
  }
  if (!hasActiveJobs.value)
    return
  void loadProjects()
}, POLL_MS)
function openCreate(skillId: string | Event = '') {
  pendingSkillId.value = typeof skillId === 'string' ? skillId : ''
  createName.value = nextProjectTitle(projects.value.map(project => project.name))
  createDescription.value = ''
  createOpen.value = true
  nextTick(() => {
    const input = createNameInputRef.value?.$el
    input?.focus()
    input?.select()
  })
}
function openEdit(project: GenerationProjectPublic) {
  if (project.isDefault)
    return
  editingProject.value = project
  editName.value = project.name
  editDescription.value = project.description
  editOpen.value = true
}
function openDelete(project: GenerationProjectPublic) {
  deletingProject.value = project
  deleteOpen.value = true
}
async function submitCreate() {
  if (creating.value)
    return
  creating.value = true
  try {
    const project = await $fetch<GenerationProjectPublic>('/api/projects', {
      method: 'POST',
      body: {
        name: createName.value,
        description: createDescription.value,
      },
    })
    projects.value = [project, ...projects.value.filter(item => item.id !== project.id)]
    selectedProjectId.value = project.id
    createOpen.value = false
    await navigateTo({
      path: localePath(`/projects/${project.id}`),
      query: pendingSkillId.value ? { agentSkill: pendingSkillId.value } : undefined,
    })
  }
  catch (error) {
    toast.error(readErrorMessage(error, 'Could not create the project'))
  }
  finally {
    creating.value = false
  }
}
async function openSkill(skillId: string) {
  const current = projects.value.find(project => project.id === selectedProjectId.value) || sortedProjects.value[0]
  if (!current) {
    openCreate(skillId)
    return
  }
  await navigateTo({
    path: localePath(`/projects/${current.id}`),
    query: { agentSkill: skillId },
  })
}
async function submitEdit() {
  if (editing.value || !editingProject.value)
    return
  editing.value = true
  try {
    const project = await $fetch<GenerationProjectPublic>(`/api/projects/${editingProject.value.id}`, {
      method: 'PATCH',
      body: {
        name: editName.value,
        description: editDescription.value,
      },
    })
    projects.value = projects.value.map(item => item.id === project.id ? { ...item, ...project } : item)
    editOpen.value = false
  }
  catch (error) {
    toast.error(readErrorMessage(error, 'Could not update the project'))
  }
  finally {
    editing.value = false
  }
}
async function confirmDelete() {
  if (deleting.value || !deletingProject.value)
    return
  deleting.value = true
  try {
    await removeProject(deletingProject.value.id)
    deleteOpen.value = false
  }
  catch (error) {
    const status = Number((error as { statusCode?: unknown, status?: unknown })?.statusCode
      || (error as { status?: unknown })?.status
      || 0)
    toast.error(status === 409
      ? t('projects.deleteBusy')
      : t('projects.deleteFailed'))
  }
  finally {
    deleting.value = false
  }
}
</script>

<template>
  <div class="mx-auto flex w-full max-w-[1128px] flex-col gap-8">
    <section class="flex flex-col gap-5 border-b border-border pb-7">
      <div class="min-w-0">
        <p class="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          {{ t('projects.workspaceLabel') }}
        </p>
        <h1 class="mt-2 text-3xl font-normal tracking-[-0.045em] sm:text-4xl">
          {{ t('projects.title') }}
        </h1>
        <p class="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
          {{ t('projects.workspaceDescription') }}
        </p>
      </div>
    </section>

    <section class="flex flex-col gap-4" aria-labelledby="skills-heading">
      <div>
        <h2 id="skills-heading" class="text-xl font-normal tracking-[-0.025em]">
          {{ t('skills.title') }}
        </h2>
        <p class="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">
          {{ t('skills.projectDescription') }}
        </p>
      </div>
      <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
        <SkillWorkflowCard
          v-for="skill in PUBLIC_AGENT_SKILLS"
          :key="skill.id"
          :skill="skill"
          @click="openSkill(skill.id)"
        />
      </div>
    </section>

    <section class="flex flex-col gap-4" aria-labelledby="project-list-heading">
      <div class="flex min-w-0 items-center gap-3">
        <h2 id="project-list-heading" class="text-sm font-medium">
          {{ t('projects.allProjects') }}
        </h2>
        <p class="font-mono text-xs text-muted-foreground" aria-live="polite">
          {{ t('projects.projectCount', sortedProjects.length) }}
        </p>
      </div>

      <div
        v-if="!loaded && projects.length === 0"
        class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        :aria-label="t('projects.loadingProjects')"
        aria-busy="true"
      >
        <div v-for="index in 4" :key="index" class="overflow-hidden rounded-2xl border border-border bg-card">
          <Skeleton class="aspect-4/3 rounded-none" />
          <div class="space-y-3 p-4">
            <Skeleton class="h-4 w-2/3" />
            <Skeleton class="h-3 w-1/2" />
          </div>
        </div>
      </div>

      <div
        v-else-if="loadFailed && projects.length === 0"
        class="flex min-h-72 flex-col items-center justify-center rounded-2xl border border-border bg-card px-6 py-12 text-center"
        role="alert"
      >
        <div class="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Icon name="i-lucide-cloud-off" class="size-5" />
        </div>
        <h3 class="mt-4 text-base font-medium">
          {{ t('projects.loadFailedTitle') }}
        </h3>
        <p class="mt-1 max-w-sm text-sm leading-6 text-muted-foreground">
          {{ t('projects.loadFailedDescription') }}
        </p>
        <Button
          type="button"
          variant="outline"
          class="mt-5 h-8 rounded-lg px-3 text-xs"
          :disabled="loading"
          @click="loadProjects()"
        >
          <Icon name="i-lucide-rotate-cw" class="size-3.5" :class="{ 'animate-spin': loading }" />
          {{ t('common.retry') }}
        </Button>
      </div>

      <div
        v-else-if="sortedProjects.length === 0"
        class="flex min-h-72 flex-col items-center justify-center rounded-2xl border border-border bg-card px-6 py-12 text-center"
      >
        <div class="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Icon name="i-lucide-folder-plus" class="size-5" />
        </div>
        <h3 class="mt-4 text-base font-medium">
          {{ t('projects.emptyTitle') }}
        </h3>
        <p class="mt-1 max-w-sm text-sm leading-6 text-muted-foreground">
          {{ t('projects.emptyDescription') }}
        </p>
        <Button type="button" class="mt-6 h-9 rounded-lg px-4 text-sm font-medium active:scale-[0.98]" @click="openCreate">
          <Icon name="i-lucide-plus" class="size-3.5" />
          {{ t('projects.newProject') }}
        </Button>
      </div>

      <div
        v-else
        class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
      >
        <ProjectCard
          v-for="project in sortedProjects"
          :key="project.id"
          :project="project"
          show-actions
          @edit="openEdit(project)"
          @delete="openDelete(project)"
        />
      </div>
    </section>

    <Dialog v-model:open="createOpen">
      <DialogContent class="rounded-2xl border-border bg-card shadow-none sm:max-w-md">
        <DialogHeader class="gap-1">
          <DialogTitle>
            {{ t('projects.newProject') }}
          </DialogTitle>
          <DialogDescription>
            {{ t('projects.newDescription') }}
          </DialogDescription>
        </DialogHeader>

        <form
          class="flex flex-col gap-4"
          @submit.prevent="submitCreate"
        >
          <FieldGroup>
            <Field>
              <FieldLabel html-for="project-name">
                {{ t('projects.titleLabel') }}
              </FieldLabel>
              <Input
                id="project-name"
                ref="createNameInputRef"
                v-model="createName"
                :maxlength="PROJECT_NAME_MAX"
                required
                class="h-9 rounded-xl bg-input/30 shadow-none"
              />
            </Field>
            <Field>
              <FieldLabel html-for="project-description">
                {{ t('projects.descriptionLabel') }}
                <span class="font-normal text-muted-foreground">
                  ({{ t('common.optional') }})
                </span>
              </FieldLabel>
              <Textarea
                id="project-description"
                v-model="createDescription"
                rows="3"
                :maxlength="PROJECT_DESCRIPTION_MAX"
                :placeholder="t('projects.descriptionPlaceholder')"
                class="min-h-20 rounded-xl bg-input/30 shadow-none"
              />
            </Field>
          </FieldGroup>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              class="h-8 rounded-lg px-3 text-xs shadow-none"
              :disabled="creating"
              @click="createOpen = false"
            >
              {{ t('common.cancel') }}
            </Button>
            <Button
              type="submit"
              class="h-8 rounded-lg px-3 text-xs shadow-none"
              :disabled="creating"
            >
              {{ creating ? t('common.creating') : t('common.create') }}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="editOpen">
      <DialogContent class="rounded-2xl border-border bg-card shadow-none sm:max-w-md">
        <DialogHeader class="gap-1">
          <DialogTitle>
            {{ t('projects.editProject') }}
          </DialogTitle>
          <DialogDescription>
            {{ t('projects.editDescription') }}
          </DialogDescription>
        </DialogHeader>

        <form
          class="flex flex-col gap-4"
          @submit.prevent="submitEdit"
        >
          <FieldGroup>
            <Field>
              <FieldLabel html-for="edit-project-name">
                {{ t('projects.titleLabel') }}
              </FieldLabel>
              <Input
                id="edit-project-name"
                v-model="editName"
                :maxlength="PROJECT_NAME_MAX"
                required
                class="h-9 rounded-xl bg-input/30 shadow-none"
              />
            </Field>
            <Field>
              <FieldLabel html-for="edit-project-description">
                {{ t('projects.descriptionLabel') }}
                <span class="font-normal text-muted-foreground">
                  ({{ t('common.optional') }})
                </span>
              </FieldLabel>
              <Textarea
                id="edit-project-description"
                v-model="editDescription"
                rows="3"
                :maxlength="PROJECT_DESCRIPTION_MAX"
                :placeholder="t('projects.descriptionPlaceholder')"
                class="min-h-20 rounded-xl bg-input/30 shadow-none"
              />
            </Field>
          </FieldGroup>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              class="h-8 rounded-lg px-3 text-xs shadow-none"
              :disabled="editing"
              @click="editOpen = false"
            >
              {{ t('common.cancel') }}
            </Button>
            <Button
              type="submit"
              class="h-8 rounded-lg px-3 text-xs shadow-none"
              :disabled="editing"
            >
              {{ editing ? t('common.saving') : t('common.save') }}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    <ProjectDeleteDialog
      :open="deleteOpen"
      :pending="deleting"
      :project-name="deletingProject?.name"
      :is-default="deletingProject?.isDefault"
      @update:open="deleteOpen = $event"
      @confirm="confirmDelete"
    />
  </div>
</template>
