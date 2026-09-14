export type TaskPriority = 'low' | 'medium' | 'high'

export interface NewTask {
  title: string
  description?: string
  priority?: TaskPriority
  dueDate?: Date | string
  status: string
  labels?: string[]
}

export interface Task extends NewTask {
  id: string
  createdAt: Date | string
}

export interface Column {
  id: string
  title: string
  tasks: Task[]
}

export interface BoardState {
  columns: Column[]
}
