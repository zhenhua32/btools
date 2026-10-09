import { strict as assert } from 'node:assert'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  AUDITION_RECIPES, C_YOUNG_AUDITION_RECIPES, C_MANDARIN_AUDITION_RECIPES,
  PLAYFUL_REFERENCE_AUDITION_RECIPES, buildSynthesisBody, getAuditionRecipes,
  inspectWav, loadExternalReference, parseArguments, resolveEndpoint,
  runAudition, sanitizeMessage, synthesizeWav, validateConfig,
} from './mimo-voice-audition.mjs'

function wav(sample = 1000) {
  const bytes = Buffer.alloc(48)
  bytes.write('RIFF', 0)
  bytes.writeUInt32LE(40, 4)
  bytes.write('WAVEfmt ', 8)
  bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20)
  bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(24000, 24)
  bytes.writeUInt32LE(48000, 28)
  bytes.writeUInt16LE(2, 32)
  bytes.writeUInt16LE(16, 34)
  bytes.write('data', 36)
  bytes.writeUInt32LE(4, 40)
  bytes.writeInt16LE(sample, 44)
  bytes.writeInt16LE(-sample, 46)
  return bytes
}

function mp3(marker = 1) {
  const bytes = Buffer.alloc(32, marker)
  bytes[0] = 0xff
  bytes[1] = 0xfb
  return bytes
}

test('validates credentials before requests and never includes them in errors', () => {
  for (const apiKey of ['', 'YOUR_API_KEY', '<MIMO_API_KEY>', 'sk-xxxx']) {
    assert.throws(() => validateConfig({ apiKey, baseUrl: 'https://api.xiaomimimo.com/v1' }), /未发送请求/u)
  }
  assert.equal(resolveEndpoint('https://api.xiaomimimo.com/v1'), 'https://api.xiaomimimo.com/v1/chat/completions')
  assert.throws(() => resolveEndpoint('https://api.xiaomimimo.com/v1?api-key=secret'), /查询参数/u)
  assert.equal(sanitizeMessage('failed Bearer top-secret api-key=another', ['top-secret']), 'failed Bearer [已隐藏] api-key=[已隐藏]')
})

test('CLI chooses c-young explicitly while preserving the old default six recipes', () => {
  const original = parseArguments(['--config', 'local.json', '--out', join(tmpdir(), 'voices')])
  assert.equal(original.preset, 'default')
  assert.equal(getAuditionRecipes(original.preset), AUDITION_RECIPES)
  assert.deepEqual(AUDITION_RECIPES.map((recipe) => recipe.id), ['A', 'B', 'C', 'D', 'A-clone-CN', 'A-clone-EN'])
  const secondRound = parseArguments(['--preset', 'c-young', '--out', join(tmpdir(), 'voices'), '--config', 'local.json'])
  assert.equal(secondRound.preset, 'c-young')
  assert.equal(getAuditionRecipes(secondRound.preset), C_YOUNG_AUDITION_RECIPES)
  assert.deepEqual(C_YOUNG_AUDITION_RECIPES.map((recipe) => recipe.id), ['C1', 'C2', 'C3', 'C2-clone'])
  assert.ok(C_YOUNG_AUDITION_RECIPES.slice(0, 3).every((recipe) => recipe.text === C_YOUNG_AUDITION_RECIPES[0].text))
  assert.throws(() => parseArguments(['--config', 'local.json', '--out', 'voices', '--preset', 'unknown']), /仅支持/u)
  assert.throws(() => parseArguments(['--config', 'local.json', '--config', 'other.json', '--out', 'voices']), /用法/u)
})

test('CLI chooses Mandarin-only designs and preserves both previous recipe hashes', () => {
  const options = parseArguments(['--config', 'local.json', '--out', join(tmpdir(), 'voices'), '--preset', 'c-mandarin'])
  assert.equal(options.preset, 'c-mandarin')
  assert.equal(getAuditionRecipes(options.preset), C_MANDARIN_AUDITION_RECIPES)
  assert.deepEqual(C_MANDARIN_AUDITION_RECIPES.map((recipe) => recipe.id), ['Z1', 'Z2', 'Z3', 'Z2-clone'])
  assert.ok(C_MANDARIN_AUDITION_RECIPES.slice(0, 3).every((recipe) =>
    recipe.text === C_MANDARIN_AUDITION_RECIPES[0].text && !/[A-Za-z]/u.test(recipe.text)))
  const hash = (preset) => createHash('sha256').update(JSON.stringify(getAuditionRecipes(preset))).digest('hex')
  assert.equal(hash('default'), 'bd5940f16fc13a1d9fcd073f791a2e6eb56e6755542a1bb0e31b9dd454e79595')
  assert.equal(hash('c-young'), '6a482457d4e4ba4ab487040a9717cca31ee36f6bab730b6f3b9259b7ed1fef79')
  assert.equal(hash('c-mandarin'), '5c555021ab7d81f3333e6dbfdc960daca0d8d91dadadd40e827a6d87610daad0')
})

