import { Project } from '../models/project'

const deletingProjectIds = new Set<string>()
const activeProjectWrites = new Map<string, number>()

function deletionError(statusCode: number, statusMessage: string): never {
  throw Object.assign(new Error(statusMessage), { statusCode, statusMessage })
}

export function beginProjectDeletion(projectId: string) {
  const id = String(projectId || '').trim()
  if (deletingProjectIds.has(id))
    deletionError(409, 'This project is already being deleted')
  if ((activeProjectWrites.get(id) || 0) > 0)
    deletionError(409, 'This project is currently being updated')
  deletingProjectIds.add(id)
}

export function endProjectDeletion(projectId: string) {
  deletingProjectIds.delete(String(projectId || '').trim())
}

export function isProjectDeletionInFlight(projectId?: string) {
  return deletingProjectIds.has(String(projectId || '').trim())
}

export async function assertProjectWritable(projectId?: string) {
  const id = String(projectId || '').trim()
  if (!id)
    return
  if (isProjectDeletionInFlight(id))
    deletionError(409, 'This project is being deleted')
  const project = await Project.findById(id)
  if (!project)
    deletionError(404, 'Project not found')
  if (project.deletingAt)
    deletionError(409, 'This project is being deleted')
}

export async function beginProjectWrite(projectId?: string, options?: {
  allowMissing?: boolean
}) {
  const id = String(projectId || '').trim()
  if (!id)
    return ''
  if (isProjectDeletionInFlight(id))
    deletionError(409, 'This project is being deleted')
  const project = await Project.findById(id)
  if (!project) {
    if (options?.allowMissing)
      return ''
    deletionError(404, 'Project not found')
  }
  if (project.deletingAt)
    deletionError(409, 'This project is being deleted')
  activeProjectWrites.set(id, (activeProjectWrites.get(id) || 0) + 1)
  return id
}

export function endProjectWrite(projectId?: string) {
  const id = String(projectId || '').trim()
  if (!id)
    return
  const remaining = (activeProjectWrites.get(id) || 0) - 1
  if (remaining > 0)
    activeProjectWrites.set(id, remaining)
  else
    activeProjectWrites.delete(id)
}
