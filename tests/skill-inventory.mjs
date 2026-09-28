import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { checkSkillFile, root } from './skill-kit.mjs'

const skillRoot = join(root, 'skills')
const entries = readdirSync(skillRoot, { withFileTypes: true }).filter(e => e.isDirectory())
const index = readFileSync(join(skillRoot, 'README.md'), 'utf8')

test('every project skill is indexed at the root and has a dedicated test', () => {
  for (const entry of entries) {
    const dir = join(skillRoot, entry.name)
    checkSkillFile(dir)
    assert.ok(existsSync(join(dir, 'test.mjs')), `${entry.name}: missing test.mjs`)
    assert.ok(index.includes(`(${entry.name}/SKILL.md)`), `${entry.name}: missing index entry`)
  }
  const old = join(root, '.claude/skills')
  if (existsSync(old)) for (const entry of readdirSync(old, { withFileTypes: true })) {
    assert.ok(!entry.isDirectory() || !existsSync(join(old, entry.name, 'SKILL.md')), `${entry.name}: skill still lives in the hidden directory`)
  }
})

test('skill index, entrypoints and reference documents have working relative links', () => {
  const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)])
  const files = [join(skillRoot, 'README.md'), ...entries.flatMap(e => {
    const dir = join(skillRoot, e.name), references = join(dir, 'references')
    return [join(dir, 'SKILL.md'), ...(existsSync(references) ? walk(references).filter(f => f.endsWith('.md')) : [])]
  })]
  for (const file of files) for (const match of readFileSync(file, 'utf8').matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1].split('#')[0]
    if (!target || /^[a-z]+:/i.test(target)) continue
    assert.ok(existsSync(resolve(dirname(file), decodeURIComponent(target))), `${file}: broken reference ${target}`)
  }
})
