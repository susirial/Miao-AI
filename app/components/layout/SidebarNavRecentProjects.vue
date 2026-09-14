<script setup lang="ts">
import type { GenerationProjectPublic } from '~~/shared/types/project'
import { toast } from 'vue-sonner'
import { readErrorMessage } from '~~/shared/utils/apiError'
import ProjectDeleteDialog from '@/components/projects/ProjectDeleteDialog.vue'
import { useSidebar } from '~/components/ui/sidebar'

const { projects, loaded, loading, createProject, removeProject } = useProjects()
const { setOpenMobile } = useSidebar()
const { t } = useI18n()
const localePath = useLocalePath()
const creating = ref(false)
const deleting = ref(false)
const deleteOpen = ref(false)
const deletingProject = ref<GenerationProjectPublic | null>(null)
const route = useRoute()
const MAX_RECENT_PROJECTS = 10
const hasMoreProjects = computed(() => projects.value.length > MAX_RECENT_PROJECTS)
async function onCreateProject() {
  if (creating.value)
    return
  creating.value = true
  try {
    const project = await createProject()
    setOpenMobile(false)
    await navigateTo(localePath(`/projects/${project.id}`))
  }
  catch (error) {
    toast.error(readErrorMessage(error, 'Could not create the project'))
  }
  finally {
    creating.value = false
  }
}
function openDelete(project: GenerationProjectPublic) {
  deletingProject.value = project
  deleteOpen.value = true
}
async function confirmDelete() {
  if (deleting.value || !deletingProject.value)
    return
  deleting.value = true
  try {
    await removeProject(deletingProject.value.id)
  }
  catch (error) {
    const status = Number((error as { statusCode?: unknown, status?: unknown })?.statusCode
      || (error as { status?: unknown })?.status
      || 0)
    toast.error(status === 409
      ? t('projects.deleteBusy')
      : t('projects.deleteFailed'))
    return
  }
  finally {
    deleting.value = false
  }
  deleteOpen.value = false
  setOpenMobile(false)
}
const recentProjects = computed(() => {
  return [...projects.value]
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
      || Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, MAX_RECENT_PROJECTS)
})
</script>

<template>
  <SidebarGroup>
    <SidebarGroupLabel>
      {{ t('navigation.recentProjects') }}
    </SidebarGroupLabel>
    <nav :aria-label="t('navigation.recentProjects')">
      <SidebarMenu class="mb-1">
        <SidebarMenuItem>
          <SidebarMenuButton
            type="button"
            :tooltip="t('navigation.newProject')"
            :disabled="creating"
            :aria-busy="creating"
            @click="onCreateProject"
          >
            <Icon :name="creating ? 'i-lucide-loader-circle' : 'i-lucide-plus'" :class="{ 'animate-spin': creating }" />
            <span>{{ creating ? t('common.creating') : t('navigation.newProject') }}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
      <SidebarMenu v-if="recentProjects.length" class="max-h-[min(20rem,40dvh)] overflow-y-auto overscroll-contain">
        <SidebarMenuItem v-for="project in recentProjects" :key="project.id">
          <SidebarMenuButton
            as-child
            :tooltip="project.name"
            :is-active="route.path === localePath(`/projects/${project.id}`)"
          >
            <NuxtLink
              :to="localePath(`/projects/${project.id}`)"
              :aria-disabled="project.deleting"
              @click="project.deleting ? $event.preventDefault() : setOpenMobile(false)"
            >
              <Icon name="i-lucide-folder" />
              <span class="truncate">
                {{ project.name }}
                <span v-if="project.deleting" class="text-muted-foreground"> · {{ t('projects.deleting') }}</span>
              </span>
            </NuxtLink>
          </SidebarMenuButton>
          <DropdownMenu :modal="false">
            <DropdownMenuTrigger as-child>
              <SidebarMenuAction
                show-on-hover
                :aria-label="t('projects.actionsFor', { name: project.name })"
                @click.stop
              >
                <Icon name="i-lucide-ellipsis" />
              </SidebarMenuAction>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" class="min-w-36" @click.stop>
              <DropdownMenuItem
                variant="destructive"
                @click.stop="openDelete(project)"
              >
                {{ t('common.delete') }}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
      <p
        v-else
        class="px-2 py-2 text-sm text-muted-foreground group-data-[collapsible=icon]:hidden"
        role="status"
      >
        {{ !loaded || loading ? t('projects.loadingProjects') : t('projects.noRecentProjects') }}
      </p>
      <NuxtLink
        v-if="hasMoreProjects"
        :to="localePath('/projects')"
        class="mt-1 flex items-center justify-between rounded-md px-2 py-2 text-xs text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:hidden"
        @click="setOpenMobile(false)"
      >
        {{ t('projects.viewAll') }}
        <Icon name="i-lucide-arrow-right" class="size-3.5" />
      </NuxtLink>
    </nav>
    <ProjectDeleteDialog
      :open="deleteOpen"
      :pending="deleting"
      :project-name="deletingProject?.name"
      :is-default="deletingProject?.isDefault"
      @update:open="deleteOpen = $event"
      @confirm="confirmDelete"
    />
  </SidebarGroup>
</template>
