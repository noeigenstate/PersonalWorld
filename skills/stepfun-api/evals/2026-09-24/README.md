# stepfun-api 对比测试 · 2026-09-24

## 方法

两个全新的子代理（Claude Sonnet）执行同一任务，都禁止联网：

- **with-skill**：先读 `skills/stepfun-api/SKILL.md`
- **without-skill**：只凭已有知识

任务：用 Node 24 原生 ESM 写 `askJson`（图片 + 问题 → JSON）、`transcribe`（WAV → 文字）、`speak`（文字 → mp3）三个函数，并说明 Chrome 录音如何交给 `transcribe`。

然后用 `run-eval.mjs` 以真实 StepFun 接口运行两份代码。输入：一张 PNG 截图，以及一段用已验证的 TTS 调用生成的 WAV（"我们去外滩散步吧"）。

## 结果

| 检查项 | with-skill | without-skill |
|---|---|---|
| askJson（图片对话 + JSON） | ✅ `step-3.7-flash`，9.0 s | ❌ `step-1v-32k` → 404 模型不存在 |
| transcribe（语音识别） | ✅ `stepaudio-2.5-asr`，识别为"我们去外滩散步吧。" | ✅ `step-asr`（旧版）仍可用 |
| speak（语音合成） | ✅ `stepaudio-2.5-tts` | ✅ `step-tts-mini` |
| 录音说明提到 webm 需转 WAV | ✅ 并指向 `scripts/wav.ts` | ✅ |
| 子代理自评把握 | 85% | 35% |

## 结论

skill 有效：3/3 一次跑通，且使用当前推荐的模型；不用 skill 时 2/3，关键的图片对话因模型名猜错而失败。录音格式这一点基线模型本身就知道，skill 的增量主要在**模型名称**和**已验证的调用细节**。

## 复现

```bash
node skills/stepfun-api/evals/2026-09-24/run-eval.mjs
```

需要项目根目录 `.env` 中的 `STEPFUN_API_KEY`，会产生少量真实调用。
