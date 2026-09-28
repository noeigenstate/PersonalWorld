# photo-cull 对比测试（2026-09-28）

在真实 StepFun 模型（step-3.7-flash）上对比两种系统提示：

- **用 skill**：[SKILL.md](../../SKILL.md)。
- **不用 skill**：只说明输出字段。

请求和解析都走 `server/photoCull.mjs`，与 `/api/photo-cull` 接口完全一致。每组跑 3 次。

测试照片是 [make-images.mjs](make-images.mjs) 画出来的合成图，不是用户照片，放在 `images/`。

| 组 | 内容 | 期望 |
|---|---|---|
| blink | 两人合影 5 张：a 都睁眼且清晰；b、c 各有一人闭眼；d 模糊；e 人物被裁到边缘 | b、c 标闭眼；d 标模糊；保留 a |
| landscape | 风景 4 张，没有人：a、b 清晰；c 模糊；d 地平线倾斜 | 不标闭眼；c 标模糊；保留 a 或 b |
| all-blink | 合影 3 张，每张都有人闭眼 | 三张都标闭眼，仍只保留 1 张 |

评分项：

- 每张都评价了。
- 闭眼标记完全正确。
- 模糊的照片被标出，清晰的没有误标。
- 保留的张数正确，且保留的是合格照片。

## 结果

| 轮次 | 用 skill | 不用 skill |
|---|---|---|
| 第 1 轮（[results-round1.json](results-round1.json)） | 34/36 | 34/36 |
| 第 2 轮，skill 修改后（[results.json](results.json)） | **36/36** | 34/36 |

## 核对失败样例

两轮的失败都逐条看过原始回答，都是真实错误，不是评分脚本误判。

- **第 1 轮，用 skill，landscape**：有一次模型返回的 `photos` 是空数组，只给了 `keep`。据此在 skill 里写明："`photos` 数组的项数必须等于照片张数；没有人的照片同样要写。"
- **两轮，不用 skill，all-blink**：
  - 把"左边的人闭眼"的照片说成"两人均睁眼"。
  - 或者在 `note` 里写了"左侧人物闭眼"，`eyesClosed` 却是 false。

  skill 里写明"只要有一个人闭眼就为 true；note 里写了谁闭眼，这里就必须是 true"。

## 复现

```bash
node skills/photo-cull/evals/2026-09-28/make-images.mjs
node skills/photo-cull/evals/2026-09-28/run-eval.mjs            # RUNS=3
node skills/photo-cull/evals/2026-09-28/run-eval.mjs --regrade  # 只重新评分
```
