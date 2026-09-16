import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

export function findSkillsDir(moduleUrl = import.meta.url, workingDirectory = process.cwd(), production = process.env.NODE_ENV === 'production') {
  if (!production) {
    const source = resolve(workingDirectory, 'server/agent/skills')
    if (existsSync(source) && readdirSync(source).some(file => file.endsWith('.md')))
      return source
  }
  let directory = dirname(fileURLToPath(moduleUrl))
  for (let depth = 0; depth < 8; depth++) {
    for (const folder of ['skills', 'agent-skills']) {
      const candidate = resolve(directory, folder)
      if (existsSync(candidate) && readdirSync(candidate).some(file => file.endsWith('.md')))
        return candidate
    }
    const parent = dirname(directory)
    if (parent === directory)
      break
    directory = parent
  }
  return resolve(workingDirectory, 'server/agent/skills')
}

const FIRST_SKILLS = ['reference-analysis', 'prompt-rewrite', 'result-evaluation', 'long-form-video']

export function loadAgentSkills() {
  const skillsDir = findSkillsDir()
  const blocks: string[] = []
  for (const name of FIRST_SKILLS) {
    try {
      const text = readFileSync(resolve(skillsDir, `${name}.md`), 'utf8').trim()
      if (text)
        blocks.push(text)
    }
    catch {
      // Skill files are optional at runtime.
    }
  }
  try {
    const extra = readdirSync(skillsDir).filter(file => file.endsWith('.md') && !FIRST_SKILLS.includes(file.replace(/\.md$/, '')))
    for (const file of extra.sort()) {
      const text = readFileSync(resolve(skillsDir, file), 'utf8').trim()
      if (text)
        blocks.push(text)
    }
  }
  catch {
    // No skills directory.
  }
  return blocks
}

export function skillsPromptBlock() {
  const skills = loadAgentSkills()
  if (!skills.length)
    return ''
  return `\n\n## Skills\nThese operating notes shape how you think. They do not spend money. Only tools spend money.\n\n${skills.join('\n\n')}`
}
