# Personal World

需求与交互以 `docs/需求说明书.html` 为准，效果图见 `docs/mockups/`。

## 开发原则

- 已有合适的 skill 就用；没有就自建。所有引用和自建的 skill 都放在 `skills/`，并登记到 `skills/README.md`。
- 能测试的 skill 做对比测试（用 / 不用 skill 执行同一任务），结果放在该 skill 的 `evals/` 目录。
- 顶栏只有「人生地图」「人生管家」两项；四个能力融入人生管家的记忆，不做单独入口。
- 界面保持静止：图标和标记不漂浮、不抖动，卡片悬停不位移。
- 密钥只放 `.env`，由服务端读取；`.env` 不入库。

## 验证

```powershell
npm run build
npm run test:api
npm run test:smoke   # 需先 npm run dev
```
