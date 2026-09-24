# Personal World · 人生地图

Personal World 是一个个人世界模型（Personal World Model）：先把照片、视频和截图整理成事件，再从事件中分离出时间线和空间线。产品分为人生地图和人生管家（大模型）两部分：在地图上点击地点会出现故事线，并可用语音问人生管家当时发生了什么。详见 [需求说明书](docs/需求说明书.html)。

当前 Web 预览版只保留事件底座，方便用真实照片测试。

## 启动

在项目目录运行：

```powershell
npm install
npm run dev
```

打开 **http://localhost:5183/**。前端默认只监听本机；API 服务运行在 `127.0.0.1:8787`。

项目根目录的 `.env` 已准备好。要启用 AI，请填写 `STEPFUN_API_KEY`，并保持一个支持图片输入的 `STEPFUN_MODEL`，例如 `step-3.7-flash`。保存后重启 `npm run dev`。密钥只由本机 API 服务读取，不会写入浏览器代码。

## 当前可用流程

1. 导入 JPG、PNG、WebP、GIF 或浏览器能播放的视频。文件与预览保存在浏览器 IndexedDB 中。
2. 读取照片拍摄时间（可用时）与 GPS 坐标；否则使用文件时间。相近时间的影像组成事件草稿。完全相同的文件按 SHA-256 跳过。
3. 打开事件，点击「用 StepFun 分析」。系统将最多 6 张影像预览发送到 StepFun，获取事件标题、摘要、画面文字、线索及待确认问题。视频目前只分析截取的预览帧。
4. 核对并修改事件信息，确认后保存。

导入本身不会上传图片。事件分析需要点击对应按钮。清除浏览器站点数据会删除本地记忆。

## 验证

```powershell
npm run build
npm run test:smoke
npm run test:api
```

冒烟测试需要本机安装 Chrome，使用独立浏览器会话，不修改你日常浏览器中的数据。

## 当前边界

- 自动聚合依据拍摄日期和六小时内的时间间隔；跨天旅行、多地点聚合仍需进一步设计。
- 去重仅识别完全相同的文件，暂不识别相似照片。
- HEIC 图片尚未支持；导出与账号同步尚未实现。
- `.env` 中的 `STEPFUN_AGENT_API_URL` 和 `STEPFUN_AGENT_ID` 是给专属 Agent API 保留的字段。你提供的[快速开始文档](https://platform.stepfun.com/docs/zh/quickstart/overview)描述的是模型 API；当前实现使用 `STEPFUN_API_KEY` 和 `STEPFUN_MODEL`。如需直接调用一个已发布 Agent，还需要它的专属 API 请求示例。
