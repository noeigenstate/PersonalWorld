# 专属地图资产入库清单

## 核查结论

拱墅运河体育公园、城北万象城、浙江环球中心的专属模型均已入库。以远端 `a422c55` 为核查基线，以下模型源码、地标注册数据和已有验收图此前就存在于 `origin/main`；本地对应模型源码与远端相同。

这些资产主要是 Three.js 程序化几何与材质：运行代码时构建建筑，不依赖另存的一份 GLB。它们可随代码仓库完整分发，暂时无需上传到云端才能使用。本轮推送补齐根目录 skills、最新功能及交付记录。

## 已有七个专属模型

| 地点 | 模型与匹配依据 | 实现与注册入口 |
|---|---|---|
| 拱墅运河体育公园曲棍球场「杭州伞」 | `gongshu-umbrella`；`osm:way:1084641014` | [landmarkVenues.ts](../src/map/landmarkVenues.ts)、[landmarkCatalog.ts](../src/map/landmarkCatalog.ts) |
| 拱墅运河体育公园体育馆「玉琮馆」 | `gongshu-jade`；`osm:way:1084641019` | 同上 |
| 杭州城北万象城商业体 | `chengbei-mall`；`osm:way:1311403409` | [publicLandmarks.ts](../src/map/publicLandmarks.ts)、[landmarkSites.json](../src/map/landmarkSites.json) |
| 润珹置地中心（城北万象城综合体） | `chengbei-tower`；`osm:way:1311403410` | 同上 |
| 浙江环球中心 | `zhejiang-global`；`osm:way:1446296034` | 同上 |
| 滘尾角灯塔（大陆南极地区） | `jiaowei-lighthouse`；`osm:node:8300174964` | 同上；轮廓、高度为公开资料支持的艺术近似，注册数据保留说明 |
| 上海东方明珠 | `createOrientalPearlScene`，地名与 POI 锚点 | [memoryScene.ts](../src/map/memoryScene.ts)、[上海街区快照](../src/map/data/shanghai-pearl.json) |

七个模型覆盖上述五处地点/综合体。不能把这个数量理解成全部照片区域都拥有独立精修模型；其余区域还会使用通用建筑、场地和主题元素。

## 一并入库的依赖与验收依据

- 地标识别、公开轮廓补充：[landmarkCatalog.ts](../src/map/landmarkCatalog.ts)、[landmarkSites.json](../src/map/landmarkSites.json)、[server/mapLandmarks.mjs](../server/mapLandmarks.mjs)。
- 街区组装、通用场馆与水面：[styledDistrict.ts](../src/map/styledDistrict.ts)、[venueArchitecture.ts](../src/map/venueArchitecture.ts)、[storybookWater.ts](../src/map/storybookWater.ts)。模型自身的几何、配色与材质代码随仓库保存。
- 开发流程：[地标精修 skill](../skills/landmark-refinement/SKILL.md)及其[完整工作流程](../skills/landmark-refinement/references/workflow.md)，地图整体流程见[地图风格化 skill](../skills/map-scene-styling/SKILL.md)。全部 13 个项目技能统一位于根目录 [skills/](../skills/README.md)。
- 独立模型检查入口：[场馆模型检查](../tests/venue-models.mjs)、[扩展地标检查](../tests/landmark-expansion.mjs)，对应 `npm run test:venues`、`npm run test:landmarks`。本次上传核查没有修改模型几何，也没有将此前截图冒充本轮重新渲染验收。
- 远端已有验收图：[体育公园](mockups/gongshu-park-refined-2026-09-26.png)、[杭州伞](mockups/gongshu-umbrella-refined-2026-09-26.png)、[玉琮馆](mockups/gongshu-jade-refined-2026-09-26.png)、[城北万象城](mockups/map-scene-chengbei-mixc-2026-09-27.png)、[环球中心所在街区](mockups/map-scene-westlake-square-2026-09-27.png)、[滘尾角灯塔](mockups/map-nanji-lighthouse-close-2026-09-27.png)。

## 与远端云端素材方案的关系

| 资源 | 当前保存与使用方式 | 本轮结论 |
|---|---|---|
| 上述专属模型、材质代码、公开注册数据 | Git 源码；浏览器构建 Three.js 对象 | 已在远端，继续随源码分发 |
| 场景周边的真实道路、建筑轮廓、湖河及园区边界 | 地理数据服务、OSM 数据及本地缓存；东方明珠另有已入库快照 | 并非所有地点的周边地理数据都已烘焙进仓库；数据缺失与模型未上传需分开检查 |
| 浙江/江苏 MBTiles 地理档案 | [manifest](../world-data/manifest.json)记录文件名、体积与 SHA-256；`WORLD_DATA_URL` 提供下载地址，二进制沿用忽略规则 | 本机未配置云端地址、未取得档案；现有在线回退已测试，不能声称云端下载已验证 |
| 全域地图绘制贴图 PNG | [生成脚本](../scripts/assets/generate-textures.mjs)输出到 `public/world-assets/textures/`；渲染器支持读取 | 脚本已在远端；本机与已核查远端文件树没有实际 PNG，当前下载清单也未包含 PNG |

云端读取与校验流程详见[素材使用与分发](../skills/map-scene-styling/references/material-assets.md)。本次保留远端素材实现，未用本地占位图替换。用户要求先把已有资产保存在代码库，现有程序化模型已满足；没有额外的本地模型文件等待搬运。

将来如导出 GLB、烘焙贴图或引入新的二进制资产，可按地点/版本列出文件、来源、许可和哈希，再接入云端清单与加载回退；确认下载后渲染一致，再调整仓库分发方式。源码与地标注册关系仍保留，确保资产可再生成和定位。

私人相册、身份库、导出 MP4、临时私有验收截图和密钥继续按项目约定保存在忽略目录，不属于这些可分发地图资产。

## 本轮交付状态

用户已明确要求先推送，避免远端继续变化增加合并成本。根目录 skills、回访地点卡片、持续理解、幻灯片更新和这份资产清单一并纳入本轮提交。已知手机窄屏回忆卡片被顶部/底部面板挤占的问题仍待修复，详见[技能交付记录](SKILLS_INVENTORY_2026-09-28.md)；本次核查并未声称该问题已解决。
