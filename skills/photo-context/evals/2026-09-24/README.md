# photo-context 对比测试 · 2026-09-24

## 方法

真实 StepFun `step-3.7-flash`，四个场景各跑 3 次，with-skill 用 `skills/photo-context/SKILL.md`，without-skill 只给同样的输出字段。请求构造与解析直接复用 `server/photoContext.mjs`，与线上接口一致。

| 场景 | 目标照片 | 参考照片 | 期望 |
|---|---|---|---|
| same-room | 用户房间下半部分（无定位） | R1 同一房间上半部分（杭州，GPS）；R2 白墙空房间（上海）；R3 东方明珠（上海） | 城市=杭州，依据 R1，R2/R3 判为无关 |
| landmark | 东方明珠 A（无定位） | R1 黄鹤楼（武汉）；R2 用户房间（杭州） | 城市=上海，依据 landmark |
| landmark-same-place | 东方明珠 A（无定位） | R1 东方明珠 B（上海，GPS）；R2 黄鹤楼（武汉） | 城市=上海，依据 R1 或 landmark |
| no-evidence | 白墙空房间（无定位） | R1 用户房间（杭州）；R2 黄鹤楼（武汉） | 不补全城市，全部判为无关 |

图片来源见 `images/ATTRIBUTION.md`。用户房间的两个裁切来自个人照片，不入库。

## 结果

| 场景 | 检查项 | with-skill | without-skill |
|---|---|---|---|
| same-room | 城市正确 / 依据正确 / 无误判 | 3/3 · 3/3 · 3/3 | 3/3 · 3/3 · 3/3 |
| same-room | 覆盖每张参考照片 | 3/3 | 1/3 |
| landmark | 全部检查项 | 3/3 | 3/3 |
| landmark-same-place | 城市 / 依据 / 无误判 | 3/3 | 3/3 |
| landmark-same-place | 覆盖每张参考照片 | 3/3 | 2/3 |
| no-evidence | 不补全城市 / 无误判 | 3/3 | **2/3** |
| no-evidence | 覆盖每张参考照片 | 3/3 | 2/3 |
| **合计** | | **48/48** | **40/48** |

## 结论

这个任务上基线已经不弱：地标识别和"同一房间"判断不用 skill 也做得对。skill 的价值在**不瞎补**和**完整性**：

- 不用 skill 的一次失败里，模型以"都是现代简约风格的室内空间"为由，把一张纽约的空房间判成用户杭州的房间，并补全"杭州市"。skill 明确规定常见特征（白墙、室内）不能作为相关依据，3 次都判为无关、不补全。
- 不用 skill 时经常只报告相关的那张参考照片，漏掉对其他照片的判断；skill 要求 `matches` 覆盖每一张。

用 skill 时置信度也按规则给出：同一场景 + GPS 来源给 0.8 以上，地标给 0.9。

## 复现

```bash
node skills/photo-context/evals/2026-09-24/run-eval.mjs   # 24 次真实调用
```

需要 `images/room-target.jpg`、`images/room-ref.jpg`（由 `data/` 中的用户照片裁切：分别取下部 58% 和上部 58%，后者亮度 ×1.12）。
