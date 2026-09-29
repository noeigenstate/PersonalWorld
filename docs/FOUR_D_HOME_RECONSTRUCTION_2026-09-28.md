# 4D 时空场景：家中样本的实现契约

记录：2026-09-28。首个场景是用户指定的室内空间样本；本文不记录门牌、精确坐标、账户 ID 或原图文件名。这里的 4D 指同一空间在不同时间的可漫游状态，包含几何、原声、天气、交通和建筑状态，并保留各层证据。它不是把一张照片生成的想象画面称为历史现场。

## 已有能力与样本边界

- 全球入口已用 Three.js 地球仪承载照片坐标；点击地点或继续放大进入现有高德局部场景。底部时间轨道可拖动、点击和用键盘操作，目前按所选时间收敛照片。现有局部 3D 街区来自高德现时底图、OSM 足迹与程序造型，不代表历史街区快照。
- 本机账户照片库的元数据中，该空间目前仅有 **2 张原图，没有视频**。两张图能给时间与场景线索，不能可靠恢复可自由漫游的室内几何，也没有原声。第二时段的素材尚未指定。
- 电脑有 RTX 3090（24 GB 显存）和 FFmpeg；目前没有安装 COLMAP、Nerfstudio、PyTorch/gsplat。Nerfstudio 文档给出的普通 Splatfacto 显存量级约为 6 GB，大模型约 12 GB；实际可用显存随本机其他任务变化，训练前需实测。其 Windows 安装路径较脆弱，独立环境必须先用小型公开数据集验证。[Nerfstudio Splatfacto](https://docs.nerf.studio/nerfology/methods/splat.html)、[安装说明](https://docs.nerf.studio/quickstart/installation.html)。

## 一份时间状态，不是五条互不相干的效果

每个可回看的时间片 `epoch` 对应同一处室内空间的局部坐标系，拥有独立的 3D 模型和可选状态层。时间轨道只能停在有来源的时间片；没有素材覆盖的月份不插值出“当年的家具”或“当时路上有多少车”。相机位置在两个时间片之间尽量保持一致，方便比较变化；对齐失败时退回两个独立入口。

| 层 | 可作为历史证据的输入 | 缺失时的界面状态 |
| --- | --- | --- |
| 3D 几何 | 同一时段、同一房间、有重叠视角的走拍视频/照片；可选 LiDAR 深度与用户标注尺寸 | 保留原照片和当前地图，显示“尚无可信的可漫游模型” |
| 声音 | 原始视频音轨和拍摄时间；单独现场录音需用户确认时间与地点 | 静音；若以后提供氛围音，标为“演绎音效” |
| 天气 | 画面可见现象，或小时级历史再分析数据 | “未核实”；再分析值标“区域模型估计”而不是精确到这扇窗 |
| 交通 | 原视频里可见/可听车辆，或有授权的历史交通归档 | “历史交通未知”；不拿当前路况回填过去 |
| 建筑状态 | 带时间的原图/视频、蓝图/验收材料、用户确认的改动 | 沿用该时间片可见几何；不可见的旧楼和家具不推断为存在 |

每条状态都带 `sourceAssetIds`、来源类型、采集时间范围、可信级别与人工确认状态。`observed` 表示原始影像/声音直接支持，`external_model` 表示外部历史模型或资料，`inferred` 表示标出的推演，`unknown` 表示没有证据。事实更新时产生新 revision，不覆盖原始来源。

```ts
type Evidence = {
  kind: 'observed' | 'external_model' | 'inferred' | 'unknown'
  sourceAssetIds: string[]
  sourceUrl?: string
  capturedFrom?: string
  capturedTo?: string
  confirmedByUser?: boolean
}

type SceneEpoch = {
  id: string
  from: string
  to: string
  model?: { format: 'ply' | 'splat'; path: string; cameraPath: string; evidence: Evidence }
  audio: { path: string; from: string; to: string; evidence: Evidence }[]
  weather?: { code: number; cloudCover: number; precipitation: number; evidence: Evidence }
  traffic?: { state: 'unknown' | 'observed' | 'inferred'; evidence: Evidence }
  buildings: { id: string; validFrom?: string; validTo?: string; evidence: Evidence }[]
}
```

## 从新素材到可漫游时间片

1. **采集与准入**：将一次走拍或同一时段的重叠照片归为一个拍摄批次。保留原始时间、方向、GPS、音轨和哈希。先检查模糊、重复、覆盖角度与原图是否在账户 vault；不足则明确要求补拍，不启动昂贵训练。镜面、纯白墙、快速转身和走动人物会破坏几何，需要在验收里单独看。
2. **本地预处理**：FFmpeg 生成有原时间戳的抽帧与原声音轨，限制帧数和分辨率，保留原视频只读。使用 COLMAP 恢复相机姿态与稀疏点云；可选带深度的手机采集则走对应导入器。[COLMAP](https://colmap.github.io/)、[Nerfstudio 自有数据流程](https://docs.nerf.studio/quickstart/custom_dataset.html)。
3. **逐时段重建**：每个 `epoch` 独立运行 `ns-process-data video/images`、`ns-train splatfacto`，检查注册视角、留出视角和空间破洞，再以 `ns-export gaussian-splat` 导出浏览器可用的模型。相邻年份分别训练和对齐；不对没有记录的年份生成中间家具形态。[Splatfacto 导出](https://docs.nerf.studio/nerfology/methods/splat.html)。
4. **对齐与索引**：3D 模型使用房间局部米制坐标；地球/高德入口只用确认后的地点锚点连接到该模型。拍摄设备 GPS 通常不能决定室内厘米级位置，需用共享墙角、门窗等控制点或用户确认点对齐时间片。
5. **五层场景状态**：原声与当前时间片同步播放，未获用户交互前保持静音；天气只改变窗外光照、天空与可选雨声，不让室内下雨。小时天气可从 Open-Meteo 历史再分析取杭州城市级坐标，它是 9–25 km 网格的模型估计，需保存来源和时间区间；不发送精确家庭坐标。[Open-Meteo 历史天气说明](https://open-meteo.com/en/docs/historical-weather-api)。高德已查到的交通态势接口没有历史时间参数，因此不能据此声称得到 2025 年路况。[高德交通态势接口](https://lbs.amap.com/api/webservice/guide/api-advanced/traffic-situation-inquiry)。
6. **浏览器回看**：地球仪照片地点放大进入局部地图；若有该地点的已验收 `epoch`，显示“进入时空场景”。在单独的 3D 查看器中保持拖动、移动、缩放；时间轨道切换模型、声轨和状态层。每个图层有点开即可看到的来源，推演层始终可关闭。

## 工程落点与验收

| 改动位置 | 职责与可验收结果 |
| --- | --- |
| `src/types.ts`、`src/lib/spacetime.ts` | `SceneEpoch` / `Evidence` 类型、按时间选取可用时段、来源校验；缺失状态不会默认成事实 |
| `server/spacetimeJobs.mjs`、`scripts/reconstruct-scene.py` | 按账户和素材 ID 建有界后台任务；取消、重试、阶段进度、显存/超时限制；只有通过检验才发布模型 |
| `server/accountVault.mjs`、`server/index.mjs` | 在账户目录保存模型、音轨、manifest 与版本；认证读取、删除原素材时同步清理依赖，禁止跨账户访问 |
| `src/components/SpacetimeView.tsx`、`src/map/globeScene.ts`、`src/components/TimelineBar.tsx` | 地球 → 局部地点 → 4D 模型；时间切换时保留相机；来源标识和未知状态可见 |
| `src/components/PrivacyStatement.tsx`、`server/users.mjs` | 真正存储派生模型与音轨时同步更新隐私说明和两处 `PRIVACY_VERSION` |
| `tests/spacetime*.mjs` | 无资料不伪造场景；任务重启、账户隔离、过期结果、模型读回、声画时间、两个时间片切换及手机性能 |

第一条可交付链路的验收是：同一房间的一段合格走拍能生成 **一个** 可自由转动视角的模型，抽查至少三处视角对原视频中的墙、门窗和家具位置；原声能按原片时间播放；模型或素材不足时界面明确退回原图。第二个时间片只有在有第二次拍摄后才进入时间对比。天气、交通和建筑状态以来源标签分别验收，不把五层是否都存在作为单个模型训练是否成功的条件。

## 接下来的实际输入

需要该空间一次慢速、连续、覆盖目标房间的原始走拍，或一组互相重叠的多角度原图；若希望时间切换，还需另一日期拍摄的同一区域。尽量保留原文件和拍摄时间。当前两张原图仍保留在相册作为事件证据，不能代替新的多视角采集。
