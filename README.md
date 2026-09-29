<div align="center">
  <img src="docs/media/logo.svg" alt="Personal World" width="88" />
  <h1>Personal World · 人生地图</h1>
  <p><strong>让照片，讲出生活的故事。</strong></p>
  <p>把散落的照片、视频和截图整理成事件，在一颗卡通地球上重新走一遍——用声音问，让它带你回看。</p>
  <p>
    <a href="#功能">功能</a> ·
    <a href="#快速开始">快速开始</a> ·
    <a href="#配置">配置</a> ·
    <a href="#文档">文档</a> ·
    <a href="docs/需求说明书.html">需求说明书</a>
  </p>
  <p>
    <img src="https://img.shields.io/badge/Node-24-339933?logo=nodedotjs&logoColor=white" alt="Node 24" />
    <img src="https://img.shields.io/badge/React-19-61dafb?logo=react&logoColor=white" alt="React 19" />
    <img src="https://img.shields.io/badge/Three.js-WebGL-000000?logo=threedotjs&logoColor=white" alt="Three.js" />
    <img src="https://img.shields.io/badge/AI-StepFun-2f6bff" alt="StepFun" />
    <img src="https://img.shields.io/badge/数据-留在本机-2f9e5c" alt="数据留在本机" />
  </p>
</div>

![从地球连续放大到街区：整张地图都是按真实地理"卡通化"出来的](docs/media/hero.gif)

<sub>演示用 AI 生成的虚构照片录制，没有任何真实的私人照片。地图、时间线、缩放与三维重建都是真实运行；语音识别、管家的回答和时空场景的分段为固定脚本（保证录制可重复）。</sub>

## 它做什么

| 记录 | 理解 | 回看 |
| :--- | :--- | :--- |
| 导入照片，读取时间与 GPS，自动整理成事件 | 生成信息卡、认出人物、串起故事；事实与推断分开，每条推断都标来源 | 地图与时间线、语音管家、边看边讲、回忆短片、4D 时空场景 |

**事件优先**：不从时间或空间出发，先确定"发生了什么事"，再从事件分离出时间线和空间线。地点的分量来自发生的事，而不是照片的数量。

## 功能

### 一颗连续缩放的卡通世界

地球始终是球体，滚轮或双指一路放大到街区，中间没有切换和跳变；街区地图同样按球面弯曲。地面不是卫星图，而是按 OpenStreetMap 的真实海岸、河流、道路和建筑轮廓生成的卡通世界：凸起的陆地与岩石断崖、松树和圆树、红蓝屋顶、斑马线与红绿灯。地图数据在本机构建并持久化，草地、水面、屋顶等贴图由本机模型绘制。

### 故事线与时间线

![点击地点进入故事线，拖动时间线，地图上的照片随时间收敛](docs/media/story.gif)

点击地图上的地点，出现这个地方的故事线：照片、日期和事件标题合在同一张卡片里，常去地点的多次回忆分行展示。停留超过半年且有 3 件以上事的城市成为人生据点，按迁徙顺序连成空间线。底部时间线可拖动、点击和键盘操作。

### 会操作地图的人生管家

![按住话筒提问：字幕、带标记的推断、照片上台](docs/media/butler.gif)

没有聊天面板，地图上只有一个话筒（也可以打字）。按住说话时字幕实时出现；回答以字幕显示并朗读，**推断的内容带虚线下划线**。管家会直接操作地图：按语义找照片、定位到拍摄的地方、讲一段经历并配幻灯片、记下据点角色、拨动时间线，以及打开人物与故事、时空场景和回忆短片。「听故事」会自动选题、独立重看照片、写作，再经独立复核和证据校验，边放照片边讲。

### 4D 时空场景：同一个地方，不同的时候

![同一地点分成两个时段，逐层标注证据，关键照片在本机 GPU 上重建成可环视的三维浮雕](docs/media/spacetime.gif)

