---
name: stepfun-api
description: Call StepFun (阶跃星辰) models from a Node/browser app — chat with images and JSON output, speech-to-text (ASR), and text-to-speech (TTS). Use when writing or debugging code that talks to api.stepfun.com, choosing StepFun model names, recording voice in the browser for StepFun ASR, or when a StepFun call fails.
---

# StepFun API

Verified against the live API on 2026-09-24. Docs index: https://platform.stepfun.com/docs/llms.txt

## Rules that apply to every call

- **Step Plan first**: base URL `https://api.stepfun.com/step_plan/v1` bills the subscription credit
  (Step Plan · 消耗套餐 Credit). `https://api.stepfun.com/v1` bills the account balance — the same key
  works on both, so a wrong base URL silently spends the balance. Header `Authorization: Bearer $STEPFUN_API_KEY`.
- Step Plan models (2026-09-28): step-3.7-flash, step-router-v1, stepaudio-2.5-chat / -tts / -asr / -realtime,
  step-image-edit-2, step-3.5-flash(-2603), step-5-preview.
- Keep the key on the server. Browsers call your own backend, which calls StepFun.
- The API is OpenAI-compatible for chat, but audio endpoints have their own model names (below). Do not reuse the chat model for audio.

## Chat, vision, JSON — `POST /v1/chat/completions`

```js
{ model: 'step-3.7-flash',            // supports image input
  messages: [
    { role: 'system', content: '… 严格输出 JSON 对象 …' },
    { role: 'user', content: [
        { type: 'text', text: '…' },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,…' } } ] } ],
  response_format: { type: 'json_object' } }
```

- Images can be base64 data URLs. Downscale to ~1200 px JPEG first; keep one request under ~20 MB.
- With `json_object`, still say "输出 JSON" in the prompt and parse defensively: strip ``` fences, fall back to the first `{` … last `}`.
- Check `choices[0].finish_reason === 'length'` and report truncation instead of parsing half a JSON.
- Typical latency: 3–4 s for a short JSON answer.

## Speech to text on Step Plan — `POST /step_plan/v1/audio/asr/sse`

Step Plan has **no** `/audio/transcriptions` (404). Send JSON with base64 audio; the answer is server-sent events:

```js
fetch(`${base}/audio/asr/sse`, { method: 'POST',
  headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
  body: JSON.stringify({ audio: { data: wavBase64,
    input: { transcription: { model: 'stepaudio-2.5-asr', language: 'zh' }, format: { type: 'wav' } } } }) })
// data: {"type":"transcript.text.delta","delta":"今天天气很好。",…}
// data: {"type":"transcript.text.done","text":"今天天气很好。",…}   ← use this text
```

Multipart to `/audio/asr/sse` gives `400 invalid request format`. Chat and TTS paths are the same as below.

## Speech to text on the balance endpoint — `POST /v1/audio/transcriptions`

multipart/form-data fields:

| field | value |
|---|---|
| `model` | `stepaudio-2.5-asr` (`step-asr` is legacy) |
| `response_format` | `json` or `text` |
| `file` | mp3, pcm, ogg or wav, < 100 MB |
| `hotwords` | optional, JSON array string, e.g. `["外滩","武汉大学"]` |

Response (`json`): `{ "text": "…" }`.

**Browser recording pitfall:** Chrome's `MediaRecorder` produces `audio/webm;codecs=opus`, which this endpoint does not accept. Decode the recording with `AudioContext.decodeAudioData`, mix to mono, resample to 16 kHz, and encode a 16-bit PCM WAV before uploading. See `scripts/wav.ts`.

In Node, build the form with the global `FormData` and `new Blob([buffer], { type: 'audio/wav' })`; do not set `Content-Type` yourself (fetch adds the boundary).

## Text to speech — `POST /v1/audio/speech`

```js
{ model: 'stepaudio-2.5-tts',   // also: stepaudio-3-tts, step-tts-2, step-tts-mini
  input: '…',                    // max 1000 characters
  voice: 'cixingnansheng',       // system voice id
  response_format: 'mp3' }       // wav | mp3 | flac | opus | pcm
```

Returns the audio bytes directly (typically ~2 s for one sentence). Optional: `speed` 0.5–2, `volume` 0.1–2, `instruction` (stepaudio models only) to steer the delivery. List voices: see `api-reference/audio/system-voices.md` in the docs index.

Strip markup the listener should not hear (brackets, Markdown) before sending text.

## Checklist when a call fails

1. `401` → key missing or wrong; confirm the server actually loaded `.env`.
2. `400` on transcriptions → wrong file format (webm) or missing `response_format`.
3. Empty or cut JSON → `finish_reason` was `length`; shorten context or output.
4. Timeouts → wrap every call in an `AbortController` (60–90 s) and surface a readable message.
