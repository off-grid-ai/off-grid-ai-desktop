// Detect when a chat message is really an image-generation request, so a user who
// types "draw a dog" gets an image instead of the text model refusing ("I can't
// draw images"). Pure + unit-tested so the heuristic can't silently drift.
//
// Kept conservative: a bare visual verb ("draw/sketch/paint/illustrate/render X")
// counts, weaker verbs ("generate/create/make/show me") require an image noun, and
// common non-visual idioms ("draw a conclusion", "draw attention") are excluded so
// we don't hijack ordinary chat.

// Verbs that, at the start of a message, clearly mean "make a picture".
const VISUAL_VERB =
  /^\s*(?:please\s+|can you\s+|could you\s+)?(draw|sketch|paint|illustrate|render)\b/i
// Weaker verbs need an image noun to count.
const WEAK_VERB =
  /^\s*(?:please\s+|can you\s+|could you\s+)?(generate|create|make|design|produce|show me|give me)\b/i
const IMAGE_NOUN =
  /\b(image|picture|photo(?:graph)?|drawing|painting|illustration|art(?:work)?|logo|wallpaper|poster|portrait|scene|icon|render|sketch|render)\b/i
// "an image of ...", "a picture of ..." even without a leading verb.
const NOUN_OF =
  /\b(?:an?|the)\s+(image|picture|photo(?:graph)?|drawing|painting|illustration|art(?:work)?|logo|wallpaper|poster|portrait)\s+of\b/i
// Non-visual "draw" idioms that must NOT be treated as image requests.
const DRAW_IDIOM =
  /^\s*draw\s+(?:a\s+|the\s+|some\s+)?(conclusion|comparison|parallel|distinction|analog(?:y|ies)|line|attention|blood|breath|inspiration|near|closer|from\b|upon\b|on\b)/i

/** True when the message reads as a request to generate an image. */
export function looksLikeImageRequest(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  if (DRAW_IDIOM.test(t)) return false
  if (VISUAL_VERB.test(t)) return true
  if (WEAK_VERB.test(t) && IMAGE_NOUN.test(t)) return true
  if (NOUN_OF.test(t)) return true
  return false
}

/** Inputs to the renderer's auto-route decision. Kept as data (not scattered
 *  booleans in the component) so the one decision is unit-testable. */
export interface AutoImageRouteOpts {
  /** The composer's current mode ('image' is explicit; anything else is chat). */
  mode: string
  /** An image model is installed + active. */
  imageAvailable: boolean
  /** The agentic tools/connectors path owns this turn (tools|connectors on, not a project chat). */
  agenticActive: boolean
  /** The user's message text. */
  text: string
}

/** Whether the renderer should auto-route a chat turn straight to image
 *  generation (the "draw a dog" fast-path) instead of sending it down the chat /
 *  agentic pipeline.
 *
 *  Returns false when the agentic path is active: there, image generation is a
 *  TOOL the model chooses to call, so the renderer must NOT pre-decide from a
 *  keyword. That renderer-vs-model double decision is exactly what hijacked
 *  "draw ..." turns away from the tool loop (the image-gen-as-tool bug). One
 *  seam: in agentic mode the model decides; only in plain chat does the renderer
 *  keyword heuristic auto-route. */
export function shouldAutoRouteImage(opts: AutoImageRouteOpts): boolean {
  const { mode, imageAvailable, agenticActive, text } = opts
  if (mode === 'image') return false // explicit image mode is handled by the caller, not auto-route
  if (!imageAvailable) return false
  if (agenticActive) return false // the agent owns intent — no renderer pre-decision
  return looksLikeImageRequest(text)
}

/** Strip the leading "draw/generate an image of" phrasing so the diffusion prompt
 *  is just the subject. Falls back to the original text if stripping empties it. */
export function cleanImagePrompt(text: string): string {
  const stripped = text
    .trim()
    .replace(
      /^\s*(?:please\s+|can you\s+|could you\s+)?(?:draw|sketch|paint|illustrate|render|generate|create|make|design|produce|show me|give me)\b\s*/i,
      ''
    )
    .replace(
      /^(?:me\s+)?(?:an?|the)\s+(?:image|picture|photo(?:graph)?|drawing|painting|illustration|art(?:work)?|logo|wallpaper|poster|portrait)\s+of\s+/i,
      ''
    )
    .replace(/^(?:of|for)\s+/i, '')
    .trim()
  return stripped || text.trim()
}
