# Personal World

需求与交互以 `docs/需求说明书.html` 为准，效果图见 `docs/mockups/`。

## 开发原则

- 已有合适的 skill 就用；没有就自建。
  - `skills/`：**运行时** skill，服务端读取后交给大模型（事件分析、人生管家、照片信息卡、协同判断）。
  - `.claude/skills/`：**开发**用的 skill（Claude Code 自动发现）；引用过的外部 skill 只在其 README 登记，不复制。
- **每个 skill 都要有专门的测试** `test.mjs`（格式与关键规则、使用它的接口、`LIVE=1` 时的真实调用），用 `npm run test:skills` 运行。
- 能测试的 skill 做对比测试（用 / 不用 skill 执行同一任务），结果放在该 skill 的 `evals/`。评分脚本要先核对失败样例，避免误判。
- 顶栏不放导航按钮：点击地图上的地点时人生管家对话框自动弹出，关闭即回到全图；四个能力融入人生管家的记忆，不做单独入口。
- 界面保持静止：图标和标记不漂浮、不抖动，卡片悬停不位移。
- 密钥只放 `.env`，由服务端读取；`.env`、`server/data/`、`data/`（用户照片）不入库。
- 照片里的号码等敏感文字：用户同意隐私声明后原样显示，未同意时遮挡（服务端 `server/privacy.mjs` 兜底）。

## 验证

```powershell
npm run build
npm run test:api
npm run test:skills  # 每个 skill 的专门测试；LIVE=1 连接真实服务
npm run test:smoke   # 需先 npm run dev
```
