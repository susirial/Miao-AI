import type { GenerationProjectList, GenerationProjectPublic } from '~~/shared/types/project'
import { PROJECT_DELETE_CONFIRMATION } from '~~/shared/types/project'

function requestStatus(error: unknown) {
  const record = error && typeof error === 'object' ? error as { statusCode?: unknown, status?: unknown } : null
  return Number(record?.statusCode || record?.status || 0)
}

let inflight: Promise<void> | null = null
export function useProjects() {
  const projects = useState<GenerationProjectPublic[]>('generation-projects', () => [])
  const selectedProjectId = useState('generation-project-id', () => '')
  const loaded = useState('generation-projects-loaded', () => false)
  const loading = useState('generation-projects-loading', () => false)
  const loadFailed = useState('generation-projects-load-failed', () => false)
  const removedProjectIds = useState<string[]>('generation-projects-removed', () => [])
  const route = useRoute()
  const localePath = useLocalePath()
  const nuxtApp = useNuxtApp()
  const selectedProject = computed(() => projects.value.find(project => project.id === selectedProjectId.value)
    || projects.value[0]
    || null)
  function isRemovedProject(projectId: string) {
    return removedProjectIds.value.includes(projectId)
  }
  function markProjectRemoved(projectId: string, destinationId = '') {
    removedProjectIds.value = [...new Set([...removedProjectIds.value, projectId])]
      .filter(id => id !== destinationId)
    projects.value = projects.value.filter(item => item.id !== projectId)
    if (selectedProjectId.value === projectId)
      selectedProjectId.value = destinationId || projects.value[0]?.id || ''
  }
  async function leaveRemovedProject(removedId: string, destinationId = '') {
    if (String(route.params.id || '') !== removedId)
      return
    const nextId = destinationId
      || projects.value.find(project => project.id !== removedId)?.id
      || ''
    await nuxtApp.runWithContext(() => navigateTo(
      nextId ? localePath(`/projects/${nextId}`) : localePath('/projects'),
      { replace: true },
    ))
  }
  async function createProject(input: {
    name?: string
    description?: string
  } = {}) {
    const project = await $fetch<GenerationProjectPublic>('/api/projects', {
      method: 'POST',
      body: input,
    })
    removedProjectIds.value = removedProjectIds.value.filter(id => id !== project.id)
    projects.value = [project, ...projects.value.filter(item => item.id !== project.id)]
    selectedProjectId.value = project.id
    return project
  }
  async function removeProject(projectId: string) {
    let result: {
      ok: boolean
      defaultProjectId: string
      defaultProject?: GenerationProjectPublic | null
    }
    try {
      result = await $fetch<{
        ok: boolean
        defaultProjectId: string
        defaultProject?: GenerationProjectPublic | null
      }>(`/api/projects/${projectId}`, {
        method: 'DELETE',
        body: {
          confirmation: PROJECT_DELETE_CONFIRMATION,
        },
      })
    }
    catch (error) {
      if (requestStatus(error) !== 404)
        throw error
      result = {
        ok: true,
        defaultProjectId: '',
        defaultProject: null,
      }
    }
    markProjectRemoved(projectId, result.defaultProjectId)
    if (result.defaultProject && !projects.value.some(item => item.id === result.defaultProject!.id))
      projects.value = [result.defaultProject, ...projects.value]
    await leaveRemovedProject(projectId, result.defaultProjectId)
    return result
  }
  async function loadProjects() {
    if (!import.meta.client) {
      return
    }
    if (inflight)
      return inflight
    loading.value = true
    loadFailed.value = false
    inflight = (async () => {
      try {
        const data = await $fetch<GenerationProjectList>('/api/projects')
        const removed = new Set(removedProjectIds.value)
        projects.value = data.items.filter(project => !removed.has(project.id))
        if (!projects.value.some(project => project.id === selectedProjectId.value)) {
          selectedProjectId.value = projects.value.find(project => project.isDefault)?.id
            || projects.value[0]?.id
            || ''
        }
      }
      catch (error) {
        loadFailed.value = true
        console.error('[projects]', error)
      }
      finally {
        loading.value = false
        loaded.value = true
        inflight = null
      }
    })()
    return inflight
  }
  if (import.meta.client) {
    void loadProjects()
  }
  return {
    projects,
    selectedProjectId,
    selectedProject,
    loaded,
    loading,
    loadFailed,
    loadProjects,
    createProject,
    removeProject,
    removedProjectIds,
    isRemovedProject,
    markProjectRemoved,
    leaveRemovedProject,
  }
}
