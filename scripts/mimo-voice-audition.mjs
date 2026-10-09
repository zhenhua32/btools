import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { basename, extname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DESIGN_MODEL = 'mimo-v2.5-tts-voicedesign'
const CLONE_MODEL = 'mimo-v2.5-tts-voiceclone'
const REFERENCE_BASE64_LIMIT = 10_000_000
const AUDITION_TEXT = '夜已经深了，先放松一下。今天的事情慢慢来，我会陪你，把这段文字清楚地读完。Take a breath, settle in, and let me read this passage to you, clearly and at an easy pace.'
const BILINGUAL_GUIDANCE = '中文使用清晰自然的标准普通话，英文使用自然流畅的中性美式发音；切换语言时保持相同的音高范围、共鸣位置与人物声音。'

export const AUDITION_RECIPES = [
  {
    id: 'A', label: '低磁性御姐', file: 'A-low-magnetic.wav', model: DESIGN_MODEL,
    prompt: `一位30岁左右的成年女性，成熟自信的御姐气质，中低音女性声线，胸腔共鸣温暖厚实，音质圆润细腻，带少量丝绒般的气息感。语速中等偏慢，咬字清楚，句尾轻轻下落，像安静夜晚近距离聊天，性感来自低磁性的自然声音与克制表达。${BILINGUAL_GUIDANCE}`,
    text: AUDITION_TEXT,
  },
  {
    id: 'B', label: '冷静知性御姐', file: 'B-cool-knowledgeable.wav', model: DESIGN_MODEL,
    prompt: `一位30到38岁的成年女性，冷静知性的御姐声线，音高处于女性中低音区，共鸣饱满集中，音色干净，有很轻的颗粒质感。发声稳而柔韧，节奏从容，停顿利落，陈述时句尾平稳下落，像自信专业的女主持人。${BILINGUAL_GUIDANCE}`,
    text: AUDITION_TEXT,
  },
  {
    id: 'C', label: '慵懒丝绒御姐', file: 'C-lazy-silky.wav', model: DESIGN_MODEL,
    prompt: `一位28到35岁的成年女性，慵懒柔滑的御姐声线，中低音区，胸腔共鸣圆润，元音饱满，声线边缘带细微自然气声。喉部放松，语速稍慢但连贯，声调起伏柔和，带一点含笑的亲近感，保持清楚发音和成熟自然的说话方式。${BILINGUAL_GUIDANCE}`,
    text: AUDITION_TEXT,
  },
  {
    id: 'D', label: '温柔清透姐姐', file: 'D-gentle-clear.wav', model: DESIGN_MODEL,
    prompt: `一位28到35岁的成年女性，温柔成熟的姐姐声线，女性中低音区，声音清透且有厚度，元音圆润，辅音柔和清楚，气息平稳。语速自然从容，语调细腻，句尾轻柔下落，像耐心给人读一段喜欢的文字。${BILINGUAL_GUIDANCE}`,
    text: AUDITION_TEXT,
  },
  {
    id: 'A-clone-CN', label: 'A 参考声音克隆 · 中文验证（并非最终选择）',
    file: 'A-clone-CN.wav', model: CLONE_MODEL, referenceId: 'A',
    prompt: '沿用参考音频中同一位说话人的声音，语速自然从容，吐字清楚，以平静亲近的语气朗读标准普通话，保持参考声音的共鸣和音高范围。',
    text: '窗外的风慢慢停了，桌上的茶还留着一点温度。明天的安排已经记好，今晚就把时间留给自己吧。',
  },
  {
    id: 'A-clone-EN', label: 'A 参考声音克隆 · 英文验证（并非最终选择）',
    file: 'A-clone-EN.wav', model: CLONE_MODEL, referenceId: 'A',
    prompt: 'Keep the same speaker identity, resonance, and pitch range as the reference audio. Read clearly in natural neutral American English, with a calm, warm delivery and an unhurried conversational pace.',
    text: 'The city is quiet now. Tomorrow is already planned, so let this evening be yours, one gentle moment at a time.',
  },
]

const C_YOUNG_AUDITION_TEXT = '今天有个新鲜想法，想和你分享。打开这一页，挑一个喜欢的，和我一起试试看，说不定会有小惊喜。Hello there! Let’s explore something lovely today, try a fresh idea, and enjoy a little surprise along the way.'

export const C_YOUNG_AUDITION_RECIPES = [
  {
    id: 'C1', label: '柔滑含笑', file: 'C1-smiling-silky.wav', model: DESIGN_MODEL,
    prompt: '22–26岁成年女性的声音，亲近、圆润、柔滑，像一位带着笑意分享新发现的年轻朋友。以温暖清澈的中音区为主，元音饱满圆润，声线有细腻的丝绒质感，轻微气声融在柔和起音中，主体发声完整而有支撑。嘴角微笑的感觉自然可听，语调有轻盈的起伏，关键字带一点温柔强调，句尾收束利落。语速自然轻快，停顿简短舒适，情绪明朗、轻松，富有亲和力与吸引力，适合日常网页朗读。中文普通话清晰自然，英文采用中性美式发音，语言切换始终保持同一声线和音色。',
    text: C_YOUNG_AUDITION_TEXT,
  },
  {
    id: 'C2', label: '明亮灵动', file: 'C2-bright-lively.wav', model: DESIGN_MODEL,
    prompt: '22–26岁成年女性的声音，保留亲近、圆润、柔滑的底色，增加清新明亮的光泽与灵动的笑意。以中音区为主，光泽稍明亮，声线清澈圆润，声芯清晰，元音通透饱满，起音柔和，声音有自然的弹性。像兴致勃勃地介绍一个有趣的小发现，短句之间有活泼的节奏变化，关键词明亮突出，句尾轻巧地扬起或收住。语速自然略快，咬字轻盈准确，停顿简洁，整体开朗、有精神，富有年轻成人的活力与亲近的魅力，适合日常网页朗读。中文普通话清晰自然，英文采用中性美式发音，语言切换始终保持同一声线和音色。',
    text: C_YOUNG_AUDITION_TEXT,
  },
  {
    id: 'C3', label: '自信俏皮', file: 'C3-confident-playful.wav', model: DESIGN_MODEL,
    prompt: '22–26岁成年女性的声音，亲近、圆润、柔滑，带着自信俏皮的微笑与自然的吸引力。以温暖而清晰的中音区为主，保留柔润的音色质感，声线饱满有支撑，轻微气声点缀起音，咬字干净利落。像一位很有主见又爱分享的年轻朋友，语气轻松笃定，关键词有短促而鲜明的强调，语调在平稳陈述与俏皮上扬之间自然变化。语速轻快而从容，节奏有弹性，短停顿带出轻松幽默感，句尾收束清爽，适合日常网页朗读。中文普通话清晰自然，英文采用中性美式发音，语言切换始终保持同一声线和音色。',
    text: C_YOUNG_AUDITION_TEXT,
  },
  {
    id: 'C2-clone', label: 'C2 固定音色 · 中英克隆验证（并非最终选择）',
    file: 'C2-clone-bilingual.wav', model: CLONE_MODEL, referenceId: 'C2',
    prompt: '保留参考音频的说话人音色。以自然轻快的语速朗读，带着轻松真诚的笑意，语调灵动、充满亲和力；关键短语略作强调，句间停顿简短舒适，像和熟悉的朋友分享一个有趣的新发现。中文普通话清晰自然，英文采用中性美式发音，语言切换始终保持同一声线和音色。',
    text: '风吹过树叶，带来一个小小的惊喜。今天的路还很长，我们带着好心情，一起看看前方的新风景。A small surprise can make an ordinary afternoon feel special. Keep your curiosity close, and enjoy whatever comes next.',
  },
]

const C_MANDARIN_AUDITION_TEXT = '今天发现了一个有趣的小方法，操作起来很简单，看看这几个步骤，也许马上就能用上。'

export const C_MANDARIN_AUDITION_RECIPES = [
  {
    id: 'Z1', label: '中文 · 年轻清透含笑', file: 'Z1-natural-smiling.wav', model: DESIGN_MODEL,
    prompt: '20–24岁成年女性的声音，以自然略亮的中音区说话，清透、轻柔、顺滑，声线干净有弹性，带着轻松自然的笑意。元音清澈，辅音轻巧清晰，连读流畅，普通话的声调和轻声自然，句内按意思连贯表达。语速自然轻快，短语间停顿简洁，句尾轻巧收住，整体鲜活、有精神，亲切而有吸引力，适合日常网页文本朗读。',
    text: C_MANDARIN_AUDITION_TEXT,
  },
  {
    id: 'Z2', label: '中文 · 明快灵动', file: 'Z2-lively-clear.wav', model: DESIGN_MODEL,
    prompt: '20–24岁成年女性的声音，以自然中音区为主，亮度清新，声线清澈、柔顺、有弹性，语气明快灵动。普通话发音轻巧清晰，轻声自然，语调随句意形成小幅而流畅的起伏，重点信息顺势突出。语速自然略快，句子衔接利落，短停顿保持轻快节奏，声音有精神、亲切、有活力，适合日常网页文本朗读。',
    text: C_MANDARIN_AUDITION_TEXT,
  },
  {
    id: 'Z3', label: '中文 · 自信俏皮有魅力', file: 'Z3-silky-confident.wav', model: DESIGN_MODEL,
    prompt: '20–24岁成年女性的声音，自然中音区略带明亮感，声线轻柔顺滑、清晰有弹性，带着自信俏皮的笑意与亲近的魅力。普通话咬字轻巧干净，连读自然，重点短语有轻盈而鲜明的强调，语调有小幅活泼变化。语速自然轻快，停顿简洁，陈述句尾利落收住，整体清爽、有精神，兼具自然的吸引力与轻松交流感，适合日常网页文本朗读。',
    text: C_MANDARIN_AUDITION_TEXT,
  },
  {
    id: 'Z2-clone', label: 'Z2 固定音色 · 中英迁移验证（并非最终选择）',
    file: 'Z2-clone-bilingual.wav', model: CLONE_MODEL, referenceId: 'Z2',
    prompt: '保留参考音频的说话人音色。用轻快自然的日常交流节奏朗读，语气清新有精神，带一点轻松的笑意；普通话声调、轻声与连读自然，停顿简洁，英文使用自然中性美式发音，语言切换保持同一声线。',
    text: '这个方法很实用，今天就来试试看。This looks useful. Let’s give it a try today.',
  },
]

const PLAYFUL_REFERENCE_TEXT = '这个小发现是不是很有意思？先看看它的用法，再挑一个顺手的步骤，今天就能试起来。'

export const PLAYFUL_REFERENCE_AUDITION_RECIPES = [
  {
    id: 'P1', label: '参考声线 · 自然朗读', file: 'P1-natural.wav', model: CLONE_MODEL, referenceId: 'external',
    prompt: '保留参考音频的说话人音色。用自然的普通话朗读，咬字清楚，停顿按句意处理。',
    text: PLAYFUL_REFERENCE_TEXT,
  },
  {
    id: 'P2', label: '参考声线 · 含笑轻巧俏皮', file: 'P2-smiling-playful.wav', model: CLONE_MODEL, referenceId: 'external',
    prompt: '保留参考音频的说话人音色。带着轻松自然的笑意朗读，语气轻巧俏皮，关键词顺势突出，语调有小幅灵动变化。普通话连读自然，咬字清楚，语速自然流畅，停顿简洁。',
    text: PLAYFUL_REFERENCE_TEXT,
  },
  {
    id: 'P3', label: '参考声线 · 自信柔滑从容', file: 'P3-confident-silky.wav', model: CLONE_MODEL, referenceId: 'external',
    prompt: '保留参考音频的说话人音色。以自信、柔滑、从容的日常交流方式朗读，语句衔接舒展，表达轻松笃定，重点短语自然强调，句尾收束清楚。普通话咬字清楚，语速自然流畅，按句意停顿。',
    text: PLAYFUL_REFERENCE_TEXT,
  },
  {
    id: 'P-EN', label: '参考声线 · 英文迁移验证', file: 'P-English.wav', model: CLONE_MODEL, referenceId: 'external',
    prompt: 'Keep the reference speaker’s voice. Read clearly in natural neutral American English, with conversational pacing and pauses that follow the meaning.',
    text: 'There is something interesting here. Take a look at the idea, choose one simple step, and try it for yourself.',
  },
]

export function getAuditionRecipes(preset = 'default') {
  if (preset === 'default') return AUDITION_RECIPES
  if (preset === 'c-young') return C_YOUNG_AUDITION_RECIPES
  if (preset === 'c-mandarin') return C_MANDARIN_AUDITION_RECIPES
  if (preset === 'playful-reference') return PLAYFUL_REFERENCE_AUDITION_RECIPES
  throw new Error('--preset 仅支持 default、c-young、c-mandarin 或 playful-reference。')
}

export async function loadExternalReference(referencePath, sourceUrl, title) {
  if (typeof referencePath !== 'string' || !referencePath || typeof sourceUrl !== 'string' || !sourceUrl) {
    throw new Error('playful-reference 必须提供 --reference 本地音频与 --reference-source 公开来源页面 URL。')
  }
  let source
  try { source = new URL(sourceUrl) } catch { throw new Error('参考音频来源必须是有效的公开 HTTP 或 HTTPS 页面 URL。') }
  if (!['http:', 'https:'].includes(source.protocol) || source.username || source.password) {
    throw new Error('参考音频来源必须是无用户名或密码的公开 HTTP 或 HTTPS 页面 URL。')
  }
  const extension = extname(referencePath).toLowerCase()
  if (!['.mp3', '.wav'].includes(extension)) throw new Error('外部参考音频仅支持本地 WAV 或 MP3 文件。')
  let bytes
  try { bytes = await readFile(referencePath) } catch { throw new Error('无法读取 --reference 本地参考音频，请检查文件路径。') }
  if (!bytes.length || Math.ceil(bytes.length / 3) * 4 > REFERENCE_BASE64_LIMIT) {
    throw new Error('外部参考音频不能为空，且 Base64 编码不能超过 10 MB。')
  }
  if (extension === '.wav') inspectWav(bytes)
  else if (!(bytes.length >= 4 && (bytes.toString('ascii', 0, 3) === 'ID3' ||
    (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)))) {
    throw new Error('外部参考文件没有有效的 MP3 文件头。')
  }
  const mimeType = extension === '.wav' ? 'audio/wav' : 'audio/mpeg'
  return {
    bytes,
    dataUri: `data:${mimeType};base64,${bytes.toString('base64')}`,
    metadata: {
      file: basename(referencePath), format: extension.slice(1), mimeType,
      sizeBytes: bytes.length, sha256: sha256(bytes),
      sourceUrl: source.toString(), title: typeof title === 'string' && title.trim() ? title.trim() : basename(referencePath),
    },
  }
}

export function validateConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('本地配置必须是 JSON 对象。')
  const apiKey = typeof value.apiKey === 'string' ? value.apiKey.trim() : ''
  if (!apiKey || /^(?:your[ _-]?(?:api|mimo)[ _-]?key|<[^>]+>|填入.*|请填.*|sk-[xX]+|\.{3})$/iu.test(apiKey)) {
    throw new Error('请先在本地配置文件中填写 apiKey；当前值为空或占位，未发送请求。')
  }
  const baseUrl = typeof value.baseUrl === 'string' ? value.baseUrl.trim() : ''
  resolveEndpoint(baseUrl)
  const timeoutMs = value.timeoutMs ?? 300000
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 1800000) {
    throw new Error('timeoutMs 必须是大于 0、不超过 1800000 的毫秒数。')
  }
  return { baseUrl, apiKey, timeoutMs: Math.round(timeoutMs) }
}

