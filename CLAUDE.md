# Personal World

需求与交互以 `docs/需求说明书.html` 为准，效果图见 `docs/mockups/`。

## 开发原则

- 已有合适的 skill 就用；没有就自建。
  - 所有项目自建 skill 统一放在根目录 `skills/`，完整索引见 `skills/README.md`；不要放入 `.claude/skills/` 或只保存在个人目录。
  - **运行时** skill 由服务端明确调用；**开发** skill 供 agent 阅读执行。两者的用途、实现入口和验收方式在索引中区分，不能把开发流程宣称为运行时自动能力。
  - 引用过的外部 skill 只在索引登记，不复制；技能正文、相对引用、测试和可分发评估资源需一起提交。
- **每个 skill 都要有专门的测试** `test.mjs`（格式与关键规则、使用它的接口、`LIVE=1` 时的真实调用），用 `npm run test:skills` 运行。
- 能测试的 skill 做对比测试（用 / 不用 skill 执行同一任务），结果放在该 skill 的 `evals/`。评分脚本要先核对失败样例，避免误判。
- 顶栏不放导航按钮。人生管家没有聊天面板：地图上的 `VoiceButler` 支持按住说话，以及话筒旁的「打字」入口（用户远程访问无法使用麦克风时）。两种输入共用管家请求、字幕、朗读和地图动作；点击地点时管家先用字幕开口。`#tell=` 链接只预填文字，用户发送后才执行。
- 管家是一个会操作地图的 agent：`/api/butler` 收到照片信息卡索引和界面状态，返回 `actions`（按语义找照片、定位到照片、讲故事配幻灯片、打开事件、记据点角色、拨时间线、打开人物与故事 / 时空场景 / 回忆短片），动作在 `server/butler.mjs` 校验、在 `App.tsx` 执行。人物与故事、时空场景、回忆短片不做按钮，由管家在对话中打开，结果展示在地图上（`Showcase` 舞台、地图随照片移动）。
- 分析是自动的：照片信息卡和事件分析在导入后自行进行，用户只核对与确认，不放"用 StepFun 分析"之类的手动按钮。
- 边看边讲由 `skills/memory-storytelling` 驱动：自动选题、独立重看实图、写作、独立复核补丁、证据校验；`StoryStage` 支持跨图旁白、并排对照、留白和回看。话筒旁「听故事」进入，语音和文字也能触发。讲述按账户保存，人物、观察或用户补充变化后重听需重编；生成旁白不能回写成事实。新增存储规则遵循下方隐私版本要求。
- 4D 三维建模按 `skills/spacetime-modeling` 执行：单张照片只是 2.5D 浮雕，查看器相机固定在拍照位置、只许几度摆动、禁缩放、垫对齐的原照片；改重建方式要升 `RELIEF_VERSION`。分段与证据层是运行时 skill `spacetime-scene`。
- 界面风格是 Apple 液态玻璃，按 `skills/liquid-glass` 执行：顶栏、面板、弹层等控件层用玻璃，地图标签和照片属于内容层，不用玻璃。
- 界面保持静止：图标和标记不漂浮、不抖动，卡片悬停不位移。唯一例外是地球背后的星空（`.globe-sky`）：流星、飞碟、空间站是用户要的，属于内容层，`prefers-reduced-motion` 时不动。
- 地球永远是球体（不再展开成平面地图），交接给街区地图发生在更近处（`HANDOFF_ALTITUDE`），地球外没有光晕。街区地图本身也按球面弯曲（`src/map/planetCurve.ts`：离视野中心越远越下沉，低缩放时夸大曲率，13 级以上恢复真实值）；新增的 3D 材质自动带上曲率，手写着色器要引入 `PLANET_CURVE_GLSL`，DOM 标注用 `planetDrop` 贴地。
- StepFun 走 Step Plan 套餐：`STEPFUN_BASE_URL=https://api.stepfun.com/step_plan/v1`（`/v1` 扣账户余额）；套餐下语音识别是 `/audio/asr/sse`，见 `skills/stepfun-api`。
- 密钥只放 `.env`，由服务端读取；`.env`、`server/data/`、`data/`（用户照片）不入库。
- 用户的照片和记忆按账户存在服务电脑硬盘 `server/data/accounts/<账户>/`（`server/accountVault.mjs`）；浏览器 IndexedDB 只是缓存，清除后登录自动恢复。改动存储时同步修改隐私声明并升级 `PRIVACY_VERSION`（`server/users.mjs` 与 `PrivacyStatement.tsx` 两处）。
- 照片里的号码等敏感文字：用户同意隐私声明后原样显示，未同意时遮挡（服务端 `server/privacy.mjs` 兜底）。

## 验证

```powershell
npm run build
npm run test:api
npm run test:unit    # 时间刻度、重复照片分组等纯逻辑
npm run test:skills  # 每个 skill 的专门测试；LIVE=1 连接真实服务
npm run test:smoke   # 需先 npm run dev
npm run test:vault   # 清除浏览器数据后照片恢复；需先 npm run dev
npm run test:cull    # 整理重复照片：分组、排序、确认后删除；需先 npm run dev
npm run test:world   # 卡通世界：地球→全国→城市→街道的真实地图链路；需先 npm run dev
npm run test:spacetime  # 4D 时空场景：分段、证据、本机三维重建（有 ComfyUI + DA3 模型时）；需先 npm run dev
```
