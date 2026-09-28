# 人生地图场景风格化：技术路线与比赛取舍

2026-09-25。基于当前上海街区级高德画面、伙伴提出的“奶油色玩具世界／给建筑贴图”和 [风格目标图](mockups/map-style-direction-2026-09-25.png) 制定。目标图是生成的美术参照，不是已实现的地图，也不能作为地标几何或道路位置的证据。

## 产品判断

Personal World 的核心是**从照片重建有证据的事件，再把事件投影到时间和空间，并允许用户与这份记忆对话、纠错**。地图的职责是让这件事一眼可见。统一的卡通风格有展示价值：它能把“另一张带照片钉子的地图”变成一个可探索的个人世界，增强第一眼的辨识度和情绪记忆。但一城所有楼宇的精细贴图，与事件、证据、用户确认之间没有直接关系，不能替代照片线索串联和管家的可信回答。

比赛演示建议把视觉投入集中在**一处真实去过的地点**：从照片线索定位 → Agent 根据照片和用户偏好生成有依据的场景方案 → 用户看到该地点变成个人记忆场景 → 点回事件、照片与推断依据。这样地图风格化是 Agent 完成任务的结果，而不只是一层静态皮肤。公开的[第三届 DGX Spark 黑客松介绍](https://awnchina.cn/3rd-nvidia-dgx-spark-hackathon-%C2%B7-agent-skills-development-challenge/)将主题描述为 Agent Skills；具体评分项和运行要求仍应以举办方给队伍的规则为准。

| 工作 | 对核心价值的贡献 | 比赛前取舍 |
|---|---|---|
| 照片线索串联、证据与确认 | 证明系统真的能从零散照片还原事件和地点 | 首要，必须跑通一条真实演示链 |
| 地图与界面统一的卡通语言 | 让观众迅速理解“可探索的人生世界”，改善目前白膜观感 | 做一版完整但克制的风格 |
| 照片驱动的地点记忆小景 Agent skill | 展示 Agent 将个人资料变成可交互场景，兼具技术和情绪记忆点 | 选一处地点做完整闭环 |
| 华东所有楼宇逐栋随机贴图 | 外观工作量大，对“为什么是这个人的世界”解释弱 | 比赛前不作为主线 |

目标演示可以是：一张缺 GPS 的照片通过地标或其他照片找回地点；信息卡显示依据；Agent 给该地点生成与照片线索、用户偏好相关的场景方案；地图只在这个记忆锚点精细化；点回照片和事件能核对来源。静态概念图无法替代这个可操作过程。

## 技术事实与边界

| 层 | 当前可用能力 | 对目标画面的作用与边界 |
|---|---|---|
| 高德底图 | JS API 2.0 支持官方主题，或在自定义地图平台创建并**发布**样式 ID；可配置道路、水、绿地、天空、建筑等元素 | 先统一整张地图的色彩、线宽、标签和留白。当前 `macaron` 仍保留标准街道语言；新的自定义样式需要平台上的样式 ID。[自定义样式教程](https://lbs.amap.com/api/maps-javascript-api/guide/map/map-style)、[平台能力](https://lbs.amap.com/product/mapstyle/m) |
| 高德 `Buildings` | 可设墙／顶颜色、高度系数、透明度；`setStyle` 可按围栏区域改色或隐藏 | 保留有地理依据的楼块轮廓，适合做背景体量。公开 API 没有逐栋楼 ID、UV 或逐栋贴图接口，改色仍会呈现“白膜”的形体。[楼块 API](https://lbs.amap.com/api/maps-javascript-api/reference/layer/buildings) |
| 高德自定义纹理 | 平台产品页称可配置部分地图元素纹理；较早的 JS API 2.0 升级指南写明“暂不支持自定义纹理” | 两份官方材料存在版本／产品边界差异。拿到实际发布的样式 ID 后在**本项目 JS API 2.0** 实测，再决定能否依赖网页端贴图；现阶段不把它当作已可用功能。[平台说明](https://lbs.amap.com/product/mapstyle/m)、[升级指南](https://lbs.amap.com/api/javascript-api-v2/update) |
| 独立 Three.js 画布 | 当前 `src/map/amapScene.ts` 已通过高德相机同步叠加 Three.js | 可画特定地点的玩具建筑、招牌、树木和材质。与高德画布**不共享深度缓冲**，定制建筑占用的区域需隐藏或避开原生楼块，实测遮挡关系。现有 [amap-threejs skill](../skills/amap-threejs/SKILL.md) 记录了同步与坐标规则。 |
| 开放街区轮廓 | [OpenStreetMap API](https://wiki.openstreetmap.org/wiki/Api06) 可按小范围取得建筑、道路、水面、绿地；数据受 [ODbL](https://www.openstreetmap.org/copyright) 约束 | 上海东方明珠周边已取得可用静态样本，可支撑一块完整的卡通街区。绝大多数楼没有高度，立面与屋顶仍需要艺术生成；覆盖范围不足以直接推至整个华东。 |
| 自有矢量地图引擎 | MapLibre 支持按要素的 3D 拉伸图案、圆角等 | 只有连同合法可用、覆盖足够的建筑轮廓和高度数据一起接入才有意义；不能直接把高德内部瓦片当成自有数据源。它是长期可控路线，本次不为贴图重写地图底座。[MapLibre 样式规范](https://maplibre.org/maplibre-style-spec/layers/) |

参考 `F:\future\digital_new_rome` 的地球样本实测：俯瞰轮廓可辨并不证明近景立面质量；纹理丰富也不会补出几何与位置。这里应分别验收全国／城市概览、街区俯瞰、照片地点近景，并区分真实地理与艺术装饰。

## 建议的画面结构

第一版的可讨论色板（需要在真实高德底图中逐项比对，不代表平台已经发布）：

| 用途 | 候选色 |
|---|---|
| 陆地／画布 | `#F6F0E3` |
| 水系 | `#7CCDD9` |
| 绿地 | `#ADD7A6` |
| 主路／次路 | `#FFF9E9`／`#F1DCD0` |
| 背景楼顶／墙面 | `#FBEAD8`／`#DDBFAE` |
| 记忆锚点点缀 | 草莓粉 `#E7A0AC`、薄荷 `#A9D7C0`、淡紫 `#CFBCE7` |
| 正文／故事线 | `#403B39`／`#E77E45` |

1. **全局底图与界面同一语言。** 固定少量奶油白、草莓粉、薄荷绿、湖蓝与深墨色；道路和水系先于建筑上色，地图卡片、时间线、照片标记沿用同一套色彩和圆角。保证故事线、地点和照片仍比装饰更醒目。
2. **背景建筑保持克制。** Native Buildings 承担城市体量；可按照片到访区域设置少量色块变化。不要随机给每栋楼放水果、蛋糕或不相干的房顶：这会削弱地图辨认能力，也无法说明“为什么是我的人生世界”。
3. **在少数记忆锚点做精细玩具场景。** 先选一个华东样本地点。照片或用户确认能证明的地标保留识别性轮廓；Agent 从照片取色彩和装饰线索，输出有来源的场景方案。没有建筑轮廓／高度资料时，只做明确的“记忆小景”而不假装还原每栋真实楼。
4. **跨缩放级别保持语义。** 远看是人生据点和迁徙；中景是该城市的故事线；近看才出现材质与小物。美术细节随缩放出现，不让街区密度淹没照片和事件。

## 场景层试作（2026-09-25）

已接入当前 Web 地图。直接手动放大到华东照片地点会自动显示小景，放大到东方明珠附近会显示简化塔模型；地图左上角「查看上海地标样例」可直接跳到该处，无需照片信息卡。左上角「3D 记忆场景」可切换。同一镜头下，[关闭时的高德原生楼块](mockups/map-scene-live-before-2026-09-25.png)与[打开后的真实浏览器截图](mockups/map-scene-live-after-2026-09-25.png)可以直接比较；另有[不依赖照片卡的上海样例](mockups/map-scene-live-shanghai-preview-2026-09-25.png)、[滚轮缩小再放大后自动恢复的场景](mockups/map-scene-live-manual-zoom-2026-09-25.png)、[普通华东照片地点的小景](mockups/map-scene-live-generic-2026-09-25.png)和[手机宽度截图](mockups/map-scene-live-mobile-2026-09-25.png)。这些是 Playwright 测试影像产生的真实渲染截图，区别于上面的生成式目标图。

- 底图改用高德 `fresh` 主题并关掉原生标签；项目自己的城市、事件、照片标签继续显示。地图页导航、卡片、时间线用同一组暖色。道路、水系的精确配色仍受官方主题限制，没有发布自定义样式 ID。
- `src/map/memoryScene.ts` 提供按照片选择的小景，以及高德公开 POI 坐标上的东方明珠示意模型。照片卡或 GPS 邻近地点识别到该地标时可显示；没有照片时，用户也能在地图上放大到该地标或点样例按钮查看。其他华东地点仍使用带窗户、屋顶、树木的示意小景，并在地图上明确标注装饰属性。[东方明珠高德地点页](https://ditu.amap.com/place/B00150F6D6)。
- `src/map/amapScene.ts` 将小景锚定在照片地点或公开地标 POI，用高德相机同步 Three.js；地图缩放／拖动结束后挑选视角附近的一处场景，局部隐藏会碰撞的原生楼块，附近原生楼块分区上色。开关关闭后恢复原生楼块供对比。地图拖动、缩放、照片点击均保持可用。
- `npm run build` 和 `npm run test:amap` 通过。后者覆盖普通华东照片、东方明珠地标、场景开关与拖动跟随。此轮仍是场景层试作，尚未把 Agent 输出的 `sceneRecipe` 接入运行时。

## 东方明珠完整街区样本（第二轮）

在上述地标小景外，上海样本又加了一块实际可运行的卡通街区：[桌面实测](mockups/map-scene-district-shanghai-2026-09-25.png)、[手机实测](mockups/map-scene-district-mobile-2026-09-25.png)。与[生成式概念图](mockups/map-style-direction-2026-09-25.png)相比，街区轮廓、立面窗格、道路／水面／绿地颜色已接近同一画面语言；概念图中的柔和光影、丰富屋顶和局部几何仍有差距。截图不是生成图。

- `scripts/extract_shanghai_scene.py` 从 OSM 官方 API 截取 WGS84 边界 `121.486,31.234,121.505,31.251`，简化为 `src/map/data/shanghai-pearl.json`。本次快照含 321 个建筑轮廓、927 段道路、11 块水面、68 块绿地。复现需要 Python `shapely`。项目只打包此小样本，不在用户浏览时请求 OSM API。
- `src/map/styledDistrict.ts` 在浏览器内把轮廓从 WGS84 转成高德 GCJ02，再用同一相机叠加。楼体使用 6 组奶油色立面窗格和屋顶；道路、水、绿地、树木、水纹和阴影单独生成。缺高度的楼按稳定规则估计，为了美术效果而非真实三维测绘。除轮廓、道路和水绿地外，窗户、树、屋顶细节均是示意。
- 场景显示时隐藏这片区域的高德原生楼块，周边原生地图继续运行；关闭「3D 记忆场景」即可对照。页面在样本显示时持续标出 `© OpenStreetMap contributors · ODbL`，源数据许可见[OSM 版权页](https://www.openstreetmap.org/copyright)。
- `npm run build`、`npm run test:amap` 与桌面／手机浏览器截图已验证。测试覆盖样本预览、缩放离开并返回、场景开关、照片点击和拖动。此轮范围只限这个上海样本；后续的照片区域自动生成见下节。

## 照片区域自动场景（第三轮）

街道级或更精确的照片按约 450 米聚为到访区域。用户聚焦照片或手动放大到其附近时，浏览器将区域中心从高德 GCJ02 转回 WGS84；本机 `POST /api/map-scene` 按中心截取约 1.8 公里见方的地理轮廓。服务端从 OpenFreeMap 的 OpenStreetMap／OpenMapTiles 矢量瓦片读取建筑、道路、水域、草木覆盖和用地，裁剪后缓存 7 天。区域之间分别生成，照片和事件内容不发送给瓦片服务。源站及署名方式见 [OpenFreeMap 官方说明](https://openfreemap.org/)。

- `src/map/regionScene.ts` 负责区域聚合及坐标转换；`server/mapScene.mjs` 读取和裁剪瓦片；`src/map/styledDistrict.ts` 对所有区域复用材质系统。地理类型由已有水体、海面、绿地和建筑轮廓判断：水岸、海岸、公园或一般街区。学校、医院等用地另有轻微色彩区分，不虚构活动主题。
- 东方明珠继续使用精修的 OSM 快照和专属塔模型。其他区域没有已证实的地标造型时，照片地点显示统一的中性记忆锚点；建筑仍按当地真实足迹生成。若瓦片建筑轮廓少于 100 个，则保留高德原生 3D 楼体，以免少量开放数据让整片街区变空。只有城市／区县级定位时只显示标明为示意的地点锚点。瓦片暂时不可用时也保留原生地图和锚点。
- 动态区域在地图上显示 `© OpenMapTiles` 和 `© OpenStreetMap contributors · ODbL`；上海精修快照显示 OSM 署名。卡通楼高的缺失值、立面、屋顶、车辆及增补树木依旧是艺术推断。运行时无 Python／Shapely 依赖；它们只用于复现上海快照。
- [杭州真实浏览器截图](mockups/map-scene-region-hangzhou-2026-09-25.png)与[武汉真实浏览器截图](mockups/map-scene-region-wuhan-2026-09-25.png)展示两个不同的照片区域。`npm run test:amap` 覆盖杭州、武汉及东方明珠三种入口与地图交互。不同地方的开放建筑资料密度差异很大，尚未让 Agent 从照片自动生成海滩、课堂等主题物件；当前的差异来自真实地理轮廓和用地类别。

## 可参赛的运行时 skill：`memory-scene-style`（拟议，尚未接入）

**输入：** 已确认或标明精度的地点、事件与照片线索、用户明确的风格偏好、可用几何数据清单。照片走现有隐私同意与服务端调用流程。

**输出：** 受约束的 `sceneRecipe`：底图主题／色板、被选中的少数锚点、每个装饰的素材与依据、预设材质 ID、几何来源与坐标精度。没有来源的地标形状和精确位置留空；纯装饰标为创作。渲染器按稳定 ID 与预设生成纹理和模型，Agent 不直接写 WebGL 代码或遍历全城随机装饰。

**可展示的闭环：** 同一地点的原图与风格化切换；选中一处变化可追溯到照片线索或用户偏好；用户改偏好后重新生成方案，照片事件与地理定位保持一致。衡量它是否值得做，取决于演示者能否在几十秒内说明“这处场景为什么属于这个人”。

## 后续实施范围

1. 在高德自定义地图平台发布一版统一的道路、水、绿地、标签与天空样式，取得样式 ID 后在当前 JS API 2.0 实测。现有官方 `fresh` 主题只是过渡，不能达到目标图的全部配色和街道表现。
2. 为更多真实照片地点获取可用的建筑轮廓、高度或地标素材，再绘制保留识别性的定制模型。现有普通地点小景明确是艺术示意，不应用来核对真实楼宇。
3. 测试手机帧率和更多俯仰角，确认地标与周围楼块遮挡稳定；再将照片证据、偏好和材质选择接到运行时 Agent skill，让视觉变化可解释、可再生成。

此路线把“完整华东楼宇逐栋贴图”留作后续扩展；它需要可授权的建筑轮廓／高度数据、分块加载、遮挡处理和持续的性能验证。

## 目标图的生成方式

使用内置 `imagegen`，以真实上海地图测试截图为编辑目标。提示词如下；生成结果可能改变局部建筑与标注，因此只用来讨论风格，不用于地理核对。

> Use case: style-transfer. Asset type: visual art-direction concept for the existing Personal World web map, not a claim of implemented UI. Edit the attached map screenshot. Keep the same wide 1440x900 composition, river course, road layout, oblique camera angle, photo marker positions, top bar, left information panel, and bottom timeline placement. Transform the map scene into a coherent handcrafted fondant / toy-diorama city. The river becomes soft turquoise glazed water with subtle illustrated ripples; roads become warm ivory ribbons with clear hierarchy; parks become textured mint green felt with a few tiny rounded trees. Preserve each building's distinct massing and location while replacing plain beige blocks with varied but restrained confectionery facades: pastel cream, peach, strawberry pink, pistachio and pale lavender, visible window rhythm, doors, parapets, roof details, softly rounded edge highlights and gentle ambient shadows. Add small candy or fruit-like accents only on a few selected buildings near photo locations, not randomly on every building; a recognizable cartoon tower silhouette can stand near the central photo marker. The result should still read as a usable geographic map, not a dense fantasy illustration. Carry the same palette into the visible interface chrome with softer rounded panel edges and warm accents, while keeping text areas clean and legible. No added brand logos, no giant decorations, no extra map pins, no invented factual labels. This is a concept mockup; prioritize spatial fidelity and visual cohesion.
