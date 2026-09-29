# 浮雕管线与实验

## 接线

| 文件 | 用途 |
|---|---|
| `server/spacetimeScene.mjs` | `reliefCapability`（探测 ComfyUI 与模型）、`reconstructRelief`（上传照片、排队、取回 GLB）、`RELIEF_VERSION` |
| `server/accountVault.mjs` | `putScene / getScene / listScenes`，模型存 `spacetime/<id>.glb` + `.json`（含 `version`）；`removeAsset` 一并删除 |
| `server/index.mjs` | `POST /api/spacetime-scene`（分段计划 + 能力 + 已有模型）、`POST /api/spacetime-scene/relief`（重建）、`GET /api/spacetime-scene/models/<id>` |
| `src/components/SpacetimeScene.tsx` | 时间片列表、证据层、`ReliefViewer` |
| `tests/spacetime-scene.mjs` | 浏览器链路，含最大摆动截图 |

## ComfyUI 工作流

```text
LoadDA3Model(model_name, weight_dtype=default)
LoadImage(image)
DA3Inference(mode=mono, resolution=1008, resize_method=upper_bound_resize)
DA3GeometryToMesh(decimation=2, discontinuity_threshold=0.12, confidence_threshold=0.1, use_sky_mask=true, texture=true)
SaveGLB(prefix=3d/personal-world-scene)
```

模型文件放在 ComfyUI 的 `models/geometry_estimation/`。本机用 `depth_anything_3_mono_large.safetensors`（1.3 GB，Apache-2.0，来源 `Comfy-Org/Depth-Anything-3`）。注意 `depth-anything/DA3-LARGE`（非 mono）是 CC BY-NC，商用要避开。

| 参数 | 取值 | 为什么 |
| --- | --- | --- |
| `resolution` | 1008 | 再高显存和时间线性增加，浮雕细节提升有限 |
| `decimation` | 2 | 顶点减到四分之一，三角形约 25 万，GLB 约 5 MB |
| `discontinuity_threshold` | 0.12 | 0.04 会把水面、路面这类掠射的地面当断层切成条带 |
| `use_sky_mask` | true | 不让天空被拉成一大片幕布 |

调参实验：环境变量 `DA3_DISCONTINUITY=0.08 SPACETIME_PHOTO=<照片> node tests/spacetime-scene.mjs`，看截图。

## 坐标推导

DA3 单目模式没有内参，节点用 `fx = fy = 0.7 × W`、主点在图中心反投影（`_da3_default_K`，`comfy_extras/nodes_depth_anything_3.py`）。转成 glTF 后相机看向 −z、y 向上。验证过的事实（`LIVE=1` 的测试会再次检查）：

- 所有顶点 `z < 0`；
- 图像左右边缘的顶点 `|x/z| ≈ 0.714 = 0.5 / 0.7`；
- 图像上边缘的顶点 y 大、下边缘 y 小；
- 纹理坐标 `v` 小的在上。

## 查看器怎么放相机

```text
加载后：keepFacing(minCos = 0.05) 剔掉沿视线的拉伸三角形
forward = (0, 0, -1)
depth_i = -z_i;  median = 中位数
squeezeDepth(median, gamma = 0.5)：深度 → median × (深度 / median)^0.5，顶点沿各自的视线移动
far = 压缩后的 97 分位
canvas = 照片的画幅（在舞台里留边）
camera.position = 0;  camera.lookAt(forward * median)
frameX = 0.5 / 0.7;  frameY = frameX / 照片宽高比
camera.fov = 2·atan(frameY)
OrbitControls: target = forward * median, enableZoom = false, enablePan = false
  方位 ±0.03 rad, 俯仰 ±0.02 rad
背景平面: 距离 far × 1.2, 大小 = 距离 × frame × 2 × 2.4
  贴图 = 中间是原照片（被浮雕遮住的内部换成周围颜色的柔和底色），四周是整张照片的虚化
  遮罩 = 从原点用照片的画幅渲染一次网格得到，先腐蚀 2 像素再补洞
```

为什么这么严：单张照片对被遮挡的部分一无所知，摆动越大露出越多；近处几何的视差最大。调大摆动范围之前，先用一张前景有人物的照片看最大摆动的截图。

## 换成多视角重建时

先满足准入：同一时段、同一房间/街角、至少 30 张以上重叠的连续帧或照片，保留原始时间戳和音轨；再走 FFmpeg 抽帧 → COLMAP 位姿 → Nerfstudio Splatfacto → 导出 `.ply/.splat`，用同一个 `epoch` 结构挂到时间轨道上，保持浮雕作为素材不足时的回退。没有这些素材时，不要为了"看起来更 4D"而放宽单张浮雕的摆动范围。