test('playful-reference CLI requires local reference and provenance before execution', () => {
  const baseArgs = ['--config', 'local.json', '--out', join(tmpdir(), 'voices'), '--preset', 'playful-reference']
  assert.throws(() => parseArguments(baseArgs), /必须提供/u)
  const options = parseArguments([...baseArgs, '--reference', 'voice.mp3',
    '--reference-source', 'https://example.com/public-voice-page', '--reference-title', '日常问候'])
  assert.equal(options.preset, 'playful-reference')
  assert.ok(options.referencePath.endsWith('voice.mp3'))
  assert.equal(options.referenceTitle, '日常问候')
  const recipes = getAuditionRecipes(options.preset)
  assert.equal(recipes, PLAYFUL_REFERENCE_AUDITION_RECIPES)
  assert.equal(recipes.length, 4)
  assert.ok(recipes.every((recipe) => recipe.model === 'mimo-v2.5-tts-voiceclone' && recipe.referenceId === 'external'))
  assert.ok(recipes.slice(0, 3).every((recipe) => recipe.text === recipes[0].text))
  assert.throws(() => parseArguments(['--config', 'local.json', '--out', 'voices', '--reference', 'voice.mp3']), /仅适用于/u)
})

test('external reference loader rejects missing, unsupported, oversized and invalid files', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'btools-mimo-reference-check-'))
  const source = 'https://example.com/public-voice-page'
  await assert.rejects(loadExternalReference(undefined, source), /必须提供/u)
  await assert.rejects(loadExternalReference(join(folder, 'missing.mp3'), source), /无法读取/u)
  await assert.rejects(loadExternalReference(join(folder, 'voice.ogg'), source), /仅支持/u)
  const invalidPath = join(folder, 'invalid.mp3')
  await writeFile(invalidPath, Buffer.from('not an audio file'))
  await assert.rejects(loadExternalReference(invalidPath, source), /MP3 文件头/u)
  const oversizedPath = join(folder, 'large.mp3')
  await writeFile(oversizedPath, Buffer.alloc(7_500_001))
  await assert.rejects(loadExternalReference(oversizedPath, source), /10 MB/u)
})

test('design and clone use their documented payloads, fixed text and reference requirements', () => {
  const design = buildSynthesisBody(AUDITION_RECIPES[0])
  assert.equal(design.stream, false)
  assert.deepEqual(design.audio, { format: 'wav', optimize_text_preview: false })
  assert.equal(design.messages[0].role, 'user')
  assert.equal(design.messages[1].role, 'assistant')
  assert.ok(AUDITION_RECIPES.slice(0, 4).every((recipe) => recipe.text === design.messages[1].content))
  const reference = `data:audio/wav;base64,${wav().toString('base64')}`
  const clone = buildSynthesisBody(AUDITION_RECIPES[4], reference)
  assert.deepEqual(clone.audio, { format: 'wav', voice: reference })
  assert.throws(() => buildSynthesisBody(AUDITION_RECIPES[4]), /参考音频/u)
  assert.throws(() => buildSynthesisBody(AUDITION_RECIPES[4], `data:audio/wav;base64,${'a'.repeat(10_000_001)}`), /10 MB/u)
})

test('checks WAV lengths, PCM rate/frame metadata and nonzero samples', () => {
  assert.deepEqual(inspectWav(wav()), {
    format: 'PCM', sampleRate: 24000, channels: 1, bitsPerSample: 16,
    durationSeconds: 2 / 24000, sizeBytes: 48,
  })
  assert.throws(() => inspectWav(wav().subarray(0, 47)), /RIFF 长度/u)
  assert.throws(() => inspectWav(wav(0)), /静音/u)
  const broken = wav()
  broken.writeUInt32LE(44100, 24)
  assert.throws(() => inspectWav(broken), /不一致/u)
})

