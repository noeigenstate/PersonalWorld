# amap-threejs 对比测试 · 2026-09-24

## 方法

两个全新的子代理（Claude Sonnet）执行同一任务，都禁止联网：

- **with-skill**：先读 `.claude/skills/amap-threejs/SKILL.md`
- **without-skill**：只凭已有知识

任务：写一个页面，高德 JS API 2.0 3D 地图（上海，13 级），用 Three.js r186 在外滩（手机 GPS 的 WGS-84 坐标 31.2397, 121.4998）放一个纯红立方体，屏幕上始终约 40 px。

`run-eval.mjs` 用 `.env` 里的真实高德 Key 加载两份页面，并测量：

- 立方体是否画出来；
- 红色像素中心与高德自己算出的外滩屏幕位置（`lngLatToContainer`，GCJ-02）之差；
- 从 13 级放大到 15 级后，立方体大小（红色面积的平方根）之比，理想为 1。

## 结果

| 检查项 | with-skill | without-skill |
|---|---|---|
| 立方体画出来 | ✅ | ❌ `THREE.WebGLRenderer: WebGL 1 is not supported since r163.` |
| 位置偏差 13 级 / 15 级 | 1 px / 1 px | — |
| 放大后尺寸比 | 0.98 | — |
| 子代理自评把握 | 85% | 65% |

## 结论

skill 有效。不用 skill 时，模型按常见教程把 three.js 渲染器接到高德的 WebGL 上下文上，而高德给的是 WebGL 1，新版 three.js 直接拒绝，页面上什么都没有。用 skill 时一次做对：独立画布同步相机、WGS-84 转 GCJ-02、按缩放级别保持尺寸。

## 测试过程中的一次误判

第一版测量脚本用红色像素的外接框算大小，放大后把高德地图上的红色道路文字也框了进去，得出"放大后变成 2.5 倍"。红色像素总数前后几乎不变（2228 / 2116），说明立方体没变大；改为只统计目标点附近的像素、用面积衡量后，得到上表结果。为排除 skill 本身的问题，还单独验证了 `156543.034 / 2^zoom` 与高德相机实际的每像素米数在静止和动画中都一致。

## 复现

```bash
node .claude/skills/amap-threejs/evals/2026-09-24/run-eval.mjs
```

需要项目根目录 `.env` 中的 `AMAP_JS_KEY`、`AMAP_JS_SECURITY_CODE` 和网络。
