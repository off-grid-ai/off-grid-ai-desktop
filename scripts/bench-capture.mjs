#!/usr/bin/env node
// Benchmark the capture→understanding pipeline on REAL stored frames, so the
// OCR-vs-vision decision is made with numbers, not vibes. Standalone (no Electron):
// it calls the bundled OCR binary directly, downscales with macOS `sips` (the
// provit nativeMacActor approach), and posts to the live llama-server.
//
// Legs timed per frame:
//   ocr          — Apple Vision OCR text extraction            [current pipeline]
//   text-llm     — send the OCR text to the model              [current pipeline]
//   downscale    — sips -Z to cap the longest edge (cuts image TOKENS, the real lever)
//   vision-full  — full-res frame image → model                (contrast, with --full)
//   vision+text  — DOWNSCALED image + text ground-truth → model [CHOSEN: AX + vision]
//
// The chosen path is (downscale + vision+text). In production the text is the
// accessibility tree (≈free to fetch) rather than OCR; here OCR text stands in so
// the prompt-token cost of carrying text is represented. AX replacing OCR only
// makes the chosen path cheaper than shown (no ~700ms OCR at acquisition).
//
// Usage:
//   node scripts/bench-capture.mjs --n 20                    # baseline only (ocr + text-llm)
//   node scripts/bench-capture.mjs --n 20 --vision           # + chosen path (downscale + vision+text)
//   node scripts/bench-capture.mjs --n 20 --vision --full    # + full-res vision for contrast
//   options: --dir <dir> --port 8439 --ocr <bin> --max-dim 1024 --max-tokens 512

import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import { readFileSync, readdirSync, statSync, copyFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const execFileAsync = promisify(execFile)

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
const N = Number(arg('--n', '20'))
const PORT = Number(arg('--port', '8439'))
const MAX_TOKENS = Number(arg('--max-tokens', '512'))
const MAX_DIM = Number(arg('--max-dim', '1024'))
const OCR_BIN = arg('--ocr', path.join(process.cwd(), 'electron/accessibility/ocr'))
const DO_VISION = has('--vision')
const DO_FULL = has('--full')
const SHOW = has('--show') // print each leg's OUTPUT text for quality comparison
const SPREAD = has('--spread') // sample frames evenly across time (variety), not newest-N
const ENDPOINT = `http://127.0.0.1:${PORT}/v1/chat/completions`
const TMP = path.join(os.tmpdir(), 'ogad-bench')

const INSTRUCTION =
  'You log what the user is doing on their computer. From the screen below, reply with a one-sentence factual summary and the people/projects it is about. Be concrete; do not infer.'

const nowMs = () => Number(process.hrtime.bigint() / 1000n) / 1000
const kb = (bytes) => `${(bytes / 1024).toFixed(0)}KB`

function pickFrames() {
  const all = readdirSync(CAPTURES)
    .filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f))
    .filter((f) => !f.includes('-crop'))
    .map((f) => path.join(CAPTURES, f))
    .map((p) => ({ p, mtime: statSync(p).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
  if (all.length === 0) throw new Error(`no frames in ${CAPTURES}`)
  // --spread: sample evenly across the whole set (varied surfaces) for quality eval;
  // otherwise the newest N (fresh, likely-similar) for a tight timing run.
  if (SPREAD && all.length > N) {
    const step = all.length / N
    return Array.from({ length: N }, (_, i) => all[Math.floor(i * step)].p)
  }
  return all.slice(0, N).map((x) => x.p)
}

async function ocr(imagePath) {
  const t = nowMs()
  const { stdout } = await execFileAsync(OCR_BIN, [imagePath], { maxBuffer: 32 * 1024 * 1024 })
  return { text: stdout.trim(), ms: nowMs() - t }
}

// Downscale via macOS sips (provit nativeMacActor pattern): -Z caps the LONGEST
// edge, preserving aspect. To JPEG so the base64 payload is small too. The pixel
// cap is what cuts the mmproj image-token count — the real speed lever.
let tmpMade = false
function downscale(imagePath, maxDim) {
  if (!tmpMade) {
    execFileSync('mkdir', ['-p', TMP])
    tmpMade = true
  }
  const out = path.join(TMP, `${path.basename(imagePath, path.extname(imagePath))}.jpg`)
  const t = nowMs()
  execFileSync('sips', ['-s', 'format', 'jpeg', '-Z', String(maxDim), imagePath, '--out', out], {
    stdio: 'pipe'
  })
  return { path: out, ms: nowMs() - t, bytes: statSync(out).size }
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
    text: data.choices?.[0]?.message?.content ?? ''
  }
}

const textPart = (t) => [{ type: 'text', text: t }]
const textLLM = (ocrText) =>
  callModel(
    textPart(`${INSTRUCTION}\n\nScreen text:\n"""\n${ocrText.slice(0, 4000)}\n"""`),
    'text-llm'
  )

function imagePart(imagePath) {
  const b64 = readFileSync(imagePath).toString('base64')
  const mime = imagePath.toLowerCase().endsWith('.jpg') ? 'image/jpeg' : 'image/png'
  return { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } }
}
const visionFull = (imagePath) =>
  callModel([{ type: 'text', text: INSTRUCTION }, imagePart(imagePath)], 'vision-full')
const visionText = (downPath, text) =>
  callModel(
    [
      {
        type: 'text',
        text: `${INSTRUCTION}\n\nExact on-screen text (ground truth):\n"""\n${text.slice(0, 4000)}\n"""\n\nRead the screenshot for layout/structure and answer.`
      },
      imagePart(downPath)
    ],
    'vision+text'
  )

