# Skills 上传核查与统一目录

## 核查结论

重新 fetch 后对照远端 `9baef95` 的 Git 文件树：本地 13 个项目 skill 的正文都已有远端版本，没有发现整份项目 skill 被忽略或只留在个人目录。

用户指出的问题有实际原因：6 个开发技能放在隐藏的 `.claude/skills/`；旧索引遗漏 `landmark-refinement` 与 `memory-identity`，地图风格的状态说明也过时。本轮修改的 `story-understanding` 与 `memory-film` 还没有随本轮实现推送。另有 3 个开发技能没有项目规范要求的专门 `test.mjs`。

根据用户明确要求，现统一迁移到根目录 `skills/`。入口见 [完整索引](../skills/README.md)，其中分别说明运行时和开发用途。迁移包含正文、参考资料、已有测试和可分发评估资源；没有复制个人工具安装目录。

## 完整清单

| 类型 | Skill | 本轮处理 |
|---|---|---|
| 开发 | [map-scene-styling](../skills/map-scene-styling/SKILL.md) | 迁到根目录，补专门测试、更新链接 |
| 开发 | [landmark-refinement](../skills/landmark-refinement/SKILL.md) | 迁移正文和工作流程，补索引、专门测试 |
| 开发 | [amap-threejs](../skills/amap-threejs/SKILL.md) | 连同已有对比评估迁移，保留远端新增的地形/地球规则，修正评估脚本路径 |
| 开发 | [memory-identity](../skills/memory-identity/SKILL.md) | 迁移并补索引、专门测试，同步当前身份关系和持续理解接线 |
| 开发 | [liquid-glass](../skills/liquid-glass/SKILL.md) | 连同审查脚本、截图、测试迁移，保留远端更新 |
| 开发 | [stepfun-api](../skills/stepfun-api/SKILL.md) | 连同语音辅助脚本、测试与已有评估迁移 |
| 运行时 | [event-analysis](../skills/event-analysis/SKILL.md) | 已在根目录和远端，保留 |
| 运行时 | [life-butler](../skills/life-butler/SKILL.md) | 已在根目录和远端，保留 |
| 运行时 | [photo-card](../skills/photo-card/SKILL.md) | 补空画面观察响应的接口回归 |
| 运行时 | [photo-context](../skills/photo-context/SKILL.md) | 已在根目录和远端，保留 |
| 运行时 | [photo-cull](../skills/photo-cull/SKILL.md) | 已在根目录和远端，保留 |
| 运行时 | [story-understanding](../skills/story-understanding/SKILL.md) | 提交逐图叙述、单图事件、已确认身份和事实范围约束 |
| 运行时 | [memory-film](../skills/memory-film/SKILL.md) | 提交回看对照、接触印样、内容主题装饰和人物范围校验 |

## 可执行交付

- `CLAUDE.md`、根 README、技能索引、源码注释及文档链接统一到新目录。旧交接文档保留历史路径，顶部明确指向现目录。
- `npm run test:skills` 从根目录运行全部专门测试，并检查技能目录、索引和相对引用，防止新增后再次漏列。
- 服务端继续明确调用既有 7 个运行时技能；目录迁移不会把地图开发文档自动交给模型执行。
- 特殊地标生成仍是可执行的开发流程。没有验证其他 agent 自动产生同等质量，也没有声称已实现运行时任意地标自动生产。
- 本轮地图回访卡片、持续理解和幻灯片实现、测试与文档一并提交，详见 [持续理解交付](CONTINUOUS_MEMORY_SYNC_2026-09-28.md)。

私人相册、身份库、原图、导出 MP4、临时私有验收截图、`.env` 和本地缓存沿用忽略规则。它们没有被当作可分发 skill 素材上传；本地导出仍可查看。

## 远端素材整合

核查期间远端更新到 `a422c55`。已先合入地球、连续缩放和卡通地理层，再无冲突地合入浙江/江苏地图档案清单与表面贴图代码。素材代码、调色、生成脚本和清单保持远端版本，本地技能迁移不替换这些资源。

`map-scene-styling` 现在引用[素材使用与分发流程](../skills/map-scene-styling/references/material-assets.md)。本机缺少 `WORLD_DATA_URL`、MBTiles 和生成后的 PNG；实际测试因此覆盖在线地理数据与程序化材质回退，不能作为云端贴图效果验收。当前自动下载清单只有 MBTiles，PNG 托管地址尚未提供。

本地验证：13 份 skill 格式检查通过；`test:skills` 43 项通过、8 项真实服务用例按默认跳过；构建、API、持续同步回归、浏览器 smoke 通过。远端卡通地图 `test:world` 通过，全国/城市/街道截图已查看；既有照片地点的地图入口另行验证。没有用素材缺失时的截图声称已经完成素材部署。

## 推送前停止点

按用户“冲突及时停下来评估”的要求，当前尚未推送：整合后的真实相册检查在桌面逐行进入杭州 18 个事件成功，但切为 390×844 后，城市回忆卡片可见数变为 0。新地图界面的顶部功能区与底部管家同时占用视口；此时的标签避让与卡片高度不兼容。需要决定缩减顶部功能区、收起管家还是另行调整手机布局后再推送。

截图保存在忽略目录：`data/exports/map-event-stack-revisit.png`（桌面）及 `data/exports/map-event-stack-mobile.png`（手机）。远端素材相关的 `cartoonWorld.ts`、`cartoonPalette.ts`、`cartoonTiles.mjs`、`worldData.mjs`、贴图生成脚本和地理清单与 `origin/main` 一致。本轮没有凭缺失素材的状态改写这些文件。