export function resolveEndpoint(baseUrl) {
  let url
  try { url = new URL(baseUrl) } catch { throw new Error('请填写有效的 MiMo baseUrl。') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('baseUrl 必须是无用户名、密码、查询参数和片段的 HTTP 或 HTTPS 地址。')
  }
  const path = url.pathname.replace(/\/+$/u, '')
  url.pathname = path.endsWith('/chat/completions') ? path
    : path.endsWith('/v1') ? `${path}/chat/completions`
      : `${path}/v1/chat/completions`
  return url.toString()
}

export function buildSynthesisBody(recipe, referenceDataUri) {
  const audio = { format: 'wav' }
  if (recipe.model === DESIGN_MODEL) audio.optimize_text_preview = false
  else if (recipe.model === CLONE_MODEL) {
    if (typeof referenceDataUri !== 'string' || !/^data:audio\/(?:wav|mpeg|mp3);base64,/u.test(referenceDataUri)) {
      throw new Error('声音克隆必须使用有效的 WAV 或 MP3 参考音频。')
    }
    if (referenceDataUri.slice(referenceDataUri.indexOf(',') + 1).length > REFERENCE_BASE64_LIMIT) {
      throw new Error('参考音频的 Base64 编码超过 10 MB。')
    }
    audio.voice = referenceDataUri
  } else throw new Error('试听方案包含不支持的模型。')
  return {
    model: recipe.model,
    messages: [
      { role: 'user', content: recipe.prompt },
      { role: 'assistant', content: recipe.text },
    ],
    audio,
    stream: false,
  }
}