同一地点的照片按有依据的时间片分段；季节、时段、天气、建筑、声音、交通逐层标出 **照片可见 / 推断 / 无依据**——没有证据的层不编造，也不在两个时段之间插值。时段里的任何一张照片都可以在本机 GPU 上用 Depth Anything 3 重建成三维浮雕（约 10 秒一张，GIF 里剪掉了等待），在拍照的位置轻轻晃动就能看到视差；模型和照片一起存在账户目录。**一张照片没法 360° 环绕**——背面没有信息；要环绕查看，需要在同一个地方绕着拍的视频或多张视角重叠的照片，这条路径还没有接到界面，实测结论和准入条件见 [4D 建模 skill](skills/spacetime-modeling/SKILL.md) 与 [4D 实现契约](docs/FOUR_D_HOME_RECONSTRUCTION_2026-09-28.md)。

### 还有这些

- **照片信息卡**：程序读到的事实（时间及来源、定位、尺寸）与模型看到的画面、可读文字、带依据的线索、地标和待确认问题分开显示。
- **定位，越细越好**：先用照片自带的 GPS 和元数据，再用画面里的地标、路牌、店名，最后与其他照片对比补全；每个地点都标明来源和精确程度，推断的位置用虚线。
- **人物与故事**：人脸分组，由你确认称呼和关系，绑定到稳定的人物 ID；名字或关系变化后，相关经历自动重新理解。
- **回忆短片**：自动选片、字幕和镜头编排，用本机 FFmpeg 合成 MP4，不需要写创意。
- **整理重复照片**：相似的照片叠在一起，推荐留下最好的几张，你确认后才删除。
- **隐私**：照片和记忆按账户存在你自己电脑的硬盘上；号码等敏感文字在你同意隐私声明后才原样显示，否则遮挡。

<details>
<summary><strong>专属地标模型</strong> · 拱墅运河体育公园、城北万象城、浙江环球中心等 7 处</summary>

<table>
  <tr>
    <td><img src="docs/media/landmark-umbrella.webp" alt="杭州伞" width="100%" /></td>
    <td><img src="docs/media/landmark-jade.webp" alt="玉琮馆" width="100%" /></td>
  </tr>
  <tr><td align="center">拱墅运河体育公园 · 杭州伞</td><td align="center">玉琮馆</td></tr>
  <tr>
    <td><img src="docs/media/landmark-mixc.webp" alt="城北万象城" width="100%" /></td>
    <td><img src="docs/media/landmark-global.webp" alt="浙江环球中心" width="100%" /></td>
  </tr>
  <tr><td align="center">杭州城北万象城与润珹置地中心</td><td align="center">浙江环球中心</td></tr>
</table>

![专属地标模型检视](docs/media/landmark-models.webp)

这些是按真实建筑轮廓和公开资料手工制作的程序化模型，其余地点使用通用建筑。清单和边界见[专属地标资产清单](docs/LANDMARK_ASSET_INVENTORY_2026-09-28.md)。

</details>

<details>
<summary><strong>更多画面</strong> · 地球总览、街区、故事线、管家与时空场景</summary>

<table>
  <tr>
    <td><img src="docs/media/globe.webp" alt="地球总览" width="100%" /></td>
    <td><img src="docs/media/street.webp" alt="街区的卡通世界" width="100%" /></td>
  </tr>
  <tr><td align="center">地球总览：照片按位置成组</td><td align="center">街区：真实建筑轮廓与树木</td></tr>
  <tr>
    <td><img src="docs/media/story.webp" alt="故事线" width="100%" /></td>
    <td><img src="docs/media/butler.webp" alt="人生管家" width="100%" /></td>
  </tr>
  <tr><td align="center">上海的故事线</td><td align="center">人生管家：字幕、推断标记、照片上台</td></tr>
  <tr>
    <td><img src="docs/media/spacetime-epochs.webp" alt="时空场景的时间片与证据" width="100%" /></td>
    <td><img src="docs/media/relief.webp" alt="三维浮雕" width="100%" /></td>
  </tr>
  <tr><td align="center">时空场景：时间片与逐层证据</td><td align="center">同一张照片的三维浮雕</td></tr>
