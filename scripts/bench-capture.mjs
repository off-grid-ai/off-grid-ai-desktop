#!/usr/bin/env node
// Benchmark the capture→understanding pipeline on REAL stored frames, so the
// OCR-vs-vision decision is made with numbers, not vibes. Standalone (no Electron):
// it calls the bundled OCR binary directly and posts to the live llama-server.
//
// Legs:
//   ocr       — run Apple Vision OCR on the frame (text extraction)          [current]
//   text-llm  — send the OCR text to the model                              [current]
//   vision    — send the frame IMAGE (+ optional OCR text) to the model      [proposed]
//
// The "current pipeline" per-frame cost is (ocr + text-llm). The proposed cost is
// (vision) or (ocr + vision) if you keep OCR as the text ground-truth.
//
// Usage:
//   node scripts/bench-capture.mjs --n 12                 # baseline: ocr + text-llm
//   node scripts/bench-capture.mjs --n 12 --vision        # add the vision leg
//   node scripts/bench-capture.mjs --n 12 --vision --with-ocr-in-vision
//   options: --dir <capturesDir> --port 8439 --ocr <binPath> --max-tokens 512

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const execFileAsync = promisify(execFile)

// ---- args ----
const argv = process.argv.slice(2)
const arg = (flag, def) => {
  const i = argv.indexOf(flag)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def
}
const has = (flag) => argv.includes(flag)

const CAPTURES = arg(
  '--dir',
  path.join(os.homedir(), 'Library/Application Support/Off Grid AI Desktop/captures')
)
const N = Number(arg('--n', '12'))
const PORT = Number(arg('--port', '8439'))
const MAX_TOKENS = Number(arg('--max-tokens', '512'))
const OCR_BIN = arg('--ocr', path.join(process.cwd(), 'electron/accessibility/ocr'))
const DO_VISION = has('--vision')
const OCR_IN_VISION = has('--with-ocr-in-vision')

const ENDPOINT = `http://127.0.0.1:${PORT}/v1/chat/completions`

// A representative distill instruction (shape of the real observation prompt —
// the timing is dominated by input length + output tokens, not the exact words).
const INSTRUCTION =
  'You log what the user is doing on their computer. From the screen below, reply with a one-sentence factual summary and the people/projects it is about. Be concrete; do not infer.'

// ---- helpers ----
const nowMs = () => Number(process.hrtime.bigint() / 1000n) / 1000