/** Only a short sanitized message is printable; never print config, headers or response bodies. */
export function sanitizeMessage(message, secrets = []) {
  let safe = String(message || '未知错误')
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret) safe = safe.split(secret).join('[已隐藏]')
  }
  safe = safe.replace(/data:audio\/[\w.+-]+;base64,[A-Za-z0-9+/=\r\n]+/giu, '[参考音频已隐藏]')
    .replace(/\bBearer\s+[^\s,;"'<>]+/giu, 'Bearer [已隐藏]')
    .replace(/(api[-_ ]?key\s*[=:]\s*["']?)[^\s,;"'<>]+/giu, '$1[已隐藏]')
  return safe.replace(/[\r\n]+/gu, ' ').slice(0, 300)
}

export function inspectWav(bytes) {
  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes)
  if (bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' ||
    bytes.toString('ascii', 8, 12) !== 'WAVE' || bytes.readUInt32LE(4) + 8 !== bytes.length) {
    throw new Error('返回文件不是有效的 RIFF/WAVE 音频，或 RIFF 长度不匹配。')
  }
  let format
  const dataChunks = []
  for (let offset = 12; offset < bytes.length;) {
    if (offset + 8 > bytes.length) throw new Error('WAV 区块头不完整。')
    const id = bytes.toString('ascii', offset, offset + 4)
    const size = bytes.readUInt32LE(offset + 4)
    const start = offset + 8
    const end = start + size
    if (end > bytes.length) throw new Error('WAV 区块长度超出文件范围。')
    if (id === 'fmt ') {
      if (size < 16) throw new Error('WAV 缺少有效的音频格式信息。')
      let encoding = bytes.readUInt16LE(start)
      if (encoding === 0xfffe && size >= 40) encoding = bytes.readUInt16LE(start + 24)
      format = {
        encoding, channels: bytes.readUInt16LE(start + 2),
        sampleRate: bytes.readUInt32LE(start + 4), byteRate: bytes.readUInt32LE(start + 8),
        blockAlign: bytes.readUInt16LE(start + 12), bitsPerSample: bytes.readUInt16LE(start + 14),
      }
    } else if (id === 'data') dataChunks.push(bytes.subarray(start, end))
    offset = end + (size % 2)
    if (offset > bytes.length) throw new Error('WAV 缺少区块填充字节。')
  }
  if (!format || ![1, 3].includes(format.encoding) || !format.channels || !format.sampleRate ||
    ![8, 16, 24, 32, 64].includes(format.bitsPerSample) ||
    (format.encoding === 3 && ![32, 64].includes(format.bitsPerSample)) ||
    (format.encoding === 1 && format.bitsPerSample === 64)) {
    throw new Error('WAV 音频格式不是支持的 PCM 或浮点编码。')
  }
  const bytesPerSample = format.bitsPerSample / 8
  if (format.blockAlign !== format.channels * bytesPerSample ||
    format.byteRate !== format.sampleRate * format.blockAlign) {
    throw new Error('WAV 采样率、帧大小或码率信息不一致。')
  }
  const dataBytes = dataChunks.reduce((sum, chunk) => sum + chunk.length, 0)
  if (!dataBytes || dataChunks.some((chunk) => chunk.length % format.blockAlign)) {
    throw new Error('WAV 音频没有完整的采样帧。')
  }
  let audibleSample = false
  for (const chunk of dataChunks) {
    for (let offset = 0; offset < chunk.length; offset += bytesPerSample) {
      const sample = format.encoding === 3
        ? bytesPerSample === 4 ? chunk.readFloatLE(offset) : chunk.readDoubleLE(offset)
        : bytesPerSample === 1 ? chunk[offset] - 128 : chunk.readIntLE(offset, bytesPerSample)
      if (!Number.isFinite(sample)) throw new Error('WAV 包含无效采样值。')
      if (sample !== 0) audibleSample = true
    }
  }
  if (!audibleSample) throw new Error('WAV 只有静音采样。')
  return {
    format: format.encoding === 1 ? 'PCM' : 'IEEE_FLOAT',
    sampleRate: format.sampleRate, channels: format.channels, bitsPerSample: format.bitsPerSample,
    durationSeconds: dataBytes / format.byteRate, sizeBytes: bytes.length,
  }
}

export async function synthesizeWav(config, recipe, referenceDataUri, fetchImpl = globalThis.fetch) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs)
  const secrets = [config.apiKey, referenceDataUri]
  if (typeof referenceDataUri === 'string' && referenceDataUri.includes(',')) {
    secrets.push(referenceDataUri.slice(referenceDataUri.indexOf(',') + 1))
  }
  try {
    const response = await fetchImpl(resolveEndpoint(config.baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify(buildSynthesisBody(recipe, referenceDataUri)), signal: controller.signal,
    })
    let body
    try { body = await response.json() } catch { throw new Error(`MiMo 接口返回 ${response.status}，响应不是有效 JSON。`) }
    if (!response.ok || body?.error) {
      const message = typeof body?.error?.message === 'string' ? body.error.message
        : typeof body?.error === 'string' ? body.error
          : typeof body?.message === 'string' ? body.message : '请检查接口配置或账号状态。'
      throw new Error(`MiMo 接口返回 ${response.status}：${sanitizeMessage(message, secrets)}`)
    }
    const data = body?.choices?.[0]?.message?.audio?.data
    if (typeof data !== 'string' || !data || data.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(data)) {
      throw new Error('MiMo 接口未返回有效的 Base64 音频。')
    }
    const bytes = Buffer.from(data, 'base64')
    return { bytes, metadata: inspectWav(bytes) }
  } catch (error) {
    if (controller.signal.aborted) throw new Error('MiMo 试听请求超时，本次未保存音频。')
    throw new Error(sanitizeMessage(error instanceof Error ? error.message : 'MiMo 试听请求失败。', secrets))
  } finally {
    clearTimeout(timeout)
  }
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

async function exists(path) {
  try { await stat(path); return true } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

async function saveManifest(path, manifest) {
  const temporaryPath = `${path}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  await rename(temporaryPath, path)
}

export async function runAudition({
  configPath, outDir, preset = 'default', referencePath, referenceSource, referenceTitle,
  fetchImpl = globalThis.fetch, log = console.log,
}) {
  const recipes = getAuditionRecipes(preset)
  const externalReference = preset === 'playful-reference'
    ? await loadExternalReference(referencePath, referenceSource, referenceTitle)
    : undefined
  if (preset !== 'playful-reference' &&
    [referencePath, referenceSource, referenceTitle].some((value) => value !== undefined)) {
    throw new Error('外部参考音频选项仅适用于 --preset playful-reference。')
  }
  if (!isAbsolute(outDir)) throw new Error('--out 必须是可写目录的绝对路径。')
  let rawConfig
  try { rawConfig = JSON.parse(await readFile(configPath, 'utf8')) } catch {
    throw new Error('无法读取本地 JSON 配置，请检查 --config 路径与 JSON 格式。')
  }
  const config = validateConfig(rawConfig)
  const recipeHash = sha256(JSON.stringify(recipes))
  await mkdir(outDir, { recursive: true })
  const manifestPath = join(outDir, 'manifest.json')
  let manifest = {
    version: 1, recipeHash, createdAt: new Date().toISOString(),
    ...(preset === 'default' ? {} : { preset }),
    ...(externalReference ? { reference: externalReference.metadata } : {}),
    notes: preset === 'default'
      ? 'A–D 为独立设计试听；A-clone-CN/EN 使用同一份 A WAV，仅验证克隆一致性，并非用户最终选择。'
      : preset === 'c-young'
        ? 'C1–C3 为第二轮年轻明快音色设计；C2-clone 使用同一份 C2 WAV，仅验证中英克隆一致性，并非用户最终选择。'
        : preset === 'c-mandarin'
          ? 'Z1–Z3 为中文年轻鲜活音色设计；Z2-clone 使用同一份中文 Z2 WAV，仅验证中英迁移和克隆一致性，并非用户最终选择。'
          : 'P1–P3 使用同一份外部参考音频，仅比较原创中文文本的朗读方式；P-EN 验证英文迁移。来源见 reference，不复用参考台词。',
    samples: [],
  }
  if (await exists(manifestPath)) {
    try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')) } catch {
      throw new Error('已有 manifest.json 无法读取，请换用新的空输出目录。')
    }
    if (manifest.version !== 1 || manifest.recipeHash !== recipeHash || !Array.isArray(manifest.samples)) {
      throw new Error('已有试听清单与本次方案不一致，请换用新的空输出目录。')
    }
    if (externalReference && (manifest.reference?.sha256 !== externalReference.metadata.sha256 ||
      manifest.reference?.mimeType !== externalReference.metadata.mimeType)) {
      throw new Error('外部参考音频已被修改，请换用新的空输出目录。')
    }
  } else await saveManifest(manifestPath, manifest)

  const completed = new Map()
  if (externalReference) completed.set('external', { bytes: externalReference.bytes, sha256: externalReference.metadata.sha256 })
  for (const recipe of recipes) {
    const path = join(outDir, recipe.file)
    const saved = manifest.samples.find((sample) => sample.id === recipe.id)
    if (saved) {
      if (saved.model !== recipe.model || saved.prompt !== recipe.prompt || saved.text !== recipe.text || saved.file !== recipe.file) {
        throw new Error('已有样本的生成方案不匹配，请换用新的空输出目录。')
      }
      const bytes = await readFile(path)
      inspectWav(bytes)
      if (sha256(bytes) !== saved.sha256 ||
        (recipe.referenceId && saved.referenceSha256 !== completed.get(recipe.referenceId)?.sha256)) {
        throw new Error('已有样本或参考音频已被修改，请换用新的空输出目录。')
      }
      completed.set(recipe.id, { bytes, sha256: saved.sha256 })
      log(`${recipe.id}：已验证现有样本，跳过请求。`)
      continue
    }
    if (await exists(path)) throw new Error(`${recipe.id} 已有音频文件但没有匹配的清单记录，请换用新的空输出目录。`)
    const reference = recipe.referenceId ? completed.get(recipe.referenceId) : undefined
    const referenceDataUri = recipe.referenceId === 'external'
      ? externalReference.dataUri
      : reference ? `data:audio/wav;base64,${reference.bytes.toString('base64')}` : undefined
    log(`${recipe.id}：正在生成${recipe.label}。`)
    const { bytes, metadata } = await synthesizeWav(config, recipe, referenceDataUri, fetchImpl)
    const hash = sha256(bytes)
    await writeFile(path, bytes, { flag: 'wx' })
    manifest.samples.push({
      ...recipe, ...metadata, sha256: hash,
      ...(reference ? { referenceSha256: reference.sha256 } : {}),
      generatedAt: new Date().toISOString(),
    })
    await saveManifest(manifestPath, manifest)
    completed.set(recipe.id, { bytes, sha256: hash })
    log(`${recipe.id}：已保存，${metadata.durationSeconds.toFixed(2)} 秒，${metadata.sampleRate} Hz，${metadata.channels} 声道。`)
  }
  return manifest
}

const USAGE = '用法：node scripts/mimo-voice-audition.mjs --config <本地 JSON 配置> --out <绝对输出目录> [--preset default|c-young|c-mandarin|playful-reference] [--reference <本地 MP3/WAV> --reference-source <公开来源页面 URL> [--reference-title <片段标题>]]'

export function parseArguments(args) {
  if (args.length === 1 && args[0] === '--help') return { help: true }
  const values = new Map()
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index]
    const value = args[index + 1]
    if (!['--config', '--out', '--preset', '--reference', '--reference-source', '--reference-title'].includes(option) || values.has(option) ||
      typeof value !== 'string' || !value || value.startsWith('--')) {
      throw new Error(USAGE)
    }
    values.set(option, value)
  }
  if (!values.has('--config') || !values.has('--out')) throw new Error(USAGE)
  const preset = values.get('--preset') ?? 'default'
  getAuditionRecipes(preset)
  if (preset === 'playful-reference' && (!values.has('--reference') || !values.has('--reference-source'))) {
    throw new Error('playful-reference 必须提供 --reference 本地音频与 --reference-source 公开来源页面 URL。')
  }
  if (preset !== 'playful-reference' &&
    ['--reference', '--reference-source', '--reference-title'].some((option) => values.has(option))) {
    throw new Error('外部参考音频选项仅适用于 --preset playful-reference。')
  }
  return {
    configPath: resolve(values.get('--config')), outDir: values.get('--out'), preset,
    ...(values.has('--reference') ? { referencePath: resolve(values.get('--reference')) } : {}),
    ...(values.has('--reference-source') ? { referenceSource: values.get('--reference-source') } : {}),
    ...(values.has('--reference-title') ? { referenceTitle: values.get('--reference-title') } : {}),
  }
}

async function main(args) {
  const options = parseArguments(args)
  if (options.help) { console.log(USAGE); return }
  await runAudition(options)
  console.log(`${getAuditionRecipes(options.preset).length} 个试听样本已生成或验证，详情见输出目录中的 manifest.json。`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    // Functions sanitize provider failures before this point. Never log error stacks or causes.
    console.error(error instanceof Error ? error.message : '生成试听失败。')
    process.exitCode = 1
  })
}
