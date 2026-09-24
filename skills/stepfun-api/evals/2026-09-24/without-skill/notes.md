# 浏览器录音 → transcribe 使用说明

Chrome 里按住按钮时用 `MediaRecorder` 录制的音频默认是 `audio/webm;codecs=opus`，不是 WAV，不能直接塞给 `transcribe`；松开按钮后需要先把这些分片合并成一个 Blob。最简单的做法是在浏览器端用 `AudioContext.decodeAudioData` 把该 Blob 解码成 PCM 数据，再手写一个 WAV 头（16kHz/16bit/单声道即可）把 PCM 打包成标准 WAV 字节，得到一个 `ArrayBuffer`。把这个 WAV 的 `ArrayBuffer` 通过 `fetch` 上传给后端接口，后端用 `Buffer.from(arrayBuffer)` 转成 Node Buffer 后直接传给 `transcribe(wavBuffer)` 即可。如果不想在前端做编码，也可以把原始 webm 直接传给后端，用 ffmpeg（`ffmpeg -i in.webm -ar 16000 -ac 1 out.wav`）转码成 WAV 后再调用 `transcribe`。核心原则就是：无论在前端还是后端转码，最终喂给 `transcribe` 的必须是合法的 WAV 字节流，而不是浏览器录制出的原始 webm/opus 数据。
