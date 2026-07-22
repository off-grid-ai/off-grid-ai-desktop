// Fallback parser: recover tool calls from the model's TEXT when the server didn't
// surface them on the native `tool_calls` channel. The small on-device models we
// ship (gemma-4, qwen) frequently emit a tool call AS TEXT — `<tool_call>{…}`, a
// fenced ```json block, or a bare {"name","arguments"} object — instead of the
// OpenAI tool_calls field. Without this, those turns silently produce no call and
// the model just narrates what it "would" do. Pure + unit-tested; the loop calls
// it only when the native channel came back empty.

export interface ParsedCall {
  name: string
  args: Record<string, unknown>
}

// Lenient JSON: tolerate the mistakes small models make — curly quotes, trailing
// commas, and (as a last resort) unquoted object keys.
function parseLenient(raw: string): unknown | null {
  const cleaned = raw
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/,\s*([}\]])/g, '$1')
    .trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    /* try quoting bare keys */
  }
  try {
    return JSON.parse(cleaned.replace(/([{,]\s*)([A-Za-z_][\w-]*)\s*:/g, '$1"$2":'))
  } catch {
    return null
  }
}

// Normalize one parsed object into a call. Accepts name under name/tool/function,
// and args under arguments/parameters/args (object or JSON-string).
function asCall(obj: unknown): ParsedCall | null {
  if (!obj || typeof obj !== 'object') {
    return null
  }
  const o = obj as Record<string, unknown>
  // Some emit { "function": { "name", "arguments" } } (OpenAI-shaped) as text.
  if (o.function && typeof o.function === 'object') {
    return asCall(o.function)
  }
  const name = typeof o.name === 'string' ? o.name : typeof o.tool === 'string' ? o.tool : undefined
  if (!name) {
    return null
  }
  let args: unknown = o.arguments ?? o.parameters ?? o.args ?? {}
  if (typeof args === 'string') {
    args = parseLenient(args) ?? {}
  }
  return { name, args: args && typeof args === 'object' ? (args as Record<string, unknown>) : {} }
}

// Pull the {...} JSON objects out of a fragment, brace-balanced (so nested objects
// in the arguments don't cut it short). Tolerates an unclosed final object at EOS
// (the model hit the token cap mid-call) by closing the braces it left open.
function balancedObjects(text: string): string[] {
  const out: string[] = []
  let depth = 0
  let start = -1
  let inStr = false
  let esc = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      if (esc) {
        esc = false
      } else if (ch === '\\') {
        esc = true
      } else if (ch === '"') {
        inStr = false
      }
      continue
    }
    if (ch === '"') {
      inStr = true
    } else if (ch === '{') {
      if (depth === 0) {
        start = i
      }
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0 && start !== -1) {
        out.push(text.slice(start, i + 1))
        start = -1
      }
    }
  }
  // Unclosed object at EOS — close the braces the model didn't finish.
  if (depth > 0 && start !== -1) {
    out.push(text.slice(start) + '}'.repeat(depth))
  }
  return out
}

/** Recover tool calls from model text. Returns [] when the text is plain prose
 *  (no tool-call markup / no name-bearing JSON object). */
export function parseToolCallsFromText(text: string): ParsedCall[] {
  if (!text || !text.includes('{')) {
    return []
  }
  const calls: ParsedCall[] = []

  // 1. Explicit tool-call tags: <tool_call>…</tool_call>, <|tool_call|>…, <invoke …>.
  //    Grab everything after each opener; balancedObjects finds the JSON inside.
  const tagged = text.match(/<\|?tool_call\|?>|<invoke\b[^>]*>/gi)
  if (tagged) {
    // Everything from the first tag onward is the tool-call region.
    const region = text.slice(text.search(/<\|?tool_call\|?>|<invoke\b[^>]*>/i))
    for (const obj of balancedObjects(region)) {
      const c = asCall(parseLenient(obj))
      if (c) {
        calls.push(c)
      }
    }
    if (calls.length) {
      return calls
    }
  }

  // 2. Fenced ```json … ``` (or bare fenced) blocks.
  const fence = /```(?:json)?\s*([\s\S]*?)```/gi
  let m: RegExpExecArray | null
  while ((m = fence.exec(text))) {
    for (const obj of balancedObjects(m[1] ?? '')) {
      const c = asCall(parseLenient(obj))
      if (c) {
        calls.push(c)
      }
    }
  }
  if (calls.length) {
    return calls
  }

  // 3. Bare JSON object(s) in the text that carry a name + arguments/parameters.
  for (const obj of balancedObjects(text)) {
    if (!/"?(name|tool)"?\s*:/.test(obj)) {
      continue
    }
    const c = asCall(parseLenient(obj))
    // Only accept a bare object if it actually looks like a call (has args key too),
    // so we don't mistake an arbitrary JSON answer for a tool call.
    if (c && /"?(arguments|parameters|args)"?\s*:/.test(obj)) {
      calls.push(c)
    }
  }
  return calls
}
