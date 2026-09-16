import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { findSkillsDir, loadAgentSkills } from '../server/agent/skills.ts'

const root = await mkdtemp(join(tmpdir(), 'miao-skills-'))
try {
  const source = join(root, 'server/agent/skills')
  const bundle = join(root, '.nuxt/dev/agent-skills')
  for (const folder of [source, bundle]) {
    await mkdir(folder, { recursive: true })
    await writeFile(join(folder, 'test.md'), '# Test')
  }
  const moduleUrl = pathToFileURL(join(root, '.nuxt/dev/index.mjs')).href
  assert.equal(findSkillsDir(moduleUrl, root, false), source, 'Dev must prefer live source')
  assert.equal(findSkillsDir(moduleUrl, root, true), bundle, 'Production must find packaged skills')
  await rm(source, { recursive: true })
  assert.equal(findSkillsDir(moduleUrl, root, false), bundle, 'Bundle fallback must work')

  const loaded = loadAgentSkills().join('\n')
  for (const heading of ['Long-form video', 'Sketch to Image'])
    assert.ok(loaded.includes(heading), `Missing ${heading}`)
  assert.equal(/product hunt|inspect_website|playwright/i.test(loaded), false)
  console.log('Skill loading passed in source, packaged, and fallback layouts.')
}
finally {
  await rm(root, { recursive: true, force: true })
}