test('sanitizes provider and transport failures without dumping response bodies', async () => {
  const config = { baseUrl: 'https://api.xiaomimimo.com/v1', apiKey: 'private-test-token', timeoutMs: 1000 }
  await assert.rejects(synthesizeWav(config, AUDITION_RECIPES[0], undefined,
    async () => Response.json({ error: { message: `bad token ${config.apiKey}` } }, { status: 401 })),
  (error) => error.message.includes('[已隐藏]') && !error.message.includes(config.apiKey))
  await assert.rejects(synthesizeWav(config, AUDITION_RECIPES[0], undefined,
    async () => { throw new Error(`request used Bearer ${config.apiKey}`) }),
  (error) => !error.message.includes(config.apiKey))
})

test('redacts provider echoes of the reference URI, raw base64 and other audio data URLs', async () => {
  const config = { baseUrl: 'https://api.xiaomimimo.com/v1', apiKey: 'private-test-token', timeoutMs: 1000 }
  const rawAudio = mp3(9).toString('base64')
  const reference = `data:audio/mpeg;base64,${rawAudio}`
  const otherAudio = 'data:audio/x-wav;base64,AQIDBA=='
  await assert.rejects(synthesizeWav(config, PLAYFUL_REFERENCE_AUDITION_RECIPES[0], reference,
    async () => Response.json({ error: { message: `voice=${reference}; raw=${rawAudio}; token=${config.apiKey}; other=${otherAudio}` } }, { status: 400 })),
  (error) => !error.message.includes(reference) && !error.message.includes(rawAudio) &&
    !error.message.includes(config.apiKey) && !error.message.includes(otherAudio) && error.message.includes('[已隐藏]'))
})

test('makes six requests, clones the exact A WAV, saves safe metadata and resumes without calls', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'btools-mimo-audition-'))
  const configPath = join(folder, 'local.json')
  const outDir = join(folder, 'out')
  const key = 'private-local-config-key'
  await writeFile(configPath, JSON.stringify({ baseUrl: 'https://api.xiaomimimo.com/v1', apiKey: key, timeoutMs: 1000 }))
  const bodies = []
  const messages = []
  const fetchImpl = async (url, request) => {
    assert.equal(url, 'https://api.xiaomimimo.com/v1/chat/completions')
    assert.equal(request.headers.Authorization, `Bearer ${key}`)
    bodies.push(JSON.parse(request.body))
    return Response.json({ choices: [{ message: { audio: { data: wav().toString('base64') } } }] })
  }
  const manifest = await runAudition({ configPath, outDir, fetchImpl, log: (message) => messages.push(message) })
  assert.equal(bodies.length, 6)
  assert.equal(manifest.samples.length, 6)
  const reference = `data:audio/wav;base64,${(await readFile(join(outDir, 'A-low-magnetic.wav'))).toString('base64')}`
  assert.equal(bodies[4].audio.voice, reference)
  assert.equal(bodies[5].audio.voice, reference)
  assert.ok(!JSON.stringify(manifest).includes(key))
  assert.ok(!messages.join('\n').includes(key))
  assert.ok(!JSON.stringify(manifest).includes('data:audio/wav;base64,'))
  await runAudition({ configPath, outDir, fetchImpl, log: () => {} })
  assert.equal(bodies.length, 6)
  await writeFile(join(outDir, 'A-low-magnetic.wav'), wav(2000))
  await assert.rejects(runAudition({ configPath, outDir, fetchImpl, log: () => {} }), /已被修改/u)
  assert.equal(bodies.length, 6)
})

test('c-young makes four requests, clones exact C2 bytes and refuses a different recipe on resume', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'btools-mimo-young-'))
  const configPath = join(folder, 'local.json')
  const outDir = join(folder, 'out')
  await writeFile(configPath, JSON.stringify({ baseUrl: 'https://api.xiaomimimo.com/v1', apiKey: 'offline-test-key', timeoutMs: 1000 }))
  const bodies = []
  const fetchImpl = async (_url, request) => {
    bodies.push(JSON.parse(request.body))
    // Distinct PCM makes selecting C2 instead of C1/C3 observable in the clone request.
    return Response.json({ choices: [{ message: { audio: { data: wav(1000 + bodies.length).toString('base64') } } }] })
  }
  const manifest = await runAudition({ configPath, outDir, preset: 'c-young', fetchImpl, log: () => {} })
  assert.equal(bodies.length, 4)
  assert.equal(manifest.preset, 'c-young')
  assert.equal(manifest.samples.length, 4)
  const c2 = await readFile(join(outDir, 'C2-bright-lively.wav'))
  assert.equal(bodies[3].audio.voice, `data:audio/wav;base64,${c2.toString('base64')}`)
  assert.equal(bodies[3].model, 'mimo-v2.5-tts-voiceclone')
  assert.equal(manifest.samples[3].referenceSha256, manifest.samples[1].sha256)
  await runAudition({ configPath, outDir, preset: 'c-young', fetchImpl, log: () => {} })
  assert.equal(bodies.length, 4)
  await assert.rejects(runAudition({ configPath, outDir, fetchImpl, log: () => {} }), /方案不一致/u)
  assert.equal(bodies.length, 4)
})

