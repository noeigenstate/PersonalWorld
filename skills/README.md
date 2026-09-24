# skills

这个目录收录 Personal World 开发过程中**引用**和**自建**的所有 skill。

## 使用原则

1. 已有合适的 skill 就用，不重复造轮子。
2. 没有合适的就自建，放在本目录，并在下表登记。
3. 能测试的 skill 做对比测试：同一任务分别在"用 skill"和"不用 skill"两种条件下执行，记录结果差异，证明 skill 有效后再依赖它。测试记录放在该 skill 目录下的 `evals/`。

## 索引

| Skill | 来源 | 用途 | 本项目中的使用 |
|---|---|---|---|
| [apply-gpt-5p6-guidance](apply-gpt-5p6-guidance/SKILL.md) | 引用 · Codex（`~/.codex/skills`） | 按 GPT-5.6 官方提示词指南理解和执行请求 | Codex 阶段每个请求隐式使用 |
| [codex-output-polish](codex-output-polish/SKILL.md) | 引用 · Codex（`~/.codex/skills`） | 规范面向用户的回复格式 | Codex 阶段的进度汇报与总结 |
| [frontend-skill](frontend-skill/SKILL.md) | 引用 · Codex（`~/.codex/skills`） | 克制、有层次的界面设计规范 | 首版 Web 界面；人生地图 + 人生管家的 App 布局（主工作区 / 导航 / 上下文面板、单一强调色） |
| [design-taste-frontend](design-taste-frontend/SKILL.md) | 引用 · Codex（`~/.codex/skills`） | 避免模板化外观的前端设计规范 | 首版 Web 界面 |
| [agent-reach](agent-reach/SKILL.md) | 引用 · `~/.agents/skills` | 读取网页、搜索等互联网访问 | 查阅 StepFun 文档、核对 GitLab 仓库 |
| control-in-app-browser | 引用 · Codex 内置（无本地文件） | 在 Codex 内置浏览器中操作页面 | Codex 阶段的浏览器检查 |
| artifact-design | 引用 · Claude Code 内置（无本地文件） | HTML 页面的设计规范 | 需求说明书与 3D 效果图 |
| [stepfun-api](stepfun-api/SKILL.md) | **自建** | StepFun 对话/图片/JSON、语音识别、语音合成的已验证调用方法 | 事件分析、人生管家对话与语音。对比测试：[3/3 vs 2/3](stepfun-api/evals/2026-09-24/README.md) |

内置 skill 随工具提供，本机没有可复制的文件，只在此登记。
