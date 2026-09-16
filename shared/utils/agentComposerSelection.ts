import { PUBLIC_AGENT_SKILLS } from './agentSkills.ts'

// A pasted/restored draft may contain stale selections. Keep only the last
// explicit model-or-skill selection so the composer always has one intent.
export function normalizeComposerSelection(text: string) {
  const selections = [...text.matchAll(/@\[[^\]]+\]\(model:([^\s)]+)\)|(?<!\S)\/([a-z0-9-]+)(?=\s|$)/g)]
    .filter(match => Boolean(match[1]) || PUBLIC_AGENT_SKILLS.some(skill => skill.id === match[2]))

  for (const match of selections.slice(0, -1).reverse()) {
    const start = match.index!
    text = text.slice(0, start) + text.slice(start + match[0].length).replace(/^[ \t]+/, '')
  }
  return text
}