function stats(xs) {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const q = (p) => s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]
  return {
    n: s.length,
    mean: s.reduce((a, b) => a + b, 0) / s.length,
    p50: q(50),
    p95: q(95),
    min: s[0],
    max: s[s.length - 1]
  }
}
const f = (v) => (v == null ? '   —' : `${v.toFixed(0)}`.padStart(6))
const row = (name, st) =>
  st
    ? `  ${name.padEnd(22)} mean ${f(st.mean)}  p50 ${f(st.p50)}  p95 ${f(st.p95)}   (n=${st.n})`
    : `  ${name.padEnd(22)} (no data)`
const sum = (xs) => xs.reduce((a, b) => a + b, 0)
const mean = (xs) => (xs.length ? sum(xs) / xs.length : 0)

async function main() {
  console.log(`\nBenchmark — ${N} frames · max-dim ${MAX_DIM}px · engine ${ENDPOINT}`)
  console.log(
    `legs: ocr, text-llm${DO_VISION ? ', downscale, vision+text (AX proxy)' : ''}${DO_FULL ? ', vision-full' : ''}\n`
  )
  const frames = pickFrames()

  process.stdout.write('warming up… ')
  const w = await ocr(frames[0])
  await textLLM(w.text)
  if (DO_VISION) {
    const d = downscale(frames[0], MAX_DIM)
    await visionText(d.path, w.text).catch(() => {})
  }
  console.log('done\n')

  const S = { ocr: [], text: [], down: [], vtext: [], vfull: [] }
  const sizes = { full: [], down: [] }
  const out = { text: [], vtext: [] }

  for (let i = 0; i < frames.length; i++) {
    const fr = frames[i]
    const o = await ocr(fr)
    S.ocr.push(o.ms)
    const t = await textLLM(o.text)
    S.text.push(t.ms)
    out.text.push(t.outTokens)
    let line = `ocr ${o.ms.toFixed(0)} · text-llm ${t.ms.toFixed(0)}`
    if (DO_VISION) {
      sizes.full.push(statSync(fr).size)
      const d = downscale(fr, MAX_DIM)
      S.down.push(d.ms)
      sizes.down.push(d.bytes)
      let lastVText = ''
      const lastText = t.text
      try {
        const v = await visionText(d.path, o.text)
        S.vtext.push(v.ms)
        out.vtext.push(v.outTokens)
        lastVText = v.text
        line += ` · downscale ${d.ms.toFixed(0)} (${kb(d.bytes)}) · vision+text ${v.ms.toFixed(0)}`
      } catch (e) {
        line += ` · vision FAILED (${String(e.message).slice(0, 60)})`
      }
      let vfText = ''
      if (DO_FULL) {
        try {
          const vf = await visionFull(fr)
          S.vfull.push(vf.ms)
          vfText = vf.text
        } catch {
          /* skip */
        }
      }
      rmSync(d.path, { force: true })
      // Quality: print each leg's actual answer on the same frame, side by side.
      if (SHOW) {
        const clip = (s) => (s || '').replace(/\s+/g, ' ').trim().slice(0, 260)
        console.log(`\n  ▸ ${path.basename(fr)}`)
        console.log(`    text-llm    : ${clip(lastText)}`)
        if (vfText) console.log(`    vision-only : ${clip(vfText)}`)
        console.log(`    vision+text : ${clip(lastVText)}\n`)
      }
    }
    console.log(`  [${String(i + 1).padStart(2)}/${frames.length}] ${line}`)
  }

  console.log('\n── per-stage (ms) ──')
  console.log(row('ocr', stats(S.ocr)))
  console.log(row('text-llm', stats(S.text)))
  if (DO_VISION) {
    console.log(row('downscale (sips)', stats(S.down)))
    console.log(row('vision+text (down)', stats(S.vtext)))
  }
  if (DO_FULL) console.log(row('vision-full', stats(S.vfull)))

  console.log('\n── per-frame totals ──')
  const cur = mean(S.ocr) + mean(S.text)
  console.log(`  CURRENT  (ocr + text-llm)              ${cur.toFixed(0)} ms`)
  if (DO_VISION && S.vtext.length) {
    const chosenOcr = mean(S.ocr) + mean(S.down) + mean(S.vtext)
    const chosenAx = mean(S.down) + mean(S.vtext) // AX is ~free → drop OCR
    console.log(`  CHOSEN   (ocr + downscale + vision)    ${chosenOcr.toFixed(0)} ms`)
    console.log(
      `  CHOSEN*  (AX + downscale + vision)     ${chosenAx.toFixed(0)} ms   *AX replaces OCR, ~free`
    )
    if (DO_FULL && S.vfull.length)
      console.log(`  (vision on FULL-res image             ${mean(S.vfull).toFixed(0)} ms)`)
    console.log(
      `\n  image size: ${kb(mean(sizes.full))} full → ${kb(mean(sizes.down))} downscaled (${(mean(sizes.full) / Math.max(1, mean(sizes.down))).toFixed(1)}× smaller)`
    )
    console.log(
      `  chosen* vs current: ${(chosenAx / cur).toFixed(2)}× · throughput ~${(60000 / chosenAx).toFixed(0)} frames/min`
    )
    console.log(
      `  output tokens — text ${mean(out.text).toFixed(0)}, vision+text ${mean(out.vtext).toFixed(0)}`
    )
  } else {
    console.log(`  throughput ~${(60000 / cur).toFixed(0)} frames/min`)
  }
  if (tmpMade) rmSync(TMP, { recursive: true, force: true })
  console.log('')
}

main().catch((e) => {
  console.error('\nbench failed:', e.message)
  process.exit(1)
})
