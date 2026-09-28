# skills（运行时）

这里只放 **Personal World 运行时**交给大模型执行的 skill。服务端每次请求都从 `SKILL.md` 读取（去掉 front matter），修改后无需重启即生效。

开发这个项目时用到的 skill 不在这里，见 [`.claude/skills/`](../.claude/skills/README.md)。

## 规则

1. 已有合适的 skill 就用；没有就在这里新建一个目录，写 `SKILL.md`。
2. **每个 skill 都有专门的测试** `test.mjs`：检查 `SKILL.md` 的格式和关键规则、使用它的服务端接口（模拟模型），以及 `LIVE=1` 时对真实模型的一次调用。
3. 能做对比测试的 skill，在 `evals/<日期>/` 记录"用 skill / 不用 skill"的结果。

```bash
npm run test:skills             # 离线部分
LIVE=1 npm run test:skills      # 含真实 StepFun / 高德调用
```

## 索引

| Skill | 用途 | 使用它的接口 | 测试 | 对比测试 |
|---|---|---|---|---|
| [event-analysis](event-analysis/SKILL.md) | 从一组照片重建一件事：标题、摘要、类型、地点、城市、画面文字、待确认问题 | `POST /api/analyze` | [test.mjs](event-analysis/test.mjs) | — |
| [life-butler](life-butler/SKILL.md) | 人生管家：以事件记忆回答问题，推断内容加〔〕，引用事件 | `POST /api/butler` | [test.mjs](life-butler/test.mjs) | — |
| [photo-card](photo-card/SKILL.md) | 单张照片信息卡：事实与推断分开、地标、带依据的线索、按隐私声明处理号码 | `POST /api/photo-card` | [test.mjs](photo-card/test.mjs) | [44/45 vs 23/45](photo-card/evals/2026-09-24/README.md) |
| [photo-cull](photo-cull/SKILL.md) | 挑照片：相似照片逐张检查闭眼、模糊、表情，推荐保留几张 | `POST /api/photo-cull` | [test.mjs](photo-cull/test.mjs) | [36/36 vs 34/36](photo-cull/evals/2026-09-28/README.md) |
| [photo-context](photo-context/SKILL.md) | 多张照片协同判断：与有定位的参考照片比对，补全地点、时间、事件 | `POST /api/photo-context` | [test.mjs](photo-context/test.mjs) | [48/48 vs 40/48](photo-context/evals/2026-09-24/README.md) |