test('c-mandarin makes four requests, clones exact Chinese Z2 and resumes only its matching preset', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'btools-mimo-mandarin-'))
  const configPath = join(folder, 'local.json')
  const outDir = join(folder, 'out')
  await writeFile(configPath, JSON.stringify({ baseUrl: 'https://api.xiaomimimo.com/v1', apiKey: 'offline-test-key', timeoutMs: 1000 }))
  const bodies = []
  const fetchImpl = async (_url, request) => {
    bodies.push(JSON.parse(request.body))
    return Response.json({ choices: [{ message: { audio: { data: wav(2000 + bodies.length).toString('base64') } } }] })
  }
  const manifest = await runAudition({ configPath, outDir, preset: 'c-mandarin', fetchImpl, log: () => {} })
  assert.equal(bodies.length, 4)
  assert.equal(manifest.preset, 'c-mandarin')
  assert.equal(manifest.samples.length, 4)
  assert.ok(bodies.slice(0, 3).every((body) => !/[A-Za-z]/u.test(body.messages[1].content)))
  const z2 = await readFile(join(outDir, 'Z2-lively-clear.wav'))
  assert.equal(bodies[3].audio.voice, `data:audio/wav;base64,${z2.toString('base64')}`)
  assert.equal(bodies[3].model, 'mimo-v2.5-tts-voiceclone')
  assert.equal(manifest.samples[3].referenceSha256, manifest.samples[1].sha256)
  await runAudition({ configPath, outDir, preset: 'c-mandarin', fetchImpl, log: () => {} })
  assert.equal(bodies.length, 4)
  await assert.rejects(runAudition({ configPath, outDir, preset: 'c-young', fetchImpl, log: () => {} }), /方案不一致/u)
  await assert.rejects(runAudition({ configPath, outDir, fetchImpl, log: () => {} }), /方案不一致/u)
  assert.equal(bodies.length, 4)
})

test('four external-reference clones share exact MP3 bytes, record provenance and reject changed references', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'btools-mimo-playful-'))
  const configPath = join(folder, 'local.json')
  const referencePath = join(folder, 'voice.mp3')
  const outDir = join(folder, 'out')
  const referenceBytes = mp3(7)
  await writeFile(referencePath, referenceBytes)
  await writeFile(configPath, JSON.stringify({ baseUrl: 'https://api.xiaomimimo.com/v1', apiKey: 'offline-test-key', timeoutMs: 1000 }))
  const bodies = []
  const fetchImpl = async (_url, request) => {
    bodies.push(JSON.parse(request.body))
    return Response.json({ choices: [{ message: { audio: { data: wav(3000 + bodies.length).toString('base64') } } }] })
  }
  const options = {
    configPath, outDir, preset: 'playful-reference', referencePath,
    referenceSource: 'https://example.com/public-voice-page', referenceTitle: '日常问候', fetchImpl, log: () => {},
  }
  const manifest = await runAudition(options)
  assert.equal(bodies.length, 4)
  assert.ok(bodies.every((body) => body.audio.voice === `data:audio/mpeg;base64,${referenceBytes.toString('base64')}`))
  assert.deepEqual(manifest.samples.map((sample) => sample.referenceSha256), Array(4).fill(manifest.reference.sha256))
  assert.equal(manifest.reference.mimeType, 'audio/mpeg')
  assert.equal(manifest.reference.sizeBytes, referenceBytes.length)
  assert.equal(manifest.reference.title, '日常问候')
  assert.equal(manifest.reference.sourceUrl, options.referenceSource)
  assert.ok(!JSON.stringify(manifest).includes('base64,'))
  assert.ok(!JSON.stringify(manifest).includes('offline-test-key'))
  await runAudition(options)
  assert.equal(bodies.length, 4)
  await writeFile(referencePath, mp3(8))
  await assert.rejects(runAudition(options), /外部参考音频已被修改/u)
  assert.equal(bodies.length, 4)
})
