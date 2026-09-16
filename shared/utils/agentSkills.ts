// Public picker catalog. Internal operating skills remain hidden.
export const PUBLIC_AGENT_SKILLS = [
  {
    id: 'image-annotation-edit',
    icon: 'lucide:map-pin',
    name: 'Annotated Image Edit',
    description: 'Mark points on an image and describe each change precisely.',
    keywords: 'annotate annotation image edit point pin 标注 修图 编辑',
  },
  {
    id: 'sketch-to-image',
    icon: 'lucide:pencil-ruler',
    name: 'Sketch to Image',
    description: 'Draw a sketch and turn it into a finished image.',
    keywords: 'sketch drawing image 草图 绘画',
  },
  {
    id: 'app-store-graphics',
    icon: 'lucide:smartphone',
    name: 'App Store Graphics',
    description: 'Turn app screenshots into a consistent marketing set.',
    keywords: 'app store graphics iphone screenshot marketing preview 应用商店',
  },
  {
    id: 'long-form-video',
    icon: 'lucide:clapperboard',
    name: 'Long-form Video',
    description: 'Plan a storyboard and produce a multi-shot film.',
    keywords: 'long form video film storyboard short film 长视频 短片 分镜',
  },
] as const

export type PublicAgentSkill = typeof PUBLIC_AGENT_SKILLS[number]

export function searchAgentSkills(query: string) {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean)
  return PUBLIC_AGENT_SKILLS.filter(skill =>
    terms.every(term => `${skill.id} ${skill.name} ${skill.description} ${skill.keywords}`.toLowerCase().includes(term)),
  )
}

export function findComposerCommand(text: string, caret: number) {
  const before = text.slice(0, caret)
  const match = /(?:^|\s)([@/])([^@/\n]*)$/.exec(before)
  if (match?.[1] === '/' && PUBLIC_AGENT_SKILLS.some(skill => match[2]?.startsWith(`${skill.id} `)))
    return null
  return match
    ? {
        start: caret - match[2]!.length - 1,
        end: caret,
        query: match[2]!,
        trigger: match[1] as '@' | '/',
      }
    : null
}

export function readSkillCommands(text: string) {
  const ids = new Set([...text.matchAll(/(?:^|\s)\/([a-z0-9-]+)(?=\s|$)/g)].map(match => match[1]))
  return PUBLIC_AGENT_SKILLS.filter(skill => ids.has(skill.id))
}

export function stripSkillCommands(text: string) {
  return text.replace(/(?<!\S)\/([a-z0-9-]+)(?=\s|$)[ \t]*/g, (match, id) =>
    PUBLIC_AGENT_SKILLS.some(skill => skill.id === id) ? '' : match)
}

export function composerPlaceholderForSkills(skills: readonly { id: string, placeholder?: string }[]) {
  for (const skill of skills) {
    if (skill.placeholder)
      return skill.placeholder
  }
  return ''
}
