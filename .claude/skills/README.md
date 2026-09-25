# .claude/skills（开发用）

开发 Personal World 时用到的 skill。Claude Code 会自动发现这个目录里的 skill。项目运行时交给大模型的 skill 在 [`skills/`](../../skills/README.md)。

已接入实现的 skill 有专门的 `test.mjs`，与运行时 skill 一起运行：`npm run test:skills`（`LIVE=1` 时连接真实服务）。方案阶段的 skill 会在对应实现与可观察行为出现后补测试。

## 自建

| Skill | 用途 | 测试 | 对比测试 |
|---|---|---|---|
| [stepfun-api](stepfun-api/SKILL.md) | StepFun 对话/图片/JSON、语音识别、语音合成的已验证调用方法 | [test.mjs](stepfun-api/test.mjs) | [3/3 vs 2/3](stepfun-api/evals/2026-09-24/README.md) |
| [amap-threejs](amap-threejs/SKILL.md) | 高德 JS API 2.0 3D 地图上叠加 Three.js 的做法 | [test.mjs](amap-threejs/test.mjs) | [位置偏差 1 px、尺寸恒定 vs 画不出来](amap-threejs/evals/2026-09-24/README.md) |
| [map-scene-styling](map-scene-styling/SKILL.md) | 人生地图的整体卡通风格、记忆地点场景与材质路线 | 场景层试作已接入；运行时 Agent skill 待做 | — |

## 引用过的外部 skill（未复制进仓库）

| Skill | 所在位置 | 用在哪 |
|---|---|---|
| apply-gpt-5p6-guidance | `~/.codex/skills` | Codex 阶段每个请求隐式使用 |
| codex-output-polish | `~/.codex/skills` | Codex 阶段的回复格式 |
| frontend-skill | `~/.codex/skills` | 首版界面；人生地图 + 人生管家的 App 布局 |
| design-taste-frontend | `~/.codex/skills` | 首版界面 |
| agent-reach | `~/.agents/skills` | 查阅 StepFun 文档、核对 GitLab 仓库 |
| control-in-app-browser | Codex 内置 | Codex 阶段的浏览器检查 |
| artifact-design | Claude Code 内置 | 需求说明书与 3D 效果图 |