</table>

</details>

## 快速开始

需要 **Node.js 24**（≥ 22.5，服务端用 `node:sqlite` 读取地图档案）。

```powershell
git clone https://github.com/noeigenstate/PersonalWorld.git
cd PersonalWorld
npm install
copy .env.example .env    # 填入 StepFun 和高德的密钥，见下表
npm run dev               # 打开 http://localhost:5183/
```

第一次启动时，服务端会按 `world-data/manifest.json` 里的链接在后台下载地图档案（浙江 + 江苏，558 MB，校验 SHA-256），下载完成前地图使用在线数据。打开网页先注册账户并同意隐私声明，然后导入照片。

<details>
<summary><strong>可选组件</strong> · 语音以外的本机能力</summary>

| 组件 | 用途 | 说明 |
| --- | --- | --- |
| Python 3.12 + FFmpeg | 人物识别、回忆短片合成 | `winget install Python.Python.3.12 Gyan.FFmpeg`，再 `python -m pip install -r server/requirements-local.txt`、`python server/identity/setup_models.py`；Windows 上要在 `.env` 写完整路径，见 `.env.example` |
| ComfyUI + Depth Anything 3 | 4D 时空场景的三维重建 | 运行 ComfyUI（默认 `http://127.0.0.1:8188`），在 `models/geometry_estimation/` 放 [`depth_anything_3_mono_large.safetensors`](https://huggingface.co/Comfy-Org/Depth-Anything-3)（1.3 GB，Apache-2.0）；没有时只显示照片和各层证据 |
| Java 23 + Planetiler | 自己构建新地区的地图档案 | `npm run build:osm <地区>`，源数据见 `scripts/build-osm-region.mjs` |
| Chrome | 浏览器测试、录制演示 | `npm run test:smoke` 等 |

</details>

<details>
<summary><strong>局域网访问</strong> · 手机或其他电脑打开</summary>

```powershell
npm run dev:lan
```

用自签名证书的 HTTPS 监听局域网，其他设备打开 `https://<这台电脑的局域网 IP>:5183/`，第一次选择"继续访问"。必须用 `https://`：在 `http://192.168.x.x` 下浏览器会禁用麦克风和 SHA-256，说话和导入照片都会失败。API 服务仍只监听本机。

</details>

## 配置

密钥只放本机的 `.env`，由服务端读取，不进浏览器、不入库。

| 字段 | 用途 | 必填 |
| --- | --- | --- |
| `STEPFUN_API_KEY`、`STEPFUN_MODEL` | 照片信息卡、事件分析、人生管家、讲述、时空场景分段（模型需支持图片，如 `step-3.7-flash`） | 用 AI 时 |
| `STEPFUN_BASE_URL` | 默认 `https://api.stepfun.com/step_plan/v1`（走 Step Plan 套餐）；改成 `/v1` 会扣账户余额 | 否 |
| `AMAP_JS_KEY`、`AMAP_JS_SECURITY_CODE` | 高德 JS API：地图相机与缩放，以及把照片 GPS 识别成城市；安全密钥经本机代理，不进浏览器 | 用真实地图时 |
| `COMFY_URL` | 本机 ComfyUI 地址，默认 `http://127.0.0.1:8188` | 否 |
| `WORLD_DATA_URL` | 地图档案的备用下载模板；manifest 里已有链接的文件不需要 | 否 |

其余可选项（语音模型、讲述写作模型、Python 与 FFmpeg 路径、导出目录）见 [`.env.example`](.env.example)。修改后重启 `npm run dev`。

**换电脑**：把整个 `server/data/` 拷到新机器同一位置即可，用原来的用户名密码登录，照片和记忆会自动恢复；`map-scenes/`、`cartoon-tiles/` 是缓存，可以不带。细节见[功能说明与数据细节](docs/FEATURES.md)。

## 项目结构

```text
src/map/        地球（globeScene）、卡通世界（cartoonWorld）、高德相机（amapScene）、专属地标
src/components/ 界面：话筒管家、故事舞台、时空场景、人物与故事……
server/         API：账户与照片库（accountVault）、管家、讲述、时空场景、地图瓦片、回忆短片
skills/         16 个项目技能：9 个由服务端读取的运行时技能，7 个开发技能，各有 test.mjs
world-data/     地图档案清单（档案本身在 Seafile，不入库）
scripts/        构建地图档案、生成贴图与示例照片、录制本页的 GIF
docs/           需求说明书、功能说明、各阶段设计与验收记录
```

## 文档

| 想了解 | 从这里开始 |
| --- | --- |
| 产品定位与交互 | [需求说明书](docs/需求说明书.html) |
| 完整功能流程、账户与数据、已知边界 | [功能说明与数据细节](docs/FEATURES.md) |
| 技能（运行时与开发） | [skills/README](skills/README.md) |
| 边看边讲 | [讲述实施与验收](docs/STORYTELLING_2026-09-29.md) |
| 持续理解与人物 | [持续理解](docs/CONTINUOUS_UNDERSTANDING_2026-09-28.md) · [演进式记忆架构](docs/EVOLVING_MEMORY_ARCHITECTURE_2026-09-28.md) |
| 4D 时空场景 | [实现契约](docs/FOUR_D_HOME_RECONSTRUCTION_2026-09-28.md) |
| 地图风格与地标 | [场景风格](docs/MAP_SCENE_STYLE_2026-09-25.md) · [地标资产清单](docs/LANDMARK_ASSET_INVENTORY_2026-09-28.md) |
| 参赛材料 | [演示脚本与交付计划](docs/SUBMISSION_DEMO_2026-09-30.md) · [参赛历程](docs/PARTICIPATION_STORY_2026-09-28.md) |

## 验证

```powershell
npm run build
npm run test:api       # 模拟 StepFun 与高德，检查所有接口
npm run test:unit      # 时间刻度、重复照片分组等纯逻辑
npm run test:skills    # 每个 skill 的专门测试；LIVE=1 连接真实服务
npm run test:smoke     # 需先 npm run dev；虚构相册走完注册→导入→分析→地图→故事线→语音
npm run test:world     # 需先 npm run dev；地球→全国→城市→街道的卡通世界
npm run test:spacetime # 需先 npm run dev；时空场景，本机有 ComfyUI 时真实重建
```

全部命令见[功能说明与数据细节](docs/FEATURES.md#验证)。浏览器测试需要本机 Chrome，使用独立会话，不改你日常浏览器里的数据。本页的 GIF 由 `node scripts/record-readme-media.mjs` 录制。

## 已知边界

- 原始视频的内容理解和可 360° 环绕的 4D 重建尚未实现；现在的时空场景是单张照片的浮雕（只能在拍照位置轻晃），回忆短片由照片合成。
- 模型的解释可能不准确，不能代替你的确认；跨月照片不会被自动解释成成长里程碑。
- 特殊建筑的精修来自专属模型和人工验收，不保证任意地点自动达到这个精度；地理资料少的地方保留原生建筑。
- 微信、QQ 发来的非原图不含拍摄时间和定位，程序无法恢复；请用原图导入。

## 许可

[MIT](LICENSE)。地图数据、模型与第三方服务各有自己的许可，见下。

## 致谢与数据来源

地图数据 © [OpenStreetMap](https://www.openstreetmap.org/copyright) 贡献者（ODbL），瓦片按 [OpenMapTiles](https://openmaptiles.org/) 模式由 [Planetiler](https://github.com/onthegomap/planetiler) 在本机构建；地球轮廓来自 [Natural Earth](https://www.naturalearthdata.com/)（公有领域）；地图相机使用高德开放平台 JS API；AI 能力来自 StepFun；贴图与演示照片由本机的 Qwen-Image 生成，三维重建使用 [Depth Anything 3](https://github.com/ByteDance-Seed/Depth-Anything-3)。
