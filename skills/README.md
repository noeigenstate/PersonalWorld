# 项目 Skills

所有项目自建 skill 都放在根目录 `skills/`，包含 9 个运行时 skill 和 6 个开发 skill。每项的正文、测试、参考资料与可分发评估结果均随 Git 上传。

运行时 skill 由服务端明确读取后交给模型；开发 skill 供开发 agent 按需阅读执行。地图精修的流程可以复用，新地标仍需资料、模型制作与视觉验收，不能据此宣称已经实现任意地点同品质自动生成。

## 规则

1. 已有合适的 skill 就用；没有就在这里新建一个目录，写 `SKILL.md`。
2. **每个 skill 都有专门的测试** `test.mjs`。检查格式与可观察行为；运行时接口用模拟模型测试，已提供的真实调用用例通过 `LIVE=1` 启用。地图开发还需执行对应浏览器和视觉验收，不能用离线通过代替美术验收。
3. 能做对比测试的 skill，在 `evals/<日期>/` 记录"用 skill / 不用 skill"的结果。

```bash
npm run test:skills             # 离线部分
LIVE=1 npm run test:skills      # 含真实 StepFun / 高德调用
```

## 运行时技能（9）

| Skill | 用途 | 使用它的接口 | 测试 | 对比测试 |
|---|---|---|---|---|
| [event-analysis](event-analysis/SKILL.md) | 从一组照片重建一件事：标题、摘要、类型、地点、城市、画面文字、待确认问题 | `POST /api/analyze` | [test.mjs](event-analysis/test.mjs) | — |
| [life-butler](life-butler/SKILL.md) | 人生管家：语音对话 agent，以事件、照片信息卡和人物故事为记忆回答，推断内容加〔〕，并返回操作地图的动作（语义找照片、定位、幻灯片讲故事、打开事件 / 人物与故事 / 时空场景 / 回忆短片） | `POST /api/butler`（动作校验在 `server/butler.mjs`） | [test.mjs](life-butler/test.mjs) | — |
| [photo-card](photo-card/SKILL.md) | 单张照片信息卡：事实与推断分开、地标、带依据的线索、按隐私声明处理号码 | `POST /api/photo-card` | [test.mjs](photo-card/test.mjs) | [44/45 vs 23/45](photo-card/evals/2026-09-24/README.md) |
| [photo-cull](photo-cull/SKILL.md) | 挑照片：相似照片逐张检查闭眼、模糊、表情，推荐保留几张 | `POST /api/photo-cull` | [test.mjs](photo-cull/test.mjs) | [36/36 vs 34/36](photo-cull/evals/2026-09-28/README.md) |
| [photo-context](photo-context/SKILL.md) | 多张照片协同判断：与有定位的参考照片比对，补全地点、时间、事件 | `POST /api/photo-context` | [test.mjs](photo-context/test.mjs) | [48/48 vs 40/48](photo-context/evals/2026-09-24/README.md) |
| [story-understanding](story-understanding/SKILL.md) | 资料变化后增量重理解经历、跨地点发现故事，再独立复核证据 | `memory-graph` 持久队列；`POST /api/memory-graph/understanding` 暂停/重试 | [test.mjs](story-understanding/test.mjs)、[队列测试](../tests/story-understanding.mjs) | — |
| [spacetime-scene](spacetime-scene/SKILL.md) | 4D 时空场景：同一地点的照片按有依据的时间片分段，选关键照片做本机三维重建，逐层标注证据 | `POST /api/spacetime-scene`、`POST /api/spacetime-scene/relief` | [test.mjs](spacetime-scene/test.mjs) | — |
| [memory-film](memory-film/SKILL.md) | 接收照片事实与故事角度，自动选片、字幕、镜头编排，交给本机合成 MP4 | `POST /api/memory-films` | [test.mjs](memory-film/test.mjs)、[真实渲染](../tests/film-treatments.mjs) | — |
| [memory-storytelling](memory-storytelling/SKILL.md) | 自动选题选片、按具体发现讲故事、独立复核；跨图旁白、对照、留白、回扣、补充记忆及资料更新后重编 | `POST /api/butler` 的 story 路径；`/api/storytelling/list`、`/note` | [test.mjs](memory-storytelling/test.mjs)、[播放器回归](../tests/smoke.mjs) | [虚构材料单例配对](memory-storytelling/evals/2026-09-29/README.md)；私人样片存于忽略目录 |

## 开发技能（6）

| Skill | 用途 | 测试与验收 |
|---|---|---|
| [map-scene-styling](map-scene-styling/SKILL.md) | 真实街区、水系、树木、光照、材质与地图层级的统一卡通语言 | [test.mjs](map-scene-styling/test.mjs)、[场景数据](../tests/scene-details.mjs)、实际地图截图 |
| [landmark-refinement](landmark-refinement/SKILL.md) | 特殊建筑参考收集、特征提取、程序化模型和多视角验收 | [test.mjs](landmark-refinement/test.mjs)、[工作流程](landmark-refinement/references/workflow.md)、[模型检视](../tests/venue-models.mjs) |
| [amap-threejs](amap-threejs/SKILL.md) | 高德与 Three.js 坐标、相机、叠加、地形及地球切换 | [test.mjs](amap-threejs/test.mjs)、[历史对比](amap-threejs/evals/2026-09-24/README.md) |
| [memory-identity](memory-identity/SKILL.md) | 稳定人物 ID、关系事实、增量故事和下游同步 | [test.mjs](memory-identity/test.mjs)、[身份回归](../tests/identity-graph.mjs)、[同步回归](../tests/event-understanding-sync.mjs) |
| [liquid-glass](liquid-glass/SKILL.md) | 界面玻璃材质、层级、无障碍与稳定交互 | [test.mjs](liquid-glass/test.mjs)、[历史对比](liquid-glass/evals/2026-09-28/README.md) |
| [stepfun-api](stepfun-api/SKILL.md) | Step Plan 对话、视觉、JSON、ASR 与语音合成 | [test.mjs](stepfun-api/test.mjs)、[历史对比](stepfun-api/evals/2026-09-24/README.md) |

## 外部技能来源

以下是历史开发中引用的工具技能，依照项目约定登记来源，不复制个人安装目录。项目产物及必要流程已经保存在以上项目技能中。

| 名称 | 来源 | 历史用途 |
|---|---|---|
| apply-gpt-5p6-guidance、codex-output-polish | `~/.codex/skills` | Codex 工作方式与输出 |
| frontend-skill、design-taste-frontend | `~/.codex/skills` | 首版界面与布局 |
| agent-reach | `~/.agents/skills` | 文档与仓库查询 |
| control-in-app-browser、artifact-design | 开发工具内置 | 浏览器检查、需求与效果图 |
| skill-creator | Codex 系统 skill | 技能维护与验证 |

上传核查及迁移说明见 [技能交付清单](../docs/SKILLS_INVENTORY_2026-09-28.md)。`npm run test:skills` 同时检查目录、索引、引用和专门测试是否齐全。
