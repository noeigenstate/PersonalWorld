// Runtime skills: the instructions Personal World gives the model, kept in skills/<name>/SKILL.md.
// Read on every request so editing a skill takes effect without restarting the server.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../skills/', import.meta.url))

export function loadSkill(name) {
  const text = readFileSync(`${root}${name}/SKILL.md`, 'utf8')
  // Drop the YAML front matter; it describes the skill for people, not for the model
  return text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim()
}
