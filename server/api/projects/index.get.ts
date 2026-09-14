import type { GenerationProjectList } from '../../../shared/types/project'
import { Project } from '../../models/project'
import { projectStats, toPublicProjectWithStats } from '../../utils/projects'
import { connectDatabase } from '../../utils/sqlite'

export default defineEventHandler(async (_event): Promise<GenerationProjectList> => {
  await connectDatabase()
  const projects = await Project.find({}).sort({ isDefault: -1, createdAt: -1 })
  const stats = await projectStats()
  return {
    items: projects.map(project => toPublicProjectWithStats(project, stats)),
  }
})
