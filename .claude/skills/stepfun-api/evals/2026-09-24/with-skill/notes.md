# 浏览器录音 → transcribe 使用说明

在 Chrome 网页里，按住按钮时用 `MediaRecorder`（`getUserMedia` 拿到的麦克风流）开始录音，松开时 `stop()` 并收集 `dataavailable` 产生的 `Blob`（默认是 `audio/webm;codecs=opus`）。这种 webm/opus 格式 StepFun 语音识别接口不接受，必须先转码：用 `AudioContext.decodeAudioData` 解码该 Blob，再用 `OfflineAudioContext` 渲染成单声道、16kHz 的 PCM 数据，最后按 WAV 文件头封装成 16-bit PCM WAV（可直接复用 `skills/stepfun-api/scripts/wav.ts` 里的 `toWav`/`encodeWav`）。

前端把转好的 WAV Blob 通过 `fetch`（`multipart/form-data`，字段名任意，例如 `audio`）POST 到你自己的后端接口，绝不能让浏览器直接持有 `STEPFUN_API_KEY`。后端收到请求后把上传的文件读成 `Buffer`（如用 Node 内置 `request.formData()` 或框架的 multipart 解析器拿到文件的 `arrayBuffer()` 再 `Buffer.from(...)`），然后调用本模块的 `transcribe(wavBuffer)`，它会用该 Buffer 构造 `Blob` 并以 `stepaudio-2.5-asr` 模型上传到 `/v1/audio/transcriptions`，返回识别出的文字。
