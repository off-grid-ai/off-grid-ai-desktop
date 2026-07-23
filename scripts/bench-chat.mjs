#!/usr/bin/env node
// Does a bigger conversation history actually slow each turn? Isolate PROMPT-eval cost: hold the
// OUTPUT tiny (max_tokens=16) and grow the INPUT (a filler "history") across sizes, measuring
// time-to-first-token (TTFT ≈ prompt eval + 1 token) and the reported prompt_tokens. If TTFT
// scales with prompt tokens, the "2nd response onwards is slower" report is prompt-eval growth
// from bloated history (which the Auto max-output default enlarges), not a fixed per-turn regression.
//
//   node scripts/bench-chat.mjs                 # default sweep
//   node scripts/bench-chat.mjs --port 8439 --repeats 3

import { performance } from 'node:perf_hooks'

const arg = (f, d) => {
  const i = process.argv.indexOf(f)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d
}
const PORT = Number(arg('--port', '8439'))
const REPEATS = Number(arg('--repeats', '3'))
const ENDPOINT = `http://127.0.0.1:${PORT}/v1/chat/completions`
// Prompt-token targets standing in for a growing chat history. ~500 ≈ turn 1; 8k–32k ≈ a few
// Auto-length answers deep. (Qwen3.5-2B trained ctx is 256K, so all fit.)
const TARGETS = [500, 2000, 4000, 8000, 16000, 32000]

// ~4 chars/token of natural-ish filler; oversize then the model reports the real prompt_tokens.
const SENTENCE =
  'The off-grid system balances solar capacity against battery storage while the controller logs each cycle. '
const fillerForTokens = (tok) => SENTENCE.repeat(Math.ceil((tok * 4) / SENTENCE.length))

let nonce = 0
async function ttft(promptText, { unique = true } = {}) {
  // A unique prefix per call defeats the server's prompt cache so we measure COLD prompt-eval
  // (the cache-miss cost a turn pays when its prefix changed). unique:false reuses the prefix to
  // measure the WARM (cache-hit) cost.
  const tag = unique ? `#${++nonce} ` : ''
  const body = JSON.stringify({
    messages: [
      { role: 'system', content: 'You are concise.' },
      { role: 'user', content: `${tag}${promptText}\n\nReply with exactly: OK` }
    ],
    max_tokens: 16,
    temperature: 0,
    stream: true,
    stream_options: { include_usage: true },
    chat_template_kwargs: { enable_thinking: false }
  })
  const t0 = performance.now()
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let firstAt = 0
  let buf = ''
  let promptTokens = 0
  let done = false
  while (!done) {
    const { value, done: d } = await reader.read()
    if (d) break
    buf += dec.decode(value, { stream: true })
    let nl
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (payload === '[DONE]') {
        done = true
        break
      }
      try {
        const j = JSON.parse(payload)
        const delta = j.choices?.[0]?.delta?.content
        if (delta && firstAt === 0) firstAt = performance.now()
        if (j.usage?.prompt_tokens) promptTokens = j.usage.prompt_tokens
      } catch {
        /* keepalive */
      }
    }
  }
  const total = performance.now() - t0
  return { ttft: firstAt ? firstAt - t0 : total, total, promptTokens }
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

async function main() {
  console.log(`\nChat prompt-eval benchmark · ${ENDPOINT} · ${REPEATS} repeats\n`)
  console.log('warming up…')
  await ttft('warmup').catch(() => {})
  console.log('done\n')
  console.log('target   promptTok   TTFT(med ms)   ms/1k promptTok   total(med ms)')
  const rows = []
  for (const target of TARGETS) {
    const filler = fillerForTokens(target)
    const runs = []
    for (let r = 0; r < REPEATS; r++) runs.push(await ttft(filler))
    const pt = runs[runs.length - 1].promptTokens
    const tt = median(runs.map((r) => r.ttft))
    const tot = median(runs.map((r) => r.total))
    rows.push({ target, pt, tt, tot })
    console.log(
      `${String(target).padStart(6)}   ${String(pt).padStart(8)}   ${tt.toFixed(0).padStart(11)}   ${((tt / pt) * 1000).toFixed(1).padStart(15)}   ${tot.toFixed(0).padStart(12)}`
    )
  }
  const first = rows[0]
  const last = rows[rows.length - 1]
  console.log(
    `\nCOLD TTFT grew ${(last.tt / first.tt).toFixed(1)}× from ${first.pt} to ${last.pt} prompt tokens ` +
      `(${(last.pt / first.pt).toFixed(1)}× the tokens). ~linear ⇒ a cache-MISS turn scales with history.`
  )
  // Decisive: does the SAME big prompt, sent twice, hit the cache the 2nd time? If warm << cold, the
  // engine reuses the KV prefix across turns → a growing history is NOT re-eval'd each turn (so the
  // slowdown must come from something that BUSTS the prefix, e.g. changing injected context).
  const bigFiller = fillerForTokens(16000)
  const cold = await ttft(bigFiller, { unique: true })
  const warm1 = await ttft(bigFiller, { unique: false })
  const warm2 = await ttft(bigFiller, { unique: false })
  console.log(
    `\nCache test @~${cold.promptTokens} promptTok:  cold=${cold.ttft.toFixed(0)}ms  ` +
      `warm=${Math.min(warm1.ttft, warm2.ttft).toFixed(0)}ms  ` +
      `→ ${warm1.ttft < cold.ttft * 0.5 ? 'CACHE REUSED across identical prefixes (history growth is cheap when the prefix is stable)' : 'NO cache benefit (every turn re-evals — history growth is expensive)'}`
  )
}
main().catch((e) => {
  console.error('bench failed:', e.message)
  process.exit(1)
})