function pickFrames() {
  const files = readdirSync(CAPTURES)
    .filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f))
    .filter((f) => !f.includes('-crop')) // full frames, not the OCR crops
    .map((f) => path.join(CAPTURES, f))
    .map((p) => ({ p, mtime: statSync(p).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, N)
    .map((x) => x.p)
  if (files.length === 0) throw new Error(`no frames in ${CAPTURES}`)
  return files
}

async function ocr(imagePath) {
  const t = nowMs()
  const { stdout } = await execFileAsync(OCR_BIN, [imagePath], { maxBuffer: 32 * 1024 * 1024 })
  return { text: stdout.trim(), ms: nowMs() - t }
}

async function callModel(content, label) {
  const body = JSON.stringify({
    messages: [{ role: 'user', content }],
    max_tokens: MAX_TOKENS,
    temperature: 0.2,
    chat_template_kwargs: { enable_thinking: false }
  })
  const t = nowMs()
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body
  })
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status} ${await res.text().catch(() => '')}`)
  const data = await res.json()
  return {
    ms: nowMs() - t,
    outTokens: data.usage?.completion_tokens ?? 0,
    inTokens: data.usage?.prompt_tokens ?? 0,
    text: data.choices?.[0]?.message?.content ?? ''
  }
}

const textLLM = (ocrText) =>
  callModel(`${INSTRUCTION}\n\nScreen text:\n"""\n${ocrText.slice(0, 4000)}\n"""`, 'text-llm')

function visionContent(imagePath, ocrText) {
  const b64 = readFileSync(imagePath).toString('base64')
  const mime = imagePath.toLowerCase().endsWith('.jpg') ? 'image/jpeg' : 'image/png'
  const text = OCR_IN_VISION
    ? `${INSTRUCTION}\n\nExact on-screen text (ground truth):\n"""\n${ocrText.slice(0, 4000)}\n"""\n\nNow read the screenshot for layout/structure and answer.`
    : INSTRUCTION
  return [
    { type: 'text', text },
    { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } }
  ]
}

// ---- stats ----
function stats(xs) {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const q = (p) => s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]
  const mean = s.reduce((a, b) => a + b, 0) / s.length
  return { n: s.length, mean, p50: q(50), p95: q(95), min: s[0], max: s[s.length - 1] }
}
const fmt = (v) => (v == null ? '—' : `${v.toFixed(0)}`.padStart(6))
function row(name, st) {
  if (!st) return `  ${name.padEnd(22)} (no data)`
  return `  ${name.padEnd(22)} mean ${fmt(st.mean)}  p50 ${fmt(st.p50)}  p95 ${fmt(st.p95)}  min ${fmt(st.min)}  max ${fmt(st.max)}   (ms, n=${st.n})`
}

// ---- run ----
async function main() {
  console.log(`\nBenchmark — ${N} frames from ${CAPTURES}`)
  console.log(`Engine ${ENDPOINT} · max_tokens ${MAX_TOKENS} · vision=${DO_VISION}\n`)

  const frames = pickFrames()

  // Warm-up (model load / prompt-cache), excluded from stats.
  process.stdout.write('warming up… ')
  const warmOcr = await ocr(frames[0])
  await textLLM(warmOcr.text)
  if (DO_VISION) await callModel(visionContent(frames[0], warmOcr.text), 'vision').catch(() => {})
  console.log('done\n')

  const ocrMs = []
  const textMs = []
  const visionMs = []
  const textOut = []
  const visionOut = []

  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]
    const o = await ocr(f)
    ocrMs.push(o.ms)

    const t = await textLLM(o.text)
    textMs.push(t.ms)
    textOut.push(t.outTokens)

    let vLine = ''
    if (DO_VISION) {
      try {
        const v = await callModel(visionContent(f, o.text), 'vision')
        visionMs.push(v.ms)
        visionOut.push(v.outTokens)
        vLine = ` · vision ${v.ms.toFixed(0)}ms`
      } catch (e) {
        vLine = ` · vision FAILED (${String(e.message).slice(0, 80)})`
      }
    }
    console.log(
      `  [${String(i + 1).padStart(2)}/${frames.length}] ${path.basename(f).slice(0, 32).padEnd(32)} ocr ${o.ms.toFixed(0)}ms (${o.text.length}c) · text-llm ${t.ms.toFixed(0)}ms${vLine}`
    )
  }

  console.log('\n── per-stage (ms) ──')
  console.log(row('ocr', stats(ocrMs)))
  console.log(row('text-llm', stats(textMs)))
  if (DO_VISION) console.log(row('vision', stats(visionMs)))

  const sum = (xs) => xs.reduce((a, b) => a + b, 0)
  const meanTotalCurrent = (sum(ocrMs) + sum(textMs)) / frames.length
  console.log('\n── per-frame totals ──')
  console.log(`  CURRENT   (ocr + text-llm)   mean ${meanTotalCurrent.toFixed(0)} ms/frame`)
  if (DO_VISION && visionMs.length) {
    const meanVision = sum(visionMs) / visionMs.length
    const meanCombo = (sum(ocrMs) + sum(visionMs)) / visionMs.length
    console.log(`  VISION-ONLY                  mean ${meanVision.toFixed(0)} ms/frame`)
    console.log(`  OCR + VISION                 mean ${meanCombo.toFixed(0)} ms/frame`)
    console.log(
      `\n  vision is ${(meanVision / meanTotalCurrent).toFixed(1)}× the current per-frame cost`
    )
  }
  const perMin = 60000 / meanTotalCurrent
  console.log(
    `\n  sustained throughput (current): ~${perMin.toFixed(0)} frames/min on this machine`
  )
  if (textOut.length) {
    console.log(
      `  output tokens — text-llm mean ${(sum(textOut) / textOut.length).toFixed(0)}${visionOut.length ? `, vision mean ${(sum(visionOut) / visionOut.length).toFixed(0)}` : ''}`
    )
  }
  console.log('')
}

main().catch((e) => {
  console.error('\nbench failed:', e.message)
  process.exit(1)
})
