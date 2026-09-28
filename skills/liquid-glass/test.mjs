// Checks that the Personal World stylesheet follows the liquid-glass skill.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { checkSkillFile, root } from '../../tests/skill-kit.mjs'
import { audit, contrast, parseCss } from './audit.mjs'

const dir = fileURLToPath(new URL('.', import.meta.url))
const css = ['src/styles.css', 'src/app.css'].map((path) => readFileSync(join(root, path), 'utf8')).join('\n')

test('SKILL.md 格式完整，记录了 HIG 的关键规则', () => {
  const { body } = checkSkillFile(dir)
  for (const fact of ["Don't use Liquid Glass in the content layer", 'Regular variant', 'Clear variant', '35 %', 'concentric', '-webkit-', 'insets.top', 'liquidGlass.ts', '--glass-specular', 'full-width']) assert.ok(body.includes(fact), `缺少 ${fact}`)
})

test('审查器能识别违规样例', () => {
  const bad = `:root{--muted:#aaaaaa}
.map-label{background:var(--glass-sheen),#fff;box-shadow:var(--glass-rim)}
.tray{backdrop-filter:blur(8px)}
.tray .chip{backdrop-filter:var(--glass-blur);-webkit-backdrop-filter:var(--glass-blur)}
.map-photo:hover{transform:scale(1.04)}
.map-photo-menu{background:var(--glass-sheen)}`
  const failed = audit(bad).filter((r) => !r.ok).map((r) => r.rule)
  assert.ok(!audit(bad).find((r) => r.rule === 'content-not-glass').detail.includes('.map-photo-menu'), '.map-photo-menu 是控件层，不算内容')
  // Overridden later in the cascade: not a violation
  const fixedLater = audit('.x:hover{transform:scale(1.1)}.x:hover{transform:none}.y{backdrop-filter:blur(2px)}.y{-webkit-backdrop-filter:blur(2px)}')
  assert.ok(fixedLater.find((r) => r.rule === 'static-on-hover').ok, '后面的规则已取消位移')
  assert.ok(fixedLater.find((r) => r.rule === 'webkit-prefix').ok, '同一选择器后面补了前缀')
  for (const rule of ['tokens', 'navigation-is-glass', 'content-not-glass', 'webkit-prefix', 'reduce-transparency', 'increase-contrast', 'no-glass-on-glass', 'static-on-hover', 'clear-variant-over-media', 'secondary-label-contrast']) assert.ok(failed.includes(rule), `应判为违规：${rule}`)
})

test('解析 @media 与多选择器', () => {
  const rules = parseCss('.a,.b{color:red}@media(max-width:600px){.a{color:blue}}')
  assert.deepEqual(rules.map((r) => [r.selectors, r.media]), [[['.a', '.b'], ''], [['.a'], '@media(max-width:600px)']])
  assert.ok(Math.abs(contrast('#6e6e73', '#ffffff') - 5.07) < 0.05)
})

test('真实玻璃：顶栏占满顶部，有高光描边，主要表面启用边缘折射', () => {
  assert.match(css, /\.app-bar\{position:absolute;top:0;left:0;right:0;/, '顶栏占满页面顶部')
  assert.match(css, /--glass-specular:linear-gradient/)
  assert.match(css, /::before\{content:'';position:absolute;inset:0;border-radius:inherit;padding:1px;background:var\(--glass-specular\)/)
  const main = readFileSync(join(root, 'src/main.tsx'), 'utf8')
  assert.match(main, /startLiquidGlass\('\.app-bar, \.map-heading, \.map-empty/)
})

test('项目样式表符合液态玻璃规则', () => {
  const failed = audit(css).filter((r) => !r.ok)
  assert.deepEqual(failed, [], failed.map((r) => `${r.rule}: ${r.detail}`).join('\n'))
})
