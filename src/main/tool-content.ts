// Pure, Electron-free helper for the agentic tool chat: build the user message
// content for an OpenAI-style /chat/completions call. With no images it's a plain
// string; with images it's a multimodal content array (text + image_url parts) so
// the vision model can read attachments even in tools/connectors mode.

export type UserContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export function buildUserContent(
  query: string,
  imageDataUrls: string[] = []
): string | UserContentPart[] {
  if (!imageDataUrls.length) return query
  return [
    { type: 'text', text: query },
    ...imageDataUrls.map((url): UserContentPart => ({ type: 'image_url', image_url: { url } }))
  ]
}
