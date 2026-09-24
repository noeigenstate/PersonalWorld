// stepfun.mjs
// Node 24 原生 ESM 模块，调用阶跃星辰（StepFun）开放平台 API。
// 不依赖任何第三方 npm 包，仅使用全局 fetch / FormData / Blob。
//
// 需要环境变量：
//   STEPFUN_API_KEY   阶跃星辰开放平台的 API Key
//
// StepFun 的 HTTP 接口整体是 OpenAI 兼容风格（Bearer Token + /v1/... 路径），
// 下面三个函数分别对应对话（含视觉）、语音识别（ASR）、语音合成（TTS）接口。

const BASE_URL = 'https://api.stepfun.com/v1';

function getApiKey() {
  const key = process.env.STEPFUN_API_KEY;
  if (!key) {
    throw new Error('缺少环境变量 STEPFUN_API_KEY');
  }
  return key;
}

function authHeaders(extra = {}) {
  return {
    Authorization: `Bearer ${getApiKey()}`,
    ...extra,
  };
}

async function readErrorBody(res) {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

/**
 * 调用 StepFun 支持图片输入的多模态对话模型（step-1v 系列），
 * 传入一张 base64 data URL 图片和一个问题，要求模型以 JSON 对象格式返回结果。
 *
 * @param {string} question 要问模型的问题（可以在其中说明期望的 JSON 字段结构）
 * @param {string} imageDataUrl 形如 "data:image/jpeg;base64,...." 的图片 data URL
 * @returns {Promise<any>} 解析后的 JSON 对象
 */
export async function askJson(question, imageDataUrl) {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      model: 'step-1v-32k',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: imageDataUrl } },
            {
              type: 'text',
              text: `${question}\n\n请只输出一个合法的 JSON 对象作为回答，不要包含任何解释文字、前后缀或 Markdown 代码块标记。`,
            },
          ],
        },
      ],
      // StepFun 的对话接口兼容 OpenAI 的 response_format 用法，
      // 要求模型直接返回可被 JSON.parse 的内容。
      response_format: { type: 'json_object' },
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    throw new Error(`StepFun askJson 请求失败: ${res.status} ${await readErrorBody(res)}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content.length === 0) {
    throw new Error('StepFun askJson 返回内容为空');
  }

  try {
    return JSON.parse(content);
  } catch {
    // 兜底：极少数情况下模型仍会包一层 ```json ... ``` 代码块，尝试提取花括号内容再解析。
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
    throw new Error(`StepFun askJson 返回内容不是合法 JSON: ${content}`);
  }
}

/**
 * 用 StepFun 语音识别（ASR）接口，把一段 WAV 录音转成文字。
 *
 * @param {Buffer} wavBuffer WAV 格式（建议 16kHz / 16bit / 单声道）的音频数据
 * @returns {Promise<string>} 识别出的文本
 */
export async function transcribe(wavBuffer) {
  const form = new FormData();
  form.append('model', 'step-asr');
  form.append('file', new Blob([wavBuffer], { type: 'audio/wav' }), 'audio.wav');

  const res = await fetch(`${BASE_URL}/audio/transcriptions`, {
    method: 'POST',
    // 注意：使用 FormData 时不要手动设置 Content-Type，
    // fetch 会自动带上正确的 multipart/form-data boundary。
    headers: authHeaders(),
    body: form,
  });

  if (!res.ok) {
    throw new Error(`StepFun transcribe 请求失败: ${res.status} ${await readErrorBody(res)}`);
  }

  const data = await res.json();
  const text = data?.text ?? data?.result?.text ?? data?.transcript;
  if (typeof text !== 'string') {
    throw new Error(`StepFun transcribe 返回格式异常: ${JSON.stringify(data)}`);
  }
  return text;
}

/**
 * 用 StepFun 语音合成（TTS）接口，把中文文本转成 mp3 音频。
 *
 * @param {string} text 待合成的中文文本
 * @returns {Promise<Buffer>} mp3 格式的音频数据
 */
export async function speak(text) {
  const res = await fetch(`${BASE_URL}/audio/speech`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      model: 'step-tts-mini',
      input: text,
      voice: 'cixingnansheng',
      response_format: 'mp3',
    }),
  });

  if (!res.ok) {
    throw new Error(`StepFun speak 请求失败: ${res.status} ${await readErrorBody(res)}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
