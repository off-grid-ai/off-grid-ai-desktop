// Pure request-payload / message assembly, extracted from llm.ts so the payload
// shape (multimodal content parts, system message, thinking controls) is a single
// source of truth used by BOTH chat() and chatStream() and is unit-testable without
// a socket or fs. No http/fs/electron imports.
//
// The one impure step - reading image bytes off disk - stays in llm.ts; this module
// takes ALREADY-decoded image data (base64 + mime) so it is fully pure.

import { mimeForExt } from '../mime';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

export interface DecodedImage {
  base64: string;
  mime: string; // e.g. 'image/png' | 'image/jpeg' | 'image/webp'
}

/** MIME type for an image path by extension, via the shared ext->MIME map (image/png
 *  fallback). Previously forced everything non-.png to image/jpeg, which mislabelled
 *  webp/gif/bmp/heic attachments in the RAG chat vision path (the vision model may
 *  reject a declared type that doesn't match the bytes). */
export function imageMime(imgPath: string): string {
  const ext = imgPath.split('.').pop() ?? '';
  return mimeForExt(ext, 'image/png');
}

/** Build the OpenAI-style multimodal content array: the text part first, then one
 *  image_url data-URI part per decoded image (in order). */
export function buildContentParts(message: string, images: DecodedImage[]): ContentPart[] {
  const content: ContentPart[] = [{ type: 'text', text: message }];
  for (const img of images) {
    content.push({ type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.base64}` } });
  }
  return content;
}

/** Build the messages array: the user turn (multimodal content), with an optional
 *  system message unshifted in front when a non-blank system prompt is set.
 *  Mirrors both chat paths (they used `.trim()` to decide whether to prepend). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildMessages(message: string, images: DecodedImage[], systemPrompt: string): any[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = [{ role: 'user', content: buildContentParts(message, images) }];
  if (systemPrompt.trim()) messages.unshift({ role: 'system', content: systemPrompt });
  return messages;
}

/** The chat_template_kwargs / reasoning_format fragment for the thinking control.
 *  Streaming: thinking on -> ask the template to emit reasoning AND set deepseek
 *  reasoning_format (so llama.cpp splits it into reasoning_content); off -> suppress.
 *  Returns the exact object to spread into the payload. */
export function thinkingPayload(thinking: boolean): {
  chat_template_kwargs: { enable_thinking: boolean };
  reasoning_format?: string;
} {
  if (thinking) {
    return { chat_template_kwargs: { enable_thinking: true }, reasoning_format: 'deepseek' };
  }
  return { chat_template_kwargs: { enable_thinking: false } };
}
